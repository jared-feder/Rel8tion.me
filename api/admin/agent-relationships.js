const { createHash, randomUUID, timingSafeEqual } = require('crypto');
const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');

const RELATIONSHIP_TOKEN = process.env.REL8TION_RELATIONSHIP_TOKEN || '';

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function phoneDigits(value) {
  const digits = clean(value, 40).replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function canonicalKey(agent = {}) {
  const phone = phoneDigits(agent.phone_normalized || agent.phone || agent.agent_phone);
  if (phone) return `phone:${phone}`;
  const email = clean(agent.email || agent.agent_email, 320).toLowerCase();
  if (email) return `email:${email}`;
  const slug = clean(agent.agent_slug || agent.slug, 200).toLowerCase();
  if (slug) return `slug:${slug}`;
  const name = clean(agent.name || agent.agent_name, 300).toLowerCase();
  const brokerage = clean(agent.company || agent.brokerage, 300).toLowerCase();
  if (!name) return '';
  return `name:${createHash('md5').update(`${name}|${brokerage}`).digest('hex')}`;
}

function relationshipPayload(agent = {}) {
  const name = clean(agent.name || agent.agent_name, 300);
  const phone = clean(agent.phone || agent.agent_phone, 80);
  const normalizedPhone = phoneDigits(agent.phone_normalized || phone);
  const email = clean(agent.email || agent.agent_email, 320).toLowerCase();
  const key = canonicalKey(agent);
  if (!key || !name) {
    const error = new Error('Agent name plus a phone, email, slug, or brokerage identity is required.');
    error.status = 400;
    throw error;
  }
  return {
    canonical_key: key,
    agent_source_id: clean(agent.agent_source_id || agent.id, 300) || null,
    agent_slug: clean(agent.agent_slug || agent.slug, 200) || null,
    display_name: name,
    phone: phone || null,
    phone_normalized: normalizedPhone || null,
    email: email || null,
    brokerage: clean(agent.company || agent.brokerage, 300) || null,
    photo_url: clean(agent.photo_url || agent.agent_photo_url, 2000) || null,
    last_contact_at: clean(agent.last_contact_at, 100) || null,
    updated_at: new Date().toISOString()
  };
}

function enc(value) {
  return encodeURIComponent(String(value || ''));
}

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function relationshipAuthorized(req) {
  const provided = String(
    req.headers?.['x-admin-token']
    || req.headers?.['X-Admin-Token']
    || req.headers?.authorization
    || ''
  ).replace(/^Bearer\s+/i, '').trim();
  if (RELATIONSHIP_TOKEN && provided) {
    const expectedBuffer = Buffer.from(RELATIONSHIP_TOKEN);
    const providedBuffer = Buffer.from(provided);
    if (
      expectedBuffer.length === providedBuffer.length
      && timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      return { ok: true, method: 'relationship_token' };
    }
  }
  return adminAuthorized(req);
}

async function findRelationship(payload) {
  const exact = one(await supabaseRest(
    `agent_relationships?canonical_key=eq.${enc(payload.canonical_key)}&select=*&limit=1`
  ));
  if (exact) return exact;

  if (payload.phone_normalized) {
    return one(await supabaseRest(
      `agent_relationships?phone_normalized=eq.${enc(payload.phone_normalized)}&select=*&order=updated_at.desc&limit=1`
    ));
  }

  if (payload.agent_slug) {
    const bySlug = one(await supabaseRest(
      `agent_relationships?agent_slug=eq.${enc(payload.agent_slug)}&select=*&order=updated_at.desc&limit=1`
    ));
    if (bySlug) return bySlug;
  }

  if (payload.email) {
    return one(await supabaseRest(
      `agent_relationships?email=eq.${enc(payload.email)}&select=*&order=updated_at.desc&limit=1`
    ));
  }

  return null;
}

async function ensureRelationship(agent) {
  const payload = relationshipPayload(agent);
  const existing = await findRelationship(payload);
  if (existing) {
    const updates = Object.fromEntries(
      Object.entries(payload).filter(([key, value]) => key !== 'canonical_key' && value !== null && value !== '')
    );
    return one(await supabaseRest(`agent_relationships?id=eq.${enc(existing.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(updates)
    })) || { ...existing, ...updates };
  }
  return one(await supabaseRest('agent_relationships', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  }));
}

async function loadBoard(limitValue) {
  const limit = Math.max(1, Math.min(Number(limitValue) || 1000, 5000));
  const pageSize = Math.min(limit, 1000);
  const rows = [];
  while (rows.length < limit) {
    const page = await supabaseRest(
      `agent_board_v1?select=*&order=pinned.desc,priority_rank.asc.nullslast,confirmed_open_houses.desc,last_contact_at.desc.nullslast,name.asc&limit=${pageSize}&offset=${rows.length}`
    );
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows.slice(0, limit);
}

async function recordEvent(relationshipId, body, eventType, summary) {
  const sourceSystem = clean(body.source_system, 80) || 'rel8tion_admin';
  const sourceTable = clean(body.source_table, 120) || 'agent_relationships';
  const sourceRecordId = clean(body.source_record_id, 300) || randomUUID();
  const rows = await supabaseRest('agent_relationship_events', {
    method: 'POST',
    headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
    body: JSON.stringify({
      relationship_id: relationshipId,
      event_type: eventType,
      source_system: sourceSystem,
      source_table: sourceTable,
      source_record_id: sourceRecordId,
      summary,
      occurred_at: clean(body.occurred_at, 100) || new Date().toISOString(),
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {}
    })
  });
  return one(rows);
}

async function mutateRelationship(body) {
  const action = clean(body.action, 80).toLowerCase();
  const relationship = await ensureRelationship(body.agent || body);
  if (!relationship?.id) {
    const error = new Error('Unable to resolve the agent relationship.');
    error.status = 500;
    throw error;
  }

  if (action === 'pin' || action === 'unpin') {
    const pinned = action === 'pin';
    const now = new Date().toISOString();
    const updated = one(await supabaseRest(`agent_relationships?id=eq.${enc(relationship.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        pinned,
        priority_rank: pinned && Number.isFinite(Number(body.priority_rank))
          ? Math.max(0, Math.floor(Number(body.priority_rank)))
          : null,
        pin_reason: pinned ? clean(body.pin_reason || body.note, 1000) || null : null,
        pinned_at: pinned ? now : null,
        updated_at: now
      })
    })) || relationship;
    await recordEvent(updated.id, body, pinned ? 'pinned' : 'unpinned', pinned ? 'Pinned to top' : 'Unpinned');
    return { relationship: updated, message: `${updated.display_name} ${pinned ? 'was pinned to the top' : 'was unpinned'}.` };
  }

  if (action === 'note') {
    const note = clean(body.text || body.note, 4000);
    if (!note) {
      const error = new Error('Note text is required.');
      error.status = 400;
      throw error;
    }
    const event = await recordEvent(relationship.id, body, 'note_added', note);
    return { relationship, event, message: `Note saved for ${relationship.display_name}.` };
  }

  if (action === 'sync') {
    const eventTypes = Array.isArray(body.relationship_sources)
      ? [...new Set(body.relationship_sources.map((value) => clean(value, 80)).filter(Boolean))]
      : [];
    const events = [];
    for (const eventType of eventTypes) {
      events.push(await recordEvent(
        relationship.id,
        {
          ...body,
          source_system: body.source_system || 'rel8tion_os',
          source_table: body.source_table || 'agent_board_sync',
          source_record_id: `${body.source_record_id || relationship.canonical_key}:${eventType}`
        },
        eventType === 'mortgage_referral' ? 'mortgage_referral' : 'relationship_sync',
        `Relationship evidence synced: ${eventType}`
      ));
    }
    return { relationship, events: events.filter(Boolean), message: `${relationship.display_name} was synchronized.` };
  }

  const error = new Error('Unsupported relationship action.');
  error.status = 400;
  throw error;
}

module.exports = async function handler(req, res) {
  try {
    if (!RELATIONSHIP_TOKEN) assertAdminConfig();
    const auth = relationshipAuthorized(req);
    if (!auth.ok) {
      sendJson(res, 401, { ok: false, error: auth.error });
      return;
    }

    if (req.method === 'GET') {
      const agents = await loadBoard(req.query?.limit);
      sendJson(res, 200, {
        ok: true,
        source: 'agent_board_v1',
        agents,
        updated_at: new Date().toISOString()
      });
      return;
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      const result = await mutateRelationship(body);
      const agents = body.include_board === false ? undefined : await loadBoard(body.limit);
      sendJson(res, 200, {
        ok: true,
        ...result,
        ...(agents ? { agents } : {}),
        updated_at: new Date().toISOString()
      });
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  } catch (error) {
    const schemaMissing = /agent_relationship|agent_board_v1|PGRST205|schema cache/i.test(
      `${error.message || ''} ${JSON.stringify(error.payload || {})}`
    );
    sendJson(res, schemaMissing ? 503 : error.status || 500, {
      ok: false,
      error: schemaMissing
        ? 'The agent relationship migration has not been applied to Supabase yet.'
        : error.message || 'Unable to update agent relationships.',
      details: error.payload || null
    });
  }
};
