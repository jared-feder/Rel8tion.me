const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_LOOKAHEAD_DAYS = 10;
const DEFAULT_STALE_HOURS = 6;
const DEFAULT_SEARCH_RADIUS = 0.08;
const ONEKEY_BASE_URL = 'https://www.onekeymls.com/api/search';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function readConfig(options = {}) {
  const url = requireEnv('SUPABASE_URL').replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    throw new Error('Invalid SUPABASE_URL environment variable. Expected https://PROJECT_REF.supabase.co');
  }

  const dryRun = options.dryRun === true || process.env.ONEKEY_FRESHNESS_DRY_RUN === 'true';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const key = serviceKey || (dryRun ? anonKey : null);
  if (!key) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY. Dry runs may use SUPABASE_ANON_KEY.');
  }

  return {
    url,
    key,
    dryRun,
    batchSize: positiveInt(options.batchSize || process.env.ONEKEY_FRESHNESS_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    lookaheadDays: positiveInt(options.lookaheadDays || process.env.ONEKEY_FRESHNESS_LOOKAHEAD_DAYS, DEFAULT_LOOKAHEAD_DAYS),
    staleHours: positiveInt(options.staleHours || process.env.ONEKEY_FRESHNESS_STALE_HOURS, DEFAULT_STALE_HOURS),
    searchRadius: positiveNumber(options.searchRadius || process.env.ONEKEY_FRESHNESS_SEARCH_RADIUS, DEFAULT_SEARCH_RADIUS)
  };
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function restHeaders(config, extra = {}) {
  return {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function supabaseRequest(config, path, options = {}) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: restHeaders(config, options.headers || {})
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(text || `Supabase request failed: ${response.status}`);
    error.status = response.status;
    error.body = text;
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

function isMissingColumnError(error) {
  return /PGRST204|column .* does not exist|schema cache/i.test(String(error?.body || error?.message || ''));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function delayBetweenListings() {
  return sleep(300 + Math.floor(Math.random() * 301));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAddress(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(?:apt|apartment|unit|suite|ste|#)\s*[a-z0-9-]+\b/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:ny|new|york|street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|unit)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameAddress(a, b) {
  const left = normalizeAddress(a);
  const right = normalizeAddress(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function extractAgentName(record) {
  return (
    record?.Listing?.ListAgent?.FullName ||
    record?.Listing?.ListAgent?.MemberFullName ||
    record?.Listing?.ListAgent?.Name ||
    record?.Listing?.Agent?.FullName ||
    record?.Listing?.Agent?.Name ||
    record?.ListingAgentName ||
    record?.ListAgentFullName ||
    record?.ListAgentName ||
    null
  );
}

function mapOneKeyRecord(record) {
  if (!record) return null;
  return {
    id: record.UniqueListingId || null,
    address: record.DisplayName || null,
    price: numberOrNull(record.Listing?.Price?.ListPrice),
    beds: numberOrNull(record.Structure?.BedroomsTotal || record.Computed?.BedroomsTotalInteger),
    baths: numberOrNull(record.Structure?.BathroomsTotalInteger || record.Computed?.BathroomsTotalInteger),
    sqft: numberOrNull(record.Structure?.LivingArea || record.Computed?.LivingAreaSquareFeet),
    brokerage: record.Listing?.AgentOffice?.ListOffice?.ListOfficeName || null,
    agent: extractAgentName(record),
    lat: numberOrNull(record.LocationPoint?.lat),
    lng: numberOrNull(record.LocationPoint?.lon),
    open_start: record.Computed?.OpenHousesEarliestStartTime || null,
    open_end: record.Computed?.OpenHousesEarliestEndTime || null,
    image: record.Media?.[0]?.MediaURL || record.Media?.[1]?.MediaURL || record.ImagesHero || record.MediaURL || null,
    listing_status: record.Listing?.StandardStatus || null,
    price_change_amount: numberOrNull(record.Computed?.PriceChangeAmount),
    price_change_percentage: numberOrNull(record.Computed?.PriceChangePercentage),
    price_change_type: record.Computed?.PriceChangeType || null,
    raw: record
  };
}

function sourceSnapshot(remote) {
  if (!remote) return {};
  return {
    id: remote.id,
    address: remote.address,
    price: remote.price,
    beds: remote.beds,
    baths: remote.baths,
    sqft: remote.sqft,
    brokerage: remote.brokerage,
    image: remote.image,
    listing_status: remote.listing_status,
    price_change_amount: remote.price_change_amount,
    price_change_percentage: remote.price_change_percentage,
    price_change_type: remote.price_change_type,
    open_start: remote.open_start,
    open_end: remote.open_end
  };
}

function bboxForListing(openHouse, radius) {
  const lat = numberOrNull(openHouse.lat);
  const lng = numberOrNull(openHouse.lng);
  if (lat === null || lng === null) return null;
  return {
    topLeft: `[${(lng - radius).toFixed(6)},${(lat + radius).toFixed(6)}]`,
    bottomRight: `[${(lng + radius).toFixed(6)},${(lat - radius).toFixed(6)}]`
  };
}

async function fetchOneKeySearch(box, offset = 0) {
  const url = `${ONEKEY_BASE_URL}?topLeft=${encodeURIComponent(box.topLeft)}&bottomRight=${encodeURIComponent(box.bottomRight)}&propertySaleType=Sale&StateOrProvince=NY&offset=${offset}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': 'Mozilla/5.0 (compatible; Rel8tionListingFreshness/1.0)'
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `OneKey request failed: ${response.status}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`OneKey returned invalid JSON: ${error.message}`);
  }
}

async function findCurrentOneKeyRecord(openHouse, config) {
  const box = bboxForListing(openHouse, config.searchRadius);
  if (!box) return { remote: null, reason: 'missing_coordinates' };

  const maxOffsets = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900];
  let bestAddressMatch = null;

  for (const offset of maxOffsets) {
    const data = await fetchOneKeySearch(box, offset);
    const results = Array.isArray(data?.Results) ? data.Results : [];
    if (!results.length) break;

    const exact = results.find((row) => String(row.UniqueListingId || '') === String(openHouse.id));
    if (exact) return { remote: mapOneKeyRecord(exact), reason: 'exact_id_match' };

    if (!bestAddressMatch) {
      bestAddressMatch = results.find((row) => sameAddress(row.DisplayName, openHouse.address));
    }

    const total = Number(data?.Total || 0);
    if (total && offset + results.length >= total) break;
  }

  if (bestAddressMatch) return { remote: mapOneKeyRecord(bestAddressMatch), reason: 'address_match' };
  return { remote: null, reason: 'source_listing_not_found' };
}

async function getActiveOpenHouseIds(config) {
  try {
    const rows = await supabaseRequest(
      config,
      'open_house_events?status=eq.active&open_house_source_id=not.is.null&select=open_house_source_id&limit=50'
    );
    return new Set((Array.isArray(rows) ? rows : []).map((row) => row.open_house_source_id).filter(Boolean));
  } catch (error) {
    console.log(`[onekey-freshness] active event lookup skipped: ${error.message || error}`);
    return new Set();
  }
}

async function getOpenHouseById(config, id) {
  const rows = await supabaseRequest(
    config,
    `open_houses?id=eq.${encodeURIComponent(id)}&select=*&limit=1`
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function getCandidateOpenHouses(config, options = {}) {
  if (options.ids?.length) {
    const selected = [];
    for (const id of options.ids.slice(0, config.batchSize)) {
      const row = await getOpenHouseById(config, id);
      if (row) selected.push(row);
    }
    return selected;
  }

  const now = new Date();
  const fromIso = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
  const toIso = new Date(now.getTime() + config.lookaheadDays * 24 * 60 * 60 * 1000).toISOString();
  const staleIso = new Date(now.getTime() - config.staleHours * 60 * 60 * 1000).toISOString();
  const activeIds = await getActiveOpenHouseIds(config);
  const candidates = [];

  for (const id of activeIds) {
    if (candidates.length >= config.batchSize) break;
    const row = await getOpenHouseById(config, id);
    if (row?.source === 'onekey') candidates.push(row);
  }

  const remaining = Math.max(config.batchSize - candidates.length, 0);
  if (!remaining) return candidates;

  try {
    const rows = await supabaseRequest(
      config,
      [
        'open_houses?source=eq.onekey',
        `open_start=gte.${encodeURIComponent(fromIso)}`,
        `open_start=lte.${encodeURIComponent(toIso)}`,
        `or=(last_verified_at.is.null,last_verified_at.lt.${encodeURIComponent(staleIso)})`,
        'select=*',
        'order=open_start.asc.nullslast',
        `limit=${remaining}`
      ].join('&')
    );
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!candidates.some((candidate) => candidate.id === row.id)) candidates.push(row);
    }
    return candidates;
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    console.log('[onekey-freshness] freshness columns missing; using basic upcoming query');
  }

  const rows = await supabaseRequest(
    config,
    [
      'open_houses?source=eq.onekey',
      `open_start=gte.${encodeURIComponent(fromIso)}`,
      `open_start=lte.${encodeURIComponent(toIso)}`,
      'select=*',
      'order=open_start.asc.nullslast',
      `limit=${remaining}`
    ].join('&')
  );

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!candidates.some((candidate) => candidate.id === row.id)) candidates.push(row);
  }
  return candidates;
}

function patchWithoutUndefined(patch) {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
}

function buildOpenHousePatch(openHouse, remote, nowIso) {
  const oldPrice = numberOrNull(openHouse.price);
  const sourcePrice = numberOrNull(remote?.price);
  const manualOverride = numberOrNull(openHouse.manual_price_override);
  const hasManualOverride = manualOverride !== null;
  const sourceChanged = sourcePrice !== null && oldPrice !== null && oldPrice !== sourcePrice;
  const displayPrice = hasManualOverride ? manualOverride : sourcePrice;

  const patch = {
    last_verified_at: nowIso,
    last_verified_source: 'onekey',
    source_price: sourcePrice,
    source_price_verified_at: nowIso,
    freshness_status: hasManualOverride && sourceChanged ? 'manual_override_active' : sourceChanged ? 'price_changed' : 'verified',
    freshness_notes: {
      one_key_reason: remote?._matchReason || 'exact_id_match',
      listing_status: remote?.listing_status || null,
      price_change_amount: remote?.price_change_amount ?? null,
      price_change_percentage: remote?.price_change_percentage ?? null,
      price_change_type: remote?.price_change_type || null,
      source_open_start: remote?.open_start || null,
      source_open_end: remote?.open_end || null,
      checked_at: nowIso
    },
    brokerage: remote?.brokerage || openHouse.brokerage || null,
    beds: remote?.beds ?? openHouse.beds ?? null,
    baths: remote?.baths ?? openHouse.baths ?? null,
    sqft: remote?.sqft ?? openHouse.sqft ?? null,
    image: remote?.image || openHouse.image || null,
    lat: remote?.lat ?? openHouse.lat ?? null,
    lng: remote?.lng ?? openHouse.lng ?? null,
    updated_at: nowIso
  };

  if (displayPrice !== null && oldPrice !== displayPrice) {
    patch.price = displayPrice;
    patch.price_last_changed_at = nowIso;
  }

  return patchWithoutUndefined(patch);
}

async function patchOpenHouse(config, openHouseId, patch) {
  if (config.dryRun) return { dryRun: true, patch };

  try {
    return await supabaseRequest(config, `open_houses?id=eq.${encodeURIComponent(openHouseId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch)
    });
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    const fallback = { ...patch };
    delete fallback.last_verified_at;
    delete fallback.last_verified_source;
    delete fallback.source_price;
    delete fallback.source_price_verified_at;
    delete fallback.price_last_changed_at;
    delete fallback.manual_price_override;
    delete fallback.manual_price_override_at;
    delete fallback.manual_price_override_by;
    delete fallback.freshness_status;
    delete fallback.freshness_notes;
    return supabaseRequest(config, `open_houses?id=eq.${encodeURIComponent(openHouseId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(fallback)
    });
  }
}

async function insertPriceHistory(config, openHouse, remote, patch, reason) {
  if (config.dryRun) return { dryRun: true };
  if (!Object.prototype.hasOwnProperty.call(patch, 'price')) return null;
  if (numberOrNull(openHouse.price) === numberOrNull(patch.price)) return null;

  try {
    return await supabaseRequest(config, 'open_house_price_history', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        open_house_id: openHouse.id,
        old_price: numberOrNull(openHouse.price),
        new_price: numberOrNull(patch.price),
        source_price: numberOrNull(remote?.price),
        displayed_price: numberOrNull(patch.price),
        source: 'onekey',
        change_reason: reason,
        source_snapshot: sourceSnapshot(remote),
        detected_at: patch.price_last_changed_at || new Date().toISOString()
      })
    });
  } catch (error) {
    if (isMissingColumnError(error) || /open_house_price_history/i.test(String(error?.body || error?.message || ''))) {
      console.log(`[onekey-freshness] price history table unavailable for ${openHouse.id}`);
      return null;
    }
    throw error;
  }
}

async function updateActiveEventSnapshots(config, openHouseId, displayPrice, sourcePrice) {
  if (displayPrice === null || displayPrice === undefined || config.dryRun) return { dryRun: config.dryRun };

  const events = await supabaseRequest(
    config,
    `open_house_events?open_house_source_id=eq.${encodeURIComponent(openHouseId)}&status=eq.active&select=id,setup_context`
  ).catch(() => []);

  const updated = [];
  for (const event of Array.isArray(events) ? events : []) {
    const setupContext = event.setup_context && typeof event.setup_context === 'object' ? { ...event.setup_context } : {};
    if (numberOrNull(setupContext.price) === numberOrNull(displayPrice)) continue;
    setupContext.price = displayPrice;
    setupContext.source_price = sourcePrice ?? null;
    setupContext.price_refreshed_at = new Date().toISOString();
    await supabaseRequest(config, `open_house_events?id=eq.${encodeURIComponent(event.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ setup_context: setupContext })
    });
    updated.push(event.id);
  }
  return { updated };
}

async function markFreshnessFailure(config, openHouse, status, reason, nowIso) {
  const patch = {
    last_verified_at: nowIso,
    last_verified_source: 'onekey',
    freshness_status: status,
    freshness_notes: {
      reason,
      checked_at: nowIso
    },
    updated_at: nowIso
  };

  try {
    await patchOpenHouse(config, openHouse.id, patch);
  } catch (error) {
    console.log(`[onekey-freshness] could not mark ${openHouse.id} ${status}: ${error.message || error}`);
  }
}

async function processOpenHouse(config, openHouse) {
  const nowIso = new Date().toISOString();
  const label = `${openHouse.id} ${openHouse.address || ''}`.trim();
  console.log(`[onekey-freshness] checking ${label}`);

  try {
    const { remote, reason } = await findCurrentOneKeyRecord(openHouse, config);
    if (!remote) {
      await markFreshnessFailure(config, openHouse, reason, reason, nowIso);
      return { id: openHouse.id, ok: false, reason };
    }
    remote._matchReason = reason;

    const patch = buildOpenHousePatch(openHouse, remote, nowIso);
    const oldPrice = numberOrNull(openHouse.price);
    const patchIncludesPrice = Object.prototype.hasOwnProperty.call(patch, 'price');
    const nextPrice = numberOrNull(patchIncludesPrice ? patch.price : openHouse.price);
    const sourcePrice = numberOrNull(remote.price);
    const priceChanged = patchIncludesPrice && nextPrice !== null && oldPrice !== nextPrice;
    const manualOverride = numberOrNull(openHouse.manual_price_override) !== null;
    const changeReason = manualOverride ? 'manual_override_refreshed_source_price' : 'source_price_changed';

    await insertPriceHistory(config, openHouse, remote, patch, changeReason);
    await patchOpenHouse(config, openHouse.id, patch);
    await updateActiveEventSnapshots(config, openHouse.id, nextPrice, sourcePrice);

    console.log(
      `[onekey-freshness] ${priceChanged ? 'updated' : 'verified'} ${label}: old=${oldPrice || 'null'} source=${sourcePrice || 'null'} display=${nextPrice || oldPrice || 'null'}`
    );

    return {
      id: openHouse.id,
      ok: true,
      match: reason,
      priceChanged,
      oldPrice,
      sourcePrice,
      displayPrice: nextPrice ?? oldPrice
    };
  } catch (error) {
    console.error(`[onekey-freshness] failed ${label}:`, error.message || error);
    await markFreshnessFailure(config, openHouse, 'source_error', error.message || 'unknown_error', nowIso);
    return { id: openHouse.id, ok: false, reason: error.message || 'unknown_error' };
  }
}

async function run(options = {}) {
  const config = readConfig(options);
  const listings = await getCandidateOpenHouses(config, options);
  const batch = Array.isArray(listings) ? listings.slice(0, config.batchSize) : [];
  const results = [];

  console.log(`[onekey-freshness] started dryRun=${config.dryRun} batch=${batch.length}`);

  for (const listing of batch) {
    results.push(await processOpenHouse(config, listing));
    await delayBetweenListings();
  }

  const changed = results.filter((result) => result.priceChanged).length;
  console.log(`[onekey-freshness] complete processed=${results.length} priceChanged=${changed}`);

  return {
    ok: true,
    dryRun: config.dryRun,
    processed: results.length,
    priceChanged: changed,
    results
  };
}

function parseCliArgs(argv) {
  const ids = [];
  const options = {};
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    if (arg.startsWith('--id=')) ids.push(arg.slice('--id='.length));
    if (arg.startsWith('--batch=')) options.batchSize = Number(arg.slice('--batch='.length));
  }
  if (ids.length) options.ids = ids;
  return options;
}

if (require.main === module) {
  run(parseCliArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error.message || error);
      process.exitCode = 1;
    });
}

module.exports = {
  run,
  findCurrentOneKeyRecord,
  mapOneKeyRecord,
  buildOpenHousePatch
};
