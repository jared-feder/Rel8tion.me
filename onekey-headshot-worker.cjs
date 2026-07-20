const cheerio = require('cheerio');

const ONEKEY = 'https://www.onekeymls.com';
const BUCKET = process.env.SUPABASE_HEADSHOT_BUCKET || 'enriched-photos';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function config() {
  return {
    url: required('SUPABASE_URL').replace(/\/$/, ''),
    key: required('SUPABASE_SERVICE_ROLE_KEY')
  };
}

function normalize(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeName(value) {
  return normalize(value).replace(/\b(mba|mrp|cbr|sfr|abr|gri|crs|sres|realtor|broker|associate|jr|sr)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}

function namesMatch(left, right) {
  const a = normalizeName(left).split(' ').filter(Boolean);
  const b = normalizeName(right).split(' ').filter(Boolean);
  if (a.join(' ') === b.join(' ')) return true;
  return a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function slug(value) {
  return normalize(value).replace(/\s+/g, '-');
}

function brokerageMatches(expected, pageText) {
  if (!expected) return true;
  const ignored = new Set(['realty', 'real', 'estate', 'properties', 'group', 'llc', 'inc', 'the', 'of', 'ny', 'rty', 'intl', 'rlty']);
  const tokens = (value) => normalize(value).split(' ').filter((part) => part.length > 2 && !ignored.has(part));
  const wanted = tokens(expected);
  const found = new Set(tokens(pageText));
  return wanted.length === 0 || wanted.filter((part) => found.has(part)).length / wanted.length >= 0.6;
}

function headers(extra = {}) {
  const { key } = config();
  return { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json', ...extra };
}

async function rest(path, options = {}) {
  const { url } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: headers({ 'Content-Type': 'application/json', ...(options.headers || {}) })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}

async function patch(table, filter, body) {
  return rest(`${table}?${filter}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body)
  });
}

function idFilter(ids) {
  return `id=in.(${ids.map((id) => encodeURIComponent(id)).join(',')})`;
}

async function upcomingTargets({ days = 14, limit = 8, dryRun = false } = {}) {
  const now = new Date();
  const end = new Date(now.getTime() + days * 86400000);
  const rows = await rest(
    `agent_outreach_queue?open_start=gte.${encodeURIComponent(now.toISOString())}` +
    `&open_start=lt.${encodeURIComponent(end.toISOString())}` +
    '&or=(agent_photo_url.is.null,agent_photo_url.eq.)' +
    '&select=id,agent_name,agent_phone,agent_phone_normalized,brokerage,open_start' +
    '&order=open_start.asc&limit=200'
  );

  const byPhone = new Map();
  for (const row of rows) {
    const phone = normalizePhone(row.agent_phone_normalized || row.agent_phone);
    if (!phone) continue;
    if (!byPhone.has(phone)) {
      byPhone.set(phone, { name: row.agent_name, phone, brokerage: row.brokerage || '', queueIds: [] });
    }
    byPhone.get(phone).queueIds.push(row.id);
  }

  const targets = [];
  const cooldown = new Date(now.getTime() - 24 * 3600000);
  for (const target of byPhone.values()) {
    const agents = await rest(
      `listing_agents?phone_normalized=eq.${encodeURIComponent(target.phone)}` +
      '&select=id,primary_photo_url,directory_photo_url,photo_last_checked_at&order=photo_last_checked_at.desc.nullslast&limit=10'
    );
    target.agentIds = agents.map((agent) => agent.id);
    const existing = agents.find((agent) => agent.primary_photo_url || agent.directory_photo_url);
    if (existing) {
      const url = existing.primary_photo_url || existing.directory_photo_url;
      if (!dryRun && target.queueIds.length) await patch('agent_outreach_queue', idFilter(target.queueIds), { agent_photo_url: url });
      continue;
    }
    const recentlyChecked = agents.some((agent) => agent.photo_last_checked_at && new Date(agent.photo_last_checked_at) > cooldown);
    if (!recentlyChecked) targets.push(target);
    if (targets.length >= limit) break;
  }
  return targets;
}

async function candidates(name) {
  const cleanName = normalizeName(name);
  const queries = [...new Set([cleanName.split(' ').pop(), cleanName])];
  const found = new Map();
  for (const query of queries) {
    const response = await fetch(`${ONEKEY}/api/autocomplete/agent?value=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/json', Referer: `${ONEKEY}/`, 'User-Agent': 'REL8TION headshot enrichment/1.0' },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`OneKey autocomplete ${response.status}`);
    const data = await response.json();
    const group = Array.isArray(data) ? data.find((entry) => entry?.CategoryName === 'Agent') : null;
    for (const candidate of group?.Results || []) {
      if (namesMatch(candidate.MemberFullName, name)) found.set(candidate.UniqueListingId || candidate._id, candidate);
    }
  }
  return [...found.values()];
}

function profileUrl(candidate) {
  const office = candidate.OfficeMetadata || {};
  if (!office.OfficeCity || !office.OfficeStateOrProvince || !candidate.UniqueListingIdHash) return '';
  return `${ONEKEY}/real-estate-agents/${slug(office.OfficeCity)}-${slug(office.OfficeStateOrProvince)}/${slug(candidate.MemberFullName)}-${candidate.UniqueListingIdHash}`;
}

async function verifiedProfile(candidate, target) {
  const url = profileUrl(candidate);
  if (!url) return null;
  const response = await fetch(url, {
    headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) return null;
  const html = await response.text();
  const text = cheerio.load(html).text();
  const phoneMatch = text.replace(/\D/g, '').includes(target.phone);
  const brokerageMatch = brokerageMatches(target.brokerage, text);
  if (!phoneMatch) return null;

  const memberId = String(candidate.UniqueListingId || candidate._id || '').replace(/[^A-Za-z0-9-]/g, '');
  if (!memberId) return null;
  const escaped = memberId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`https://[^"'<>\\s]+/mlsgrid/onekey/member/${escaped}/[^"'<>\\s?]+\\.(?:webp|jpe?g|png)`, 'i'));
  return match ? { profileUrl: url, imageUrl: match[0].replace(/&amp;/g, '&'), brokerageMatch } : null;
}

async function persist(target, match) {
  const image = await fetch(match.imageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(20000)
  });
  if (!image.ok) throw new Error(`Headshot download ${image.status}`);
  const contentType = image.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) throw new Error(`Unexpected headshot type: ${contentType}`);
  const buffer = Buffer.from(await image.arrayBuffer());
  if (buffer.length < 3000 || buffer.length > 5_000_000) throw new Error(`Unexpected headshot size: ${buffer.length}`);
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  const path = `outreach/${target.phone}/${Date.now()}.${ext}`;
  const { url, key } = config();
  const upload = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': contentType, 'x-upsert': 'false' },
    body: buffer
  });
  if (!upload.ok) throw new Error(`Headshot upload ${upload.status}: ${await upload.text()}`);
  const publicUrl = `${url}/storage/v1/object/public/${BUCKET}/${path}`;
  const checkedAt = new Date().toISOString();
  if (target.agentIds.length) {
    await patch('listing_agents', idFilter(target.agentIds), {
      primary_photo_url: publicUrl,
      photo_enriched: true,
      photo_status: 'primary',
      photo_last_checked_at: checkedAt,
      photo_source_page_url: match.profileUrl
    });
  }
  const queue = target.queueIds.length
    ? await patch('agent_outreach_queue', idFilter(target.queueIds), { agent_photo_url: publicUrl })
    : [];
  return { publicUrl, queueRows: queue.length };
}

async function markChecked(target, status) {
  if (!target.agentIds.length) return;
  await patch('listing_agents', idFilter(target.agentIds), {
    photo_status: status,
    photo_last_checked_at: new Date().toISOString()
  });
}

async function run(options = {}) {
  const targets = await upcomingTargets(options);
  const dryRun = Boolean(options.dryRun);
  const result = { dryRun, checked: 0, enriched: 0, queueRowsUpdated: 0, notFound: 0, matches: [], errors: [] };
  for (const target of targets) {
    result.checked += 1;
    try {
      let match = null;
      for (const candidate of await candidates(target.name)) {
        match = await verifiedProfile(candidate, target);
        if (match) break;
      }
      if (!match) {
        result.notFound += 1;
        if (!dryRun) await markChecked(target, 'not_found');
        continue;
      }
      result.matches.push({ name: target.name, phone: target.phone, brokerageMatch: match.brokerageMatch, profileUrl: match.profileUrl });
      if (dryRun) {
        result.enriched += 1;
        continue;
      }
      const saved = await persist(target, match);
      result.enriched += 1;
      result.queueRowsUpdated += saved.queueRows;
    } catch (error) {
      result.errors.push({ phone: target.phone, message: error.message });
    }
  }
  return result;
}

module.exports = { run };
