const cheerio = require('cheerio');

const BATCH_SIZE = 20;
const ESTATELY_BASE_URL = 'https://www.estately.com';
const SOURCE_PRIORITY = {
  onekey: 1,
  estately: 2
};

const STREET_ABBREVIATIONS = new Map([
  ['ave', 'avenue'],
  ['av', 'avenue'],
  ['blvd', 'boulevard'],
  ['cir', 'circle'],
  ['ct', 'court'],
  ['dr', 'drive'],
  ['hwy', 'highway'],
  ['ln', 'lane'],
  ['pkwy', 'parkway'],
  ['pl', 'place'],
  ['rd', 'road'],
  ['st', 'street'],
  ['ter', 'terrace'],
  ['trl', 'trail']
]);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function supabaseConfig() {
  const url = requireEnv('SUPABASE_URL').replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    throw new Error('Invalid SUPABASE_URL environment variable. Expected https://PROJECT_REF.supabase.co');
  }

  return {
    url,
    key: requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function delayBetweenListings() {
  return sleep(500 + Math.floor(Math.random() * 501));
}

function newYorkDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value)
  };
}

function nextWeekendWindow(date = new Date()) {
  const { year, month, day } = newYorkDateParts(date);
  const todayUtc = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = todayUtc.getUTCDay();
  const daysUntilSaturday = dayOfWeek === 0 ? -1 : (6 - dayOfWeek + 7) % 7;
  const start = new Date(Date.UTC(year, month - 1, day + daysUntilSaturday));
  const end = new Date(Date.UTC(year, month - 1, day + daysUntilSaturday + 2));

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString()
  };
}

function restHeaders(extra = {}) {
  const { key } = supabaseConfig();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function supabaseRequest(path, options = {}) {
  const { url } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: restHeaders(options.headers || {})
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Supabase request failed: ${response.status}`);
  }
  return text ? JSON.parse(text) : null;
}

function stripUnit(address) {
  return String(address || '')
    .replace(/\b(?:apt|apartment|unit|suite|ste|#)\s*[a-z0-9-]+\b/gi, '')
    .replace(/\s+#\s*[a-z0-9-]+\b/gi, '')
    .replace(/\b(?:floor|fl)\s*\d+\b/gi, '');
}

function normalizeAddressForEstately(address) {
  const expanded = stripUnit(address)
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => STREET_ABBREVIATIONS.get(part) || part)
    .join(' ');

  return expanded
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function addressParts(address) {
  const value = String(address || '');
  const zip = value.match(/\b\d{5}(?:-\d{4})?\b/)?.[0]?.slice(0, 5) || null;
  const state = value.match(/,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/)?.[1]?.toLowerCase() || null;
  const streetNumber = value.match(/^\s*(\d+[a-z]?)/i)?.[1]?.toLowerCase() || null;
  const commaParts = value.split(',').map((part) => part.trim()).filter(Boolean);
  const city = commaParts.length >= 3 ? commaParts[commaParts.length - 2] : null;

  return {
    city,
    state,
    streetNumber,
    zip
  };
}

function estatelyUrlMatchesAddress(url, address) {
  const { city, state, streetNumber, zip } = addressParts(address);
  const slug = normalizeAddressForEstately(decodeURIComponent(new URL(url).pathname.split('/').pop() || ''));

  if (!slug) return false;
  if (zip && !slug.includes(zip)) return false;
  if (state && !slug.split('-').includes(state)) return false;
  if (streetNumber && !slug.split('-').includes(streetNumber)) return false;

  if (city) {
    const cityTokens = normalizeAddressForEstately(city).split('-').filter(Boolean);
    if (cityTokens.length && !cityTokens.every((token) => slug.split('-').includes(token))) {
      return false;
    }
  }

  return true;
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Rel8tionAgentEnrichment/1.0)',
      Accept: 'text/html,application/xhtml+xml'
    },
    redirect: 'follow'
  });
  const text = await response.text().catch(() => '');
  return { status: response.status, url: response.url || url, text };
}

async function resolveEstatelyPage(address) {
  const normalized = normalizeAddressForEstately(address);
  if (!normalized) return null;

  const directUrl = `${ESTATELY_BASE_URL}/listings/info/${normalized}`;
  const direct = await fetchText(directUrl);
  if (direct.status === 200 && estatelyUrlMatchesAddress(direct.url, address)) {
    return { url: direct.url, html: direct.text, mode: 'direct' };
  }
  if (direct.status === 200) {
    console.log(`[estately] rejected direct mismatch for ${address}: ${direct.url}`);
  }

  const searchUrl = `${ESTATELY_BASE_URL}/search?search=${encodeURIComponent(address)}`;
  const search = await fetchText(searchUrl);
  if (search.status !== 200) return null;

  const $ = cheerio.load(search.text);
  const href = $('a[href*="/listings/info/"]')
    .map((_, element) => $(element).attr('href'))
    .get()
    .find(Boolean);

  if (!href) return null;
  const finalUrl = new URL(href, ESTATELY_BASE_URL).toString();
  if (!estatelyUrlMatchesAddress(finalUrl, address)) {
    console.log(`[estately] rejected search fallback mismatch for ${address}: ${finalUrl}`);
    return null;
  }

  const finalPage = await fetchText(finalUrl);
  if (finalPage.status !== 200) return null;
  return { url: finalPage.url, html: finalPage.text, mode: 'search' };
}

function extractAgentInfo(html) {
  const $ = cheerio.load(html);
  let panel = null;

  $('div.panel').each((_, element) => {
    const text = cleanText($(element).text()).toLowerCase();
    if (!panel && text.includes('listing provided by')) {
      panel = $(element);
    }
  });

  if (!panel) return null;

  const paragraphs = panel.find('p').map((_, element) => cleanText($(element).text())).get().filter(Boolean);
  const phone = panel.find('a[href^="tel:"]').first().attr('href') || panel.find('a[href*="tel:"]').first().text();
  const phoneNormalized = normalizePhone(phone);

  return {
    name: paragraphs[0] || null,
    brokerage: paragraphs[1] || null,
    phone: phone ? cleanText(phone.replace(/^tel:/i, '')) : null,
    phone_normalized: phoneNormalized
  };
}

async function getPendingOpenHouses() {
  const now = new Date();
  const nowIso = now.toISOString();
  const nextWindowIso = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const weekendWindow = nextWeekendWindow(now);

  const weekend = await supabaseRequest(
    [
      'open_houses?agent_scraped=eq.false',
      'source=eq.onekey',
      `open_start=gte.${encodeURIComponent(weekendWindow.startIso)}`,
      `open_start=lt.${encodeURIComponent(weekendWindow.endIso)}`,
      'select=*',
      'order=open_start.asc.nullslast',
      `limit=${BATCH_SIZE}`
    ].join('&')
  );

  if (Array.isArray(weekend) && weekend.length > 0) {
    console.log(`[estately] selected ${weekend.length} next-weekend open houses for enrichment`);
    return weekend;
  }

  const upcoming = await supabaseRequest(
    [
      'open_houses?agent_scraped=eq.false',
      'source=eq.onekey',
      `open_end=gte.${encodeURIComponent(nowIso)}`,
      `open_start=lte.${encodeURIComponent(nextWindowIso)}`,
      'select=*',
      'order=open_start.asc.nullslast',
      `limit=${BATCH_SIZE}`
    ].join('&')
  );

  if (Array.isArray(upcoming) && upcoming.length > 0) {
    console.log(`[estately] selected ${upcoming.length} upcoming open houses for enrichment`);
    return upcoming;
  }

  console.log('[estately] no upcoming open houses pending enrichment; falling back to prior backlog');
  return supabaseRequest(
    `open_houses?agent_scraped=eq.false&source=eq.onekey&select=*&order=open_start.asc.nullslast&limit=${BATCH_SIZE}`
  );
}

async function refreshOutreachQueue() {
  return supabaseRequest('rpc/queue_recent_outreach_candidates', {
    method: 'POST',
    body: JSON.stringify({})
  });
}

async function triggerOutreachGeneration(limit = BATCH_SIZE) {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/functions/v1/generate-agent-outreach`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ limit })
  });

  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(text || `generate-agent-outreach failed: ${response.status}`);
  }

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

async function hasPriorPhoneFailure(phoneNormalized) {
  if (!phoneNormalized) return false;

  const rows = await supabaseRequest(
    [
      'agent_outreach_queue?select=id',
      `agent_phone_normalized=eq.${encodeURIComponent(phoneNormalized)}`,
      'or=(initial_send_status.eq.blocked_invalid_mobile,followup_send_status.eq.blocked_invalid_mobile,initial_block_reason.eq.invalid_mobile,followup_block_reason.eq.invalid_mobile,initial_block_reason.eq.invalid_phone,followup_block_reason.eq.invalid_phone)',
      'limit=1'
    ].join('&')
  );

  return Array.isArray(rows) && rows.length > 0;
}

async function findExistingAgent(openHouseId, phoneNormalized) {
  const rows = await supabaseRequest(
    `listing_agents?open_house_id=eq.${encodeURIComponent(openHouseId)}&phone_normalized=eq.${encodeURIComponent(phoneNormalized)}&select=*&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function sourceRank(source) {
  return SOURCE_PRIORITY[String(source || '').toLowerCase()] || 0;
}

function mergeAgent(existing, scraped) {
  const next = {};

  if (!existing?.name && scraped.name) next.name = scraped.name;
  if (!existing?.brokerage && scraped.brokerage) next.brokerage = scraped.brokerage;
  if (!existing?.phone && scraped.phone) next.phone = scraped.phone;

  if (!existing || sourceRank(existing.source) < sourceRank('estately')) {
    next.source = 'estately';
  }

  return next;
}

async function saveListingAgent(openHouse, agent) {
  const scraped = {
    open_house_id: openHouse.id,
    name: agent.name,
    brokerage: agent.brokerage,
    phone: agent.phone,
    phone_normalized: agent.phone_normalized,
    source: 'estately'
  };

  const existing = await findExistingAgent(openHouse.id, agent.phone_normalized);
  if (existing) {
    const patch = mergeAgent(existing, scraped);
    if (!Object.keys(patch).length) return existing;
    const rows = await supabaseRequest(
      `listing_agents?open_house_id=eq.${encodeURIComponent(openHouse.id)}&phone_normalized=eq.${encodeURIComponent(agent.phone_normalized)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(patch)
      }
    );
    return Array.isArray(rows) ? rows[0] : existing;
  }

  const rows = await supabaseRequest('listing_agents', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(scraped)
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function markOpenHouse(openHouseId, enriched) {
  await supabaseRequest(`open_houses?id=eq.${encodeURIComponent(openHouseId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      agent_scraped: true,
      agent_enriched: enriched === true
    })
  });
}

async function updateOpenHouseAgent(openHouse, agent) {
  const patch = {
    agent_scraped: true,
    agent_enriched: true
  };

  if (!openHouse.agent && agent.name) patch.agent = agent.name;
  if (!openHouse.agent_phone && agent.phone) patch.agent_phone = agent.phone;

  await supabaseRequest(`open_houses?id=eq.${encodeURIComponent(openHouse.id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
}

async function processOpenHouse(openHouse) {
  const label = `${openHouse.id} ${openHouse.address || ''}`.trim();
  console.log(`[estately] processing ${label}`);

  try {
    const page = await resolveEstatelyPage(openHouse.address || '');
    if (!page?.html) {
      console.log(`[estately] no page found for ${label}`);
      await markOpenHouse(openHouse.id, false);
      return { id: openHouse.id, saved: false, reason: 'page_not_found' };
    }

    const agent = extractAgentInfo(page.html);
    if (!agent?.phone_normalized) {
      console.log(`[estately] no valid agent phone for ${label}`);
      await markOpenHouse(openHouse.id, false);
      return { id: openHouse.id, saved: false, reason: 'missing_phone', url: page.url };
    }

    if (await hasPriorPhoneFailure(agent.phone_normalized)) {
      console.log(`[estately] rejected known non-mobile phone ${agent.phone_normalized} for ${label}`);
      await markOpenHouse(openHouse.id, false);
      return { id: openHouse.id, saved: false, reason: 'known_non_mobile_phone', url: page.url };
    }

    await saveListingAgent(openHouse, agent);
    await updateOpenHouseAgent(openHouse, agent);
    console.log(`[estately] saved ${agent.name || 'agent'} ${agent.phone_normalized} for ${label}`);
    return { id: openHouse.id, saved: true, url: page.url, mode: page.mode };
  } catch (error) {
    console.error(`[estately] failed ${label}:`, error.message || error);
    await markOpenHouse(openHouse.id, false).catch((markError) => {
      console.error(`[estately] failed marking ${label}:`, markError.message || markError);
    });
    return { id: openHouse.id, saved: false, reason: error.message || 'unknown_error' };
  }
}

async function run() {
  console.log('[estately] enrichment run started');
  const listings = await getPendingOpenHouses();
  const batch = Array.isArray(listings) ? listings.slice(0, BATCH_SIZE) : [];
  const results = [];

  for (const listing of batch) {
    results.push(await processOpenHouse(listing));
    await delayBetweenListings();
  }

  if (results.some((result) => result.saved)) {
    try {
      await refreshOutreachQueue();
      console.log('[estately] outreach queue refresh complete');
      const generation = await triggerOutreachGeneration(BATCH_SIZE);
      console.log('[estately] outreach generation trigger complete:', JSON.stringify(generation));
    } catch (error) {
      console.error('[estately] outreach follow-up failed:', error.message || error);
    }
  }

  console.log(`[estately] enrichment run complete: ${results.length} processed`);
  return {
    ok: true,
    processed: results.length,
    saved: results.filter((result) => result.saved).length,
    results
  };
}

module.exports = {
  run,
  normalizeAddressForEstately,
  extractAgentInfo
};
