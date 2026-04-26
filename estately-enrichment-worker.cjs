const cheerio = require('cheerio');

const BATCH_SIZE = 10;
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
  return {
    url: requireEnv('SUPABASE_URL').replace(/\/$/, ''),
    key: requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function delayBetweenListings() {
  return sleep(500 + Math.floor(Math.random() * 501));
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
  if (direct.status === 200) {
    return { url: direct.url, html: direct.text, mode: 'direct' };
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
  return supabaseRequest(
    `open_houses?agent_scraped=eq.false&source=eq.onekey&select=*&order=open_start.asc.nullslast&limit=${BATCH_SIZE}`
  );
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

    await saveListingAgent(openHouse, agent);
    await markOpenHouse(openHouse.id, true);
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
