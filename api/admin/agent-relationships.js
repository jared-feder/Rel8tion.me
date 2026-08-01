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

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function inFilter(values) {
  return `in.(${values.map((value) => enc(value)).join(',')})`;
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function compactAddress({ address, city, state, zip }) {
  return [
    address,
    [city, state].filter(Boolean).join(', '),
    zip
  ].filter(Boolean).join(' ');
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

function queueMatchesRelationship(queue, relationship) {
  const relationshipPhone = phoneDigits(relationship.phone_normalized || relationship.phone);
  const queuePhone = phoneDigits(queue.agent_phone_normalized || queue.agent_phone);
  const relationshipEmail = clean(relationship.email, 320).toLowerCase();
  const queueEmail = clean(queue.agent_email, 320).toLowerCase();
  const relationshipSourceId = clean(relationship.agent_source_id, 300);
  const queueId = clean(queue.id, 300);
  return Boolean(
    (relationshipPhone && queuePhone && relationshipPhone === queuePhone)
    || (relationshipEmail && queueEmail && relationshipEmail === queueEmail)
    || (relationshipSourceId && queueId && relationshipSourceId === queueId)
  );
}

function queueAddress(queue) {
  return compactAddress({
    address: queue.address,
    city: queue.city,
    state: queue.state,
    zip: queue.zip
  });
}

function conversationItem(queue, message, source) {
  return {
    id: clean(message.id || message.message_sid, 300) || `${source}:${queue.id}:${message.occurred_at || message.received_at || message.created_at || ''}`,
    queue_row_id: queue.id,
    open_house_id: queue.open_house_id || null,
    property_address: queueAddress(queue),
    direction: message.direction === 'outbound' ? 'outbound' : 'inbound',
    body: clean(message.body, 4000),
    occurred_at: clean(message.occurred_at || message.received_at || message.created_at, 100),
    source,
    opt_out: message.opt_out === true
  };
}

async function attachFollowUpConversations(rows) {
  const markedRelationships = rows.filter((row) => row.follow_up_marked);
  if (!markedRelationships.length) return rows;

  const sourceIds = unique(markedRelationships.map((row) => clean(row.agent_source_id, 300)));
  const phones = unique(markedRelationships.map((row) => phoneDigits(row.phone_normalized || row.phone)));
  const emails = unique(markedRelationships.map((row) => clean(row.email, 320).toLowerCase()));
  const queueSelect = [
    'id', 'open_house_id', 'address', 'city', 'state', 'zip',
    'agent_name', 'agent_phone', 'agent_phone_normalized', 'agent_email', 'brokerage',
    'selected_sms', 'initial_sent_at', 'followup_sms', 'followup_sent_at',
    'last_outreach_at', 'created_at'
  ].join(',');
  const queueRequests = [];
  if (sourceIds.length) {
    queueRequests.push(supabaseRest(
      `agent_outreach_queue?id=${inFilter(sourceIds)}&select=${queueSelect}&limit=1000`
    ));
  }
  if (phones.length) {
    queueRequests.push(supabaseRest(
      `agent_outreach_queue?agent_phone_normalized=${inFilter(phones)}&select=${queueSelect}&order=created_at.asc&limit=1000`
    ));
  }
  if (emails.length) {
    queueRequests.push(supabaseRest(
      `agent_outreach_queue?agent_email=${inFilter(emails)}&select=${queueSelect}&order=created_at.asc&limit=1000`
    ));
  }

  const queueById = new Map();
  for (const result of await Promise.all(queueRequests)) {
    for (const queue of Array.isArray(result) ? result : []) {
      if (queue?.id) queueById.set(queue.id, queue);
    }
  }
  const queueRows = [...queueById.values()];
  const queueIds = queueRows.map((queue) => queue.id);
  const repliesByQueue = new Map();
  for (let index = 0; index < queueIds.length; index += 80) {
    const chunk = queueIds.slice(index, index + 80);
    const replies = await supabaseRest(
      `agent_outreach_replies?queue_row_id=${inFilter(chunk)}&select=id,queue_row_id,body,direction,opt_out,message_sid,received_at,created_at&order=received_at.asc&limit=1000`
    );
    for (const reply of Array.isArray(replies) ? replies : []) {
      if (!repliesByQueue.has(reply.queue_row_id)) repliesByQueue.set(reply.queue_row_id, []);
      repliesByQueue.get(reply.queue_row_id).push(reply);
    }
  }

  return rows.map((relationship) => {
    if (!relationship.follow_up_marked) {
      return {
        ...relationship,
        conversation_log: [],
        conversation_count: 0,
        conversation_threads: 0
      };
    }
    const matchingQueues = queueRows.filter((queue) => queueMatchesRelationship(queue, relationship));
    const conversations = [];
    for (const queue of matchingQueues) {
      const initialSentAt = queue.initial_sent_at || queue.last_outreach_at || '';
      if (queue.selected_sms && initialSentAt) {
        conversations.push(conversationItem(queue, {
          id: `initial:${queue.id}`,
          body: queue.selected_sms,
          direction: 'outbound',
          occurred_at: initialSentAt
        }, 'initial_outreach'));
      }
      if (queue.followup_sms && queue.followup_sent_at) {
        conversations.push(conversationItem(queue, {
          id: `followup:${queue.id}`,
          body: queue.followup_sms,
          direction: 'outbound',
          occurred_at: queue.followup_sent_at
        }, 'scheduled_follow_up'));
      }
      for (const reply of repliesByQueue.get(queue.id) || []) {
        conversations.push(conversationItem(queue, reply, 'outreach_reply'));
      }
    }
    const deduped = new Map();
    for (const message of conversations) {
      if (!message.body) continue;
      const key = message.id || [
        message.direction,
        message.occurred_at,
        message.body
      ].join('|');
      deduped.set(key, message);
    }
    const conversationLog = [...deduped.values()]
      .sort((left, right) => new Date(left.occurred_at || 0) - new Date(right.occurred_at || 0))
      .slice(-200);
    return {
      ...relationship,
      conversation_log: conversationLog,
      conversation_count: conversationLog.length,
      conversation_threads: matchingQueues.length
    };
  });
}

async function loadBoard(limitValue, options = {}) {
  const requestedLimit = Math.max(1, Math.min(Number(limitValue) || 1000, 5000));
  const fetchLimit = 5000;
  const pageSize = 1000;
  const summaryOnly = options.summary === true;
  const boardSelect = summaryOnly
    ? 'id,canonical_key,agent_source_id,agent_slug,name,phone,phone_normalized,email,company,pinned,priority_rank,confirmed_open_houses,worked_with_agent,relationship_sources'
    : '*';
  const rows = [];
  while (rows.length < fetchLimit) {
    const page = await supabaseRest(
      `agent_board_v1?select=${boardSelect}&order=pinned.desc,priority_rank.asc.nullslast,confirmed_open_houses.desc,last_contact_at.desc.nullslast,name.asc&limit=${pageSize}&offset=${rows.length}`
    );
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  const stateEvents = await supabaseRest(
    'agent_relationship_events?event_type=in.(historical_open_house_confirmed,historical_open_house_removed,follow_up_marked,follow_up_cleared)&select=id,relationship_id,event_type,summary,occurred_at,metadata&order=occurred_at.desc&limit=5000'
  );
  const latestHistoricalState = new Map();
  const latestFollowUpState = new Map();
  for (const event of stateEvents) {
    if (!event.relationship_id) continue;
    if (
      !latestHistoricalState.has(event.relationship_id)
      && (event.event_type === 'historical_open_house_confirmed' || event.event_type === 'historical_open_house_removed')
    ) {
      latestHistoricalState.set(event.relationship_id, event);
    }
    if (
      !latestFollowUpState.has(event.relationship_id)
      && (event.event_type === 'follow_up_marked' || event.event_type === 'follow_up_cleared')
    ) {
      latestFollowUpState.set(event.relationship_id, event);
    }
  }
  const boardRows = rows.map((row, sourceOrder) => {
    const historicalEvent = latestHistoricalState.get(row.id);
    const followUpEvent = latestFollowUpState.get(row.id);
    const historicalOpenHouseAgent = historicalEvent?.event_type === 'historical_open_house_confirmed';
    const followUpMarked = followUpEvent?.event_type === 'follow_up_marked';
    const followUpMetadata = followUpEvent?.metadata && typeof followUpEvent.metadata === 'object'
      ? followUpEvent.metadata
      : {};
    const relationshipSources = Array.isArray(row.relationship_sources) ? row.relationship_sources : [];
    return {
      ...row,
      follow_up_marked: followUpMarked,
      follow_up_title: followUpMarked ? clean(followUpMetadata.title || followUpEvent?.summary, 1000) : '',
      follow_up_due_at: followUpMarked ? clean(followUpMetadata.due_at, 100) : '',
      follow_up_note: followUpMarked ? clean(followUpMetadata.note, 4000) : '',
      follow_up_marked_at: followUpMarked ? clean(followUpEvent?.occurred_at, 100) : '',
      _source_order: sourceOrder,
      historical_open_house_agent: historicalOpenHouseAgent,
      historical_open_houses: historicalOpenHouseAgent ? 1 : 0,
      worked_with_agent: Boolean(row.worked_with_agent || historicalOpenHouseAgent),
      relationship_sources: historicalOpenHouseAgent
        ? [...new Set([...relationshipSources, 'historical_open_house'])]
        : relationshipSources.filter((source) => source !== 'historical_open_house')
    };
  }).sort((left, right) => (
    Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
    || (Number.isFinite(Number(left.priority_rank)) ? Number(left.priority_rank) : 1_000_000)
      - (Number.isFinite(Number(right.priority_rank)) ? Number(right.priority_rank) : 1_000_000)
    || Number(Boolean(right.follow_up_marked)) - Number(Boolean(left.follow_up_marked))
    || left._source_order - right._source_order
  )).slice(0, requestedLimit).map(({ _source_order, ...row }) => row);
  return summaryOnly ? boardRows : attachFollowUpConversations(boardRows);
}

async function loadScheduledOpenHouses(fromValue, toValue) {
  const from = clean(fromValue, 100);
  const to = clean(toValue, 100);
  if (!from || !to || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) {
    const error = new Error('Valid from and to timestamps are required for the schedule view.');
    error.status = 400;
    throw error;
  }

  const visits = await supabaseRest(
    `field_demo_visits?select=*&scheduled_start=gte.${enc(from)}&scheduled_start=lt.${enc(to)}&status=neq.cancelled&order=scheduled_start.asc&limit=250`
  );
  const queueIds = unique(visits.map((visit) => visit.outreach_queue_id));
  const openHouseIds = unique(visits.map((visit) => visit.open_house_id));
  const [queueRows, openHouseRows] = await Promise.all([
    queueIds.length
      ? supabaseRest(`agent_outreach_queue?id=${inFilter(queueIds)}&select=*&limit=${queueIds.length}`)
      : [],
    openHouseIds.length
      ? supabaseRest(`open_houses?id=${inFilter(openHouseIds)}&select=*&limit=${openHouseIds.length}`)
      : []
  ]);
  const queueById = new Map(queueRows.map((row) => [row.id, row]));
  const openHouseById = new Map(openHouseRows.map((row) => [row.id, row]));

  const scheduledOpenHouses = visits.map((visit) => {
    const queue = queueById.get(visit.outreach_queue_id) || {};
    const openHouse = openHouseById.get(visit.open_house_id || queue.open_house_id) || {};
    const address = firstPresent(visit.address, visit.property_address, queue.address, openHouse.address);
    const city = firstPresent(visit.city, queue.city, openHouse.city);
    const state = firstPresent(visit.state, queue.state, openHouse.state);
    const zip = firstPresent(visit.property_zip, visit.zip, queue.zip, openHouse.zip);
    const propertyAddress = compactAddress({ address, city, state, zip }) || 'Scheduled open house';
    return {
      id: visit.id,
      field_visit_id: visit.id,
      open_house_id: firstPresent(visit.open_house_id, queue.open_house_id, openHouse.id),
      outreach_queue_id: visit.outreach_queue_id || null,
      scheduled_start: visit.scheduled_start,
      scheduled_end: visit.scheduled_end || null,
      status: visit.status || 'scheduled',
      property_address: propertyAddress,
      address,
      city,
      state,
      zip,
      agent_name: firstPresent(visit.agent_name, queue.agent_name, openHouse.agent_name),
      agent_phone: firstPresent(visit.agent_phone, queue.agent_phone, openHouse.agent_phone),
      agent_email: firstPresent(visit.agent_email, queue.agent_email, openHouse.agent_email),
      brokerage: firstPresent(visit.brokerage, queue.brokerage, openHouse.brokerage),
      notes: visit.notes || '',
      source: 'field_demo_visits'
    };
  });

  const deduped = new Map();
  for (const scheduled of scheduledOpenHouses) {
    const identity = [
      clean(scheduled.open_house_id || scheduled.property_address, 500).toLowerCase(),
      clean(scheduled.scheduled_start, 100),
      clean(scheduled.scheduled_end, 100),
      phoneDigits(scheduled.agent_phone) || clean(scheduled.agent_name, 300).toLowerCase()
    ].join('|');
    const existing = deduped.get(identity);
    if (!existing) {
      deduped.set(identity, {
        ...scheduled,
        source_record_count: 1,
        source_field_visit_ids: [scheduled.field_visit_id]
      });
      continue;
    }
    const sourceFieldVisitIds = unique([
      ...existing.source_field_visit_ids,
      scheduled.field_visit_id
    ]).sort();
    deduped.set(identity, {
      ...existing,
      status: existing.status === 'confirmed' || scheduled.status !== 'confirmed'
        ? existing.status
        : scheduled.status,
      source_record_count: sourceFieldVisitIds.length,
      source_field_visit_ids: sourceFieldVisitIds
    });
  }
  return [...deduped.values()];
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

  if (action === 'historical_open_house') {
    const worked = body.worked !== false;
    const event = await recordEvent(
      relationship.id,
      body,
      worked ? 'historical_open_house_confirmed' : 'historical_open_house_removed',
      worked ? 'Historical open house worked together' : 'Historical open-house marker removed'
    );
    return {
      relationship,
      event,
      message: `${relationship.display_name} ${worked ? 'was added to' : 'was removed from'} historical open-house matches.`
    };
  }

  if (action === 'follow_up') {
    const followUp = body.follow_up !== false;
    const title = clean(body.title, 1000) || `Follow up with ${relationship.display_name}`;
    const event = await recordEvent(
      relationship.id,
      {
        ...body,
        metadata: followUp
          ? {
              title,
              due_at: clean(body.due_at, 100) || null,
              note: clean(body.note, 4000) || null
            }
          : {}
      },
      followUp ? 'follow_up_marked' : 'follow_up_cleared',
      followUp ? title : 'Follow-up marker cleared'
    );
    return {
      relationship,
      event,
      message: `${relationship.display_name} ${followUp ? 'was marked for follow-up' : 'was cleared from follow-up'}.`
    };
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
      if (clean(req.query?.view, 40).toLowerCase() === 'schedule') {
        const scheduledOpenHouses = await loadScheduledOpenHouses(req.query?.from, req.query?.to);
        sendJson(res, 200, {
          ok: true,
          source: 'field_demo_visits',
          scheduled_open_houses: scheduledOpenHouses,
          count: scheduledOpenHouses.length,
          updated_at: new Date().toISOString()
        });
        return;
      }
      const summaryOnly = clean(req.query?.view, 40).toLowerCase() === 'summary';
      const agents = await loadBoard(req.query?.limit, { summary: summaryOnly });
      sendJson(res, 200, {
        ok: true,
        source: summaryOnly ? 'agent_board_v1_summary' : 'agent_board_v1',
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
