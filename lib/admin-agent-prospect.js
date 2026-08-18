const { createHash } = require('crypto');
const {
  buildPitchVariants,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  tokenSimilarity
} = require('./agent-ranking');
const { compatibleAgentNames } = require('./agent-name-identity');

const PRESERVED_RELATIONSHIP_STATUSES = new Set([
  'known',
  'worked_with',
  'interested',
  'confirmed_open_house',
  'accepted_open_house',
  'drip_scheduled',
  'member'
]);

function clean(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function enc(value) {
  return encodeURIComponent(clean(value, 2000));
}

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function canonicalRelationshipKey(ranking = {}) {
  const phone = normalizePhone(ranking.phone_normalized || ranking.phone);
  if (phone) return `phone:${phone}`;
  const email = normalizeEmail(ranking.email);
  if (email) return `email:${email}`;
  const slug = clean(ranking.agent_slug || ranking.slug, 200).toLowerCase();
  if (slug) return `slug:${slug}`;
  const name = clean(ranking.agent_name || ranking.name, 300).toLowerCase();
  const brokerage = clean(ranking.brokerage, 300).toLowerCase();
  if (!name) return '';
  return `name:${createHash('md5').update(`${name}|${brokerage}`).digest('hex')}`;
}

function compatibleBrokerage(left, right) {
  const leftValue = normalizeName(left);
  const rightValue = normalizeName(right);
  return !leftValue || !rightValue || tokenSimilarity(leftValue, rightValue) >= 0.35;
}

function identityMatches(ranking = {}, record = {}) {
  if (!compatibleAgentNames(
    ranking.agent_name || ranking.name,
    record.agent_name || record.display_name || record.name
  )) return false;
  const rankingAgentId = clean(ranking.agent_id, 200);
  const recordIds = [record.id, record.rel8tion_agent_id, record.agent_source_id].map((value) => clean(value, 200));
  if (rankingAgentId && recordIds.includes(rankingAgentId)) return true;

  const rankingPhone = normalizePhone(ranking.phone_normalized || ranking.phone);
  const recordPhone = normalizePhone(record.phone_normalized || record.phone || record.agent_phone);
  if (rankingPhone && recordPhone && rankingPhone === recordPhone) return true;

  const rankingEmail = normalizeEmail(ranking.email);
  const recordEmail = normalizeEmail(record.email || record.agent_email);
  if (rankingEmail && recordEmail && rankingEmail === recordEmail) return true;

  const rankingName = normalizeName(ranking.agent_name || ranking.name);
  const recordName = normalizeName(record.agent_name || record.display_name || record.name);
  return Boolean(
    rankingName
    && recordName
    && rankingName === recordName
    && compatibleBrokerage(ranking.brokerage, record.brokerage)
  );
}

async function safeRows(supabaseRest, path) {
  try {
    const rows = await supabaseRest(path);
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

function uniqueById(rows) {
  const found = new Map();
  for (const row of rows.flat()) {
    if (row?.id) found.set(String(row.id), row);
  }
  return [...found.values()];
}

async function resolveAgentProspectState(ranking, supabaseRest) {
  const phone = normalizePhone(ranking.phone_normalized || ranking.phone);
  const email = normalizeEmail(ranking.email);
  const name = clean(ranking.agent_name || ranking.name, 300);
  const agentId = clean(ranking.agent_id, 200);
  const canonicalKey = canonicalRelationshipKey(ranking);

  const agentPaths = [];
  if (agentId) agentPaths.push(`agents?id=eq.${enc(agentId)}&select=id,slug,name,phone,phone_normalized,email,brokerage,image_url&limit=5`);
  if (phone) agentPaths.push(`agents?phone_normalized=eq.${enc(phone)}&select=id,slug,name,phone,phone_normalized,email,brokerage,image_url&limit=10`);
  if (email) agentPaths.push(`agents?email=ilike.${enc(email)}&select=id,slug,name,phone,phone_normalized,email,brokerage,image_url&limit=10`);
  if (name) agentPaths.push(`agents?name=ilike.${enc(name)}&select=id,slug,name,phone,phone_normalized,email,brokerage,image_url&limit=20`);

  const websitePaths = [];
  if (agentId) websitePaths.push(`agent_websites?rel8tion_agent_id=eq.${enc(agentId)}&select=id,rel8tion_agent_id,slug,name,phone,email,brokerage,status,photo_url&limit=10`);
  if (email) websitePaths.push(`agent_websites?email=ilike.${enc(email)}&select=id,rel8tion_agent_id,slug,name,phone,email,brokerage,status,photo_url&limit=10`);
  if (name) websitePaths.push(`agent_websites?name=ilike.${enc(name)}&select=id,rel8tion_agent_id,slug,name,phone,email,brokerage,status,photo_url&limit=20`);

  const relationshipPaths = [];
  if (canonicalKey) relationshipPaths.push(`agent_relationships?canonical_key=eq.${enc(canonicalKey)}&select=*&limit=5`);
  if (phone) relationshipPaths.push(`agent_relationships?phone_normalized=eq.${enc(phone)}&select=*&order=updated_at.desc&limit=10`);
  if (email) relationshipPaths.push(`agent_relationships?email=ilike.${enc(email)}&select=*&order=updated_at.desc&limit=10`);
  if (name) relationshipPaths.push(`agent_relationships?display_name=ilike.${enc(name)}&select=*&order=updated_at.desc&limit=20`);

  const [agentGroups, websiteGroups, relationshipGroups] = await Promise.all([
    Promise.all(agentPaths.map((path) => safeRows(supabaseRest, path))),
    Promise.all(websitePaths.map((path) => safeRows(supabaseRest, path))),
    Promise.all(relationshipPaths.map((path) => safeRows(supabaseRest, path)))
  ]);

  const agent = uniqueById(agentGroups).find((row) => identityMatches(ranking, row)) || null;
  const website = uniqueById(websiteGroups).find((row) => identityMatches(ranking, row)) || null;
  const relationship = uniqueById(relationshipGroups).find((row) => identityMatches(ranking, row)) || null;
  const member = agent
    ? { source: 'agents', id: agent.id, agent_id: agent.id, slug: agent.slug || '', name: agent.name || name, record: agent }
    : website
      ? {
          source: 'agent_websites',
          id: website.id,
          agent_id: website.rel8tion_agent_id || '',
          slug: website.slug || '',
          name: website.name || name,
          record: website
        }
      : null;

  if (member) {
    return {
      kind: 'existing_member',
      label: 'Already on REL8TION',
      member,
      relationship,
      canonical_key: canonicalKey
    };
  }
  if (relationship) {
    const status = clean(relationship.relationship_status, 100).toLowerCase();
    return {
      kind: ['known', 'prospect'].includes(status) ? 'existing_agent_record' : 'existing_relationship',
      label: ['known', 'prospect'].includes(status) ? 'Agent saved in REL8TION' : 'Existing REL8TION relationship',
      member: null,
      relationship,
      canonical_key: relationship.canonical_key || canonicalKey
    };
  }
  return {
    kind: 'not_found',
    label: 'Not yet on REL8TION',
    member: null,
    relationship: null,
    canonical_key: canonicalKey
  };
}

function nextRelationshipStatus(state) {
  const existing = clean(state.relationship?.relationship_status, 100).toLowerCase();
  if (PRESERVED_RELATIONSHIP_STATUSES.has(existing)) return existing;
  return state.member ? 'member' : 'known';
}

async function createOrResolveAgentRecord({ ranking, supabaseRest, now = new Date() }) {
  const name = clean(ranking.agent_name || ranking.name, 300);
  const canonicalKey = canonicalRelationshipKey(ranking);
  if (!name || !canonicalKey) {
    const error = new Error('Agent name plus a phone, email, slug, or brokerage identity is required.');
    error.status = 400;
    throw error;
  }

  const state = await resolveAgentProspectState(ranking, supabaseRest);
  const variants = buildPitchVariants(ranking);
  const timestamp = now.toISOString();
  const existingMetadata = state.relationship?.metadata && typeof state.relationship.metadata === 'object'
    ? state.relationship.metadata
    : {};
  const relationshipStatus = nextRelationshipStatus(state);
  const memberRecord = state.member?.record || {};
  const payload = {
    canonical_key: state.relationship?.canonical_key || canonicalKey,
    agent_source_id: state.member?.agent_id || state.member?.id || state.relationship?.agent_source_id || ranking.id || null,
    agent_slug: state.member?.slug || state.relationship?.agent_slug || null,
    display_name: memberRecord.name || state.relationship?.display_name || name,
    phone: memberRecord.phone || state.relationship?.phone || ranking.phone || ranking.phone_normalized || null,
    phone_normalized: normalizePhone(memberRecord.phone_normalized || memberRecord.phone || state.relationship?.phone_normalized || state.relationship?.phone || ranking.phone_normalized || ranking.phone) || null,
    email: normalizeEmail(memberRecord.email || state.relationship?.email || ranking.email) || null,
    brokerage: memberRecord.brokerage || state.relationship?.brokerage || ranking.brokerage || null,
    photo_url: memberRecord.image_url || memberRecord.photo_url || state.relationship?.photo_url || ranking.agent_photo_url || null,
    relationship_status: relationshipStatus,
    metadata: {
      ...existingMetadata,
      record_type: state.member ? 'member' : 'agent',
      source: 'agent_ranking',
      ranking_id: ranking.id || null,
      outreach_lane: 'general_agent_invitation',
      invitation_drafts: variants,
      selected_invitation_draft: variants.soft_intro,
      automatic_sending: false,
      outreach_queue_created: false,
      last_reviewed_at: timestamp,
      member_source: state.member?.source || null,
      member_record_id: state.member?.id || null
    },
    updated_at: timestamp
  };

  let relationship;
  let created = false;
  if (state.relationship?.id) {
    const { canonical_key: _canonicalKey, ...updates } = payload;
    relationship = one(await supabaseRest(`agent_relationships?id=eq.${enc(state.relationship.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(updates)
    })) || { ...state.relationship, ...updates };
  } else {
    relationship = one(await supabaseRest('agent_relationships', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    }));
    created = true;
  }

  if (!relationship?.id) throw new Error('Unable to save the REL8TION agent record.');

  const eventType = state.member ? 'member_identified' : created ? 'agent_saved' : 'agent_reviewed';
  await supabaseRest('agent_relationship_events', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      relationship_id: relationship.id,
      event_type: eventType,
      source_system: 'rel8tion_command',
      source_table: 'agent_rankings',
      source_record_id: String(ranking.id || relationship.id),
      summary: state.member ? 'Existing REL8TION member identified' : created ? 'Agent saved to REL8TION' : 'Saved REL8TION agent reviewed',
      occurred_at: timestamp,
      metadata: {
        ranking_id: ranking.id || null,
        member_source: state.member?.source || null,
        automatic_sending: false,
        outreach_queue_created: false
      }
    })
  });

  const resultKind = state.member
    ? 'existing_member'
    : created
      ? 'agent_saved'
      : relationshipStatus === 'known'
        ? 'existing_agent_record'
        : 'existing_relationship';
  const status = {
    kind: resultKind,
    label: state.member
      ? 'Already on REL8TION'
      : created
        ? 'Agent saved to REL8TION'
        : relationshipStatus === 'known'
          ? 'Agent saved in REL8TION'
          : 'Existing REL8TION relationship',
    member: state.member,
    relationship_id: relationship.id,
    relationship_status: relationship.relationship_status || relationshipStatus,
    automatic_sending: false,
    outreach_queue_created: false
  };

  let updatedRanking = ranking;
  if (ranking.id && !String(ranking.id).startsWith('relationship:')) {
    const rankingPayload = {
      agent_id: state.member?.agent_id || ranking.agent_id || null,
      raw_sources: {
        ...(ranking.raw_sources || {}),
        rel8tion_status: status,
        rel8tion_relationship_id: relationship.id,
        rel8tion_agent_record_status: resultKind,
        rel8tion_agent_record_updated_at: timestamp
      }
    };
    updatedRanking = one(await supabaseRest(`agent_rankings?id=eq.${enc(ranking.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(rankingPayload)
    })) || { ...ranking, ...rankingPayload };
  }

  return {
    ranking: updatedRanking,
    relationship,
    rel8tion_status: status,
    invitation_drafts: variants,
    created,
    outbound_sent: false,
    outreach_queue_created: false
  };
}

module.exports = {
  canonicalRelationshipKey,
  createOrResolveAgentProspect: createOrResolveAgentRecord,
  createOrResolveAgentRecord,
  identityMatches,
  resolveAgentProspectState
};
