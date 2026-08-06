const { createHash } = require('crypto');
const { supabaseRest } = require('./admin-auth');

const PHOTO_BUCKET = process.env.SUPABASE_AGENT_IMAGE_BUCKET || 'agent-images';
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function normalizeText(value) {
  return clean(value, 500)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizePhone(value) {
  const digits = clean(value, 80).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function normalizeEmail(value) {
  const email = clean(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function cleanUuid(value) {
  const id = clean(value, 80).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : '';
}

function cleanSlug(value) {
  const slug = clean(value, 120).toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,90}$/.test(slug) ? slug : '';
}

function normalizeIdentity(input = {}) {
  const queueIds = Array.isArray(input.queue_row_ids)
    ? [...new Set(input.queue_row_ids.map(cleanUuid).filter(Boolean))].slice(0, 200)
    : [];
  const phone = clean(input.phone || input.agent_phone, 80);
  return {
    agentId: cleanUuid(input.agent_id || input.id),
    rankingId: cleanUuid(input.ranking_id),
    slug: cleanSlug(input.slug || input.agent_slug),
    name: clean(input.name || input.agent_name, 300),
    phone,
    phoneNormalized: normalizePhone(input.phone_normalized || input.agent_phone_normalized || phone),
    email: normalizeEmail(input.email || input.agent_email),
    brokerage: clean(input.brokerage || input.company, 300),
    queueIds
  };
}

function assertIdentity(identity) {
  const hasStrongIdentity = identity.agentId || identity.rankingId || identity.slug
    || identity.phoneNormalized || identity.email || identity.queueIds.length;
  const hasNameIdentity = identity.name && identity.brokerage;
  if (!identity.name || (!hasStrongIdentity && !hasNameIdentity)) {
    const error = new Error('Agent name plus a saved ID, phone, email, slug, or brokerage is required.');
    error.status = 400;
    throw error;
  }
}

function decodePhoto(value) {
  const raw = clean(value, 8_000_000);
  const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    const error = new Error('The selected photo could not be read.');
    error.status = 400;
    throw error;
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length < 1000) {
    const error = new Error('The selected photo is empty or too small.');
    error.status = 400;
    throw error;
  }
  if (buffer.length > MAX_PHOTO_BYTES) {
    const error = new Error('The processed photo is too large. Please choose a smaller image.');
    error.status = 413;
    throw error;
  }
  return buffer;
}

function detectImage(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  const error = new Error('Only JPG, PNG, and WebP agent photos are supported.');
  error.status = 400;
  throw error;
}

function enc(value) {
  return encodeURIComponent(String(value || ''));
}

function inFilter(values) {
  return `in.(${values.map(enc).join(',')})`;
}

function storagePathFor(identity, extension) {
  const label = (identity.slug || normalizeText(identity.name).replace(/\s+/g, '-') || 'agent')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 55) || 'agent';
  const fingerprint = createHash('sha256').update([
    identity.agentId,
    identity.slug,
    identity.phoneNormalized,
    identity.email,
    normalizeText(identity.name),
    normalizeText(identity.brokerage)
  ].join('|')).digest('hex').slice(0, 12);
  return `command/${label}-${fingerprint}/${Date.now()}.${extension}`;
}

function encodedStoragePath(path) {
  return String(path || '').split('/').map(enc).join('/');
}

function namesConflict(row, identity, spec) {
  const rowName = normalizeText(row[spec.name]);
  const identityName = normalizeText(identity.name);
  return Boolean(rowName && identityName && rowName !== identityName);
}

function identityMatches(row, identity, spec) {
  if (!row) return false;
  const explicitIds = [];
  if (spec.agentId) explicitIds.push([identity.agentId, row[spec.agentId]]);
  if (spec.rankingId) explicitIds.push([identity.rankingId, row[spec.rankingId]]);
  if (spec.queueId) explicitIds.push(...identity.queueIds.map((id) => [id, row[spec.queueId]]));
  if (explicitIds.some(([wanted, actual]) => wanted && actual && String(wanted) === String(actual))) return true;

  const rowSlug = spec.slug ? cleanSlug(row[spec.slug]) : '';
  if (identity.slug && rowSlug && identity.slug === rowSlug) return true;

  const conflict = namesConflict(row, identity, spec);
  const rowEmail = spec.email ? normalizeEmail(row[spec.email]) : '';
  if (!conflict && identity.email && rowEmail && identity.email === rowEmail) return true;

  const rowPhone = normalizePhone(row[spec.phoneNormalized] || row[spec.phone]);
  if (!conflict && identity.phoneNormalized && rowPhone && identity.phoneNormalized === rowPhone) return true;

  const rowName = normalizeText(row[spec.name]);
  const rowBrokerage = normalizeText(row[spec.brokerage]);
  return Boolean(
    rowName && rowBrokerage
    && rowName === normalizeText(identity.name)
    && rowBrokerage === normalizeText(identity.brokerage)
  );
}

const SOURCES = [
  {
    key: 'agents',
    table: 'agents',
    select: 'id,slug,name,phone,phone_normalized,email,brokerage,image_url',
    spec: { agentId: 'id', slug: 'slug', name: 'name', phone: 'phone', phoneNormalized: 'phone_normalized', email: 'email', brokerage: 'brokerage' }
  },
  {
    key: 'outreach',
    table: 'agent_outreach_queue',
    select: 'id,agent_name,agent_phone,agent_phone_normalized,agent_email,brokerage,agent_photo_url',
    spec: { queueId: 'id', name: 'agent_name', phone: 'agent_phone', phoneNormalized: 'agent_phone_normalized', email: 'agent_email', brokerage: 'brokerage' }
  },
  {
    key: 'listingAgents',
    table: 'listing_agents',
    select: 'id,name,phone,phone_normalized,email,brokerage,primary_photo_url,directory_photo_url',
    spec: { name: 'name', phone: 'phone', phoneNormalized: 'phone_normalized', email: 'email', brokerage: 'brokerage' }
  },
  {
    key: 'websites',
    table: 'agent_websites',
    select: 'id,rel8tion_agent_id,slug,name,phone,email,brokerage,photo_url',
    spec: { agentId: 'rel8tion_agent_id', slug: 'slug', name: 'name', phone: 'phone', email: 'email', brokerage: 'brokerage' }
  },
  {
    key: 'relationships',
    table: 'agent_relationships',
    select: 'id,agent_source_id,agent_slug,display_name,phone,phone_normalized,email,brokerage,photo_url',
    spec: { agentId: 'agent_source_id', slug: 'agent_slug', name: 'display_name', phone: 'phone', phoneNormalized: 'phone_normalized', email: 'email', brokerage: 'brokerage' }
  },
  {
    key: 'rankings',
    table: 'agent_rankings',
    select: 'id,agent_id,agent_name,phone,phone_normalized,email,brokerage',
    spec: { agentId: 'agent_id', rankingId: 'id', name: 'agent_name', phone: 'phone', phoneNormalized: 'phone_normalized', email: 'email', brokerage: 'brokerage' }
  }
];

function selectorsFor(source, identity) {
  const selectors = [];
  const spec = source.spec;
  if (spec.agentId && identity.agentId) selectors.push(`${spec.agentId}=eq.${enc(identity.agentId)}`);
  if (spec.rankingId && identity.rankingId) selectors.push(`${spec.rankingId}=eq.${enc(identity.rankingId)}`);
  if (spec.queueId && identity.queueIds.length) selectors.push(`${spec.queueId}=${inFilter(identity.queueIds)}`);
  if (spec.slug && identity.slug) selectors.push(`${spec.slug}=eq.${enc(identity.slug)}`);
  if (spec.phoneNormalized && identity.phoneNormalized) selectors.push(`${spec.phoneNormalized}=eq.${enc(identity.phoneNormalized)}`);
  if (spec.email && identity.email) selectors.push(`${spec.email}=ilike.${enc(identity.email)}`);
  if (spec.name && identity.name) selectors.push(`${spec.name}=ilike.${enc(identity.name)}`);
  return [...new Set(selectors)];
}

async function loadMatches(source, identity) {
  const selectors = selectorsFor(source, identity);
  if (!selectors.length) return [];
  const groups = await Promise.all(selectors.map((selector) => (
    supabaseRest(`${source.table}?${selector}&select=${source.select}&limit=1000`)
  )));
  const byId = new Map();
  for (const row of groups.flat()) {
    if (row?.id && identityMatches(row, identity, source.spec)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function uploadToStorage(path, buffer, contentType) {
  const url = clean(process.env.SUPABASE_URL, 2000).replace(/\/$/, '');
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 5000);
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  const response = await fetch(`${url}/storage/v1/object/${enc(PHOTO_BUCKET)}/${encodedStoragePath(path)}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': contentType,
      'Cache-Control': '31536000',
      'x-upsert': 'false'
    },
    body: buffer
  });
  const raw = await response.text().catch(() => '');
  if (!response.ok) {
    const error = new Error(raw || `Agent photo upload failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return `${url}/storage/v1/object/public/${enc(PHOTO_BUCKET)}/${encodedStoragePath(path)}`;
}

async function patchIds(table, rows, body) {
  const ids = [...new Set(rows.map((row) => cleanUuid(row.id)).filter(Boolean))];
  if (!ids.length) return [];
  const updated = await supabaseRest(`${table}?id=${inFilter(ids)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body)
  });
  return Array.isArray(updated) ? updated : [];
}

async function ensureCanonicalAgent(identity, matches, publicUrl) {
  if (matches.length) return matches;
  const created = await supabaseRest('agents', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      name: identity.name,
      phone: identity.phone || null,
      phone_normalized: identity.phoneNormalized || null,
      email: identity.email || null,
      brokerage: identity.brokerage || null,
      slug: identity.slug || null,
      image_url: publicUrl
    })
  });
  return Array.isArray(created) ? created : [];
}

async function recordPrimaryPhoto(agentId, photo) {
  if (!agentId) return;
  await supabaseRest(`agent_photos?agent_id=eq.${enc(agentId)}&is_primary=eq.true`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ is_primary: false, updated_at: photo.checkedAt })
  });
  await supabaseRest('agent_photos', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      agent_id: agentId,
      agent_name: photo.identity.name,
      brokerage: photo.identity.brokerage || null,
      source_domain: 'rel8tion-command',
      storage_bucket: PHOTO_BUCKET,
      storage_path: photo.path,
      public_url: photo.publicUrl,
      mime_type: photo.contentType,
      file_size_bytes: photo.size,
      width: photo.width || null,
      height: photo.height || null,
      status: 'primary',
      is_primary: true,
      manually_verified: true,
      checked_at: photo.checkedAt,
      updated_at: photo.checkedAt
    })
  });
}

async function uploadAndSyncAgentPhoto(input = {}) {
  const identity = normalizeIdentity(input.agent || input.identity || {});
  assertIdentity(identity);
  const buffer = decodePhoto(input.photo || input.dataUrl || input.base64);
  const image = detectImage(buffer);
  const path = storagePathFor(identity, image.extension);
  const publicUrl = await uploadToStorage(path, buffer, image.contentType);
  const checkedAt = new Date().toISOString();
  const loaded = await Promise.all(SOURCES.map((source) => loadMatches(source, identity)));
  const matches = Object.fromEntries(SOURCES.map((source, index) => [source.key, loaded[index]]));

  matches.agents = await ensureCanonicalAgent(identity, matches.agents, publicUrl);
  const canonicalAgent = matches.agents.find((row) => row.id === identity.agentId)
    || matches.agents.find((row) => row.slug && row.slug === identity.slug)
    || matches.agents[0]
    || null;

  const results = await Promise.all([
    patchIds('agents', matches.agents, { image_url: publicUrl }),
    patchIds('agent_outreach_queue', matches.outreach, { agent_photo_url: publicUrl }),
    patchIds('listing_agents', matches.listingAgents, {
      primary_photo_url: publicUrl,
      photo_enriched: true,
      photo_status: 'primary',
      photo_last_checked_at: checkedAt
    }),
    patchIds('agent_websites', matches.websites, { photo_url: publicUrl, updated_at: checkedAt }),
    patchIds('agent_relationships', matches.relationships, { photo_url: publicUrl, updated_at: checkedAt }),
    canonicalAgent ? patchIds('agent_rankings', matches.rankings, { agent_id: canonicalAgent.id, updated_at: checkedAt }) : []
  ]);

  await recordPrimaryPhoto(canonicalAgent?.id, {
    identity,
    path,
    publicUrl,
    contentType: image.contentType,
    size: buffer.length,
    width: Number(input.width) || null,
    height: Number(input.height) || null,
    checkedAt
  });

  return {
    publicUrl,
    bucket: PHOTO_BUCKET,
    path,
    agentId: canonicalAgent?.id || null,
    updated: {
      agents: results[0].length,
      outreach: results[1].length,
      listing_agents: results[2].length,
      websites: results[3].length,
      relationships: results[4].length,
      rankings: results[5].length
    }
  };
}

module.exports = {
  decodePhoto,
  detectImage,
  identityMatches,
  normalizeIdentity,
  uploadAndSyncAgentPhoto
};
