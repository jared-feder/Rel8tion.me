const { sendJson, supabaseRest } = require('../lib/admin-auth');

const ONEKEY_PROPERTY_IMAGES_URL = 'https://www.onekeymls.com/api/property-images';
const ONEKEY_SEARCH_URL = 'https://www.onekeymls.com/api/search';
const MAX_PROPERTY_IMAGES = 50;
const PROPERTY_PROFILE_STALE_MS = 6 * 60 * 60 * 1000;

function first(rows) {
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function readQuery(req, name) {
  const value = req.query?.[name];
  if (Array.isArray(value)) return value[0] || '';
  if (value) return value;

  try {
    const url = new URL(req.url || '', 'https://rel8tion.local');
    return url.searchParams.get(name) || '';
  } catch {
    return '';
  }
}

function readHeader(req, name) {
  return req.headers?.[name] || req.headers?.[name.toLowerCase()] || req.headers?.[name.toUpperCase()] || '';
}

function requestOrigin(req) {
  const host = readHeader(req, 'x-forwarded-host') || readHeader(req, 'host') || 'app.rel8tion.me';
  const proto = readHeader(req, 'x-forwarded-proto') || 'https';
  return `${proto}://${host}`;
}

function cleanId(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .slice(0, 120);
}

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function validExternalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function uniqueExternalUrls(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map(validExternalUrl)
    .filter(Boolean)
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .slice(0, MAX_PROPERTY_IMAGES);
}

function collectDeepValues(value, keyPattern, depth = 0, output = []) {
  if (depth > 8 || value == null || output.length >= 80) return output;
  if (Array.isArray(value)) {
    value.forEach((item) => collectDeepValues(item, keyPattern, depth + 1, output));
    return output;
  }
  if (typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    if (keyPattern.test(key)) {
      if (Array.isArray(child)) output.push(...child.filter((item) => typeof item === 'string'));
      else if (typeof child === 'string' || typeof child === 'number') output.push(String(child));
    }
    collectDeepValues(child, keyPattern, depth + 1, output);
  }
  return output;
}

function oneKeyImageIdentifiers(house, record = null) {
  const recordIds = collectDeepValues(
    record,
    /^(?:uniqueListingId|listingId|listingKey|listingKeyNumeric|bupi|businessPropertyId|universalPropertyId|propertyId)$/i
  );
  const imagePathId = String(house?.image || '').match(/\/property\/([^/]+)\//i)?.[1] || '';
  return [...new Set([
    house?.id,
    record?.UniqueListingId,
    record?.Listing?.ListingId,
    record?.Listing?.ListingKey,
    imagePathId,
    ...recordIds
  ].map((value) => String(value || '').trim()).filter((value) => /^[a-z0-9_.:-]{3,160}$/i.test(value)))].slice(0, 12);
}

function collectDeepImageUrls(value) {
  const candidates = collectDeepValues(
    value,
    /(?:mediaurl|imageurl|photo(?:url)?|thumbnail(?:url)?|images?(?:hero)?)/i
  );
  return uniqueExternalUrls(candidates.filter((url) => /\.(?:avif|gif|jpe?g|png|webp)(?:\?|$)/i.test(String(url))));
}

function numberOrNull(value) {
  const normalized = String(value ?? '').replace(/[$,]/g, '').trim();
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function intOrNull(value) {
  const number = numberOrNull(value);
  return number === null || number <= 0 ? null : Math.round(number);
}

function positiveNumberOrNull(value) {
  const number = numberOrNull(value);
  return number === null || number <= 0 ? null : number;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function firstDeepValue(value, patterns, depth = 0) {
  if (depth > 8 || value == null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstDeepValue(item, patterns, depth + 1);
      if (found !== null && found !== undefined && found !== '') return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    if (patterns.some((pattern) => pattern.test(key)) && child !== null && child !== undefined && child !== '') return child;
    const found = firstDeepValue(child, patterns, depth + 1);
    if (found !== null && found !== undefined && found !== '') return found;
  }
  return null;
}

function sameAddress(left, right) {
  const simplify = (value) => cleanText(value)
    .toLowerCase()
    .replace(/\b(?:ny|new york|street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|place|pl|unit|apt)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
  const a = simplify(left);
  const b = simplify(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function oneKeyFeatures(record) {
  const computed = record?.Computed || {};
  const characteristics = record?.CharacteristicsDerived || {};
  const structure = record?.StructureDerived || {};
  return [
    characteristics.PoolYN ? 'Pool' : '',
    characteristics.WaterfrontYN ? 'Waterfront' : '',
    characteristics.ViewYN ? 'View' : '',
    characteristics.AtticYN ? 'Attic' : '',
    structure.BasementYN ? 'Basement' : '',
    structure.GarageYN ? 'Garage' : '',
    structure.CoolingYN ? 'Central cooling' : '',
    structure.FireplaceYN ? 'Fireplace' : '',
    structure.NewConstructionYN ? 'New construction' : '',
    ...(Array.isArray(computed.PropertySearchType) ? computed.PropertySearchType : [])
  ].map(cleanText).filter(Boolean).filter((item, index, list) => list.indexOf(item) === index).slice(0, 32);
}

function oneKeyListing(house) {
  const listingId = String(house?.id || '').trim();
  return String(house?.source || '').toLowerCase() === 'onekey'
    || /^M\d+-/i.test(listingId)
    || /brokerdata-b\.b-cdn\.net\/mlsgrid\/onekey/i.test(String(house?.image || ''));
}

function propertyImages(house, enrichedImages = []) {
  const storedCollections = [house?.images, house?.photos, house?.gallery, house?.media_urls]
    .flatMap((value) => Array.isArray(value) ? value : []);
  const media = Array.isArray(house?.media)
    ? house.media.flatMap((item) => [item?.url, item?.MediaURL])
    : [];
  return uniqueExternalUrls([
    house?.image,
    house?.image_url,
    house?.listing_photo_url,
    house?.primary_photo_url,
    house?.photo_url,
    house?.thumbnail_url,
    ...storedCollections,
    ...enrichedImages,
    ...media
  ]);
}

async function loadOneKeyPropertyImages(house, record = null) {
  const listingIds = oneKeyImageIdentifiers(house, record);
  if (!oneKeyListing(house) || !listingIds.length) return collectDeepImageUrls(record);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const payloads = await Promise.all(listingIds.map(async (listingId) => {
      const response = await fetch(`${ONEKEY_PROPERTY_IMAGES_URL}?uniqueListingId=${encodeURIComponent(listingId)}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; Rel8tionPropertyExperience/1.1)'
        },
        signal: controller.signal
      });
      if (!response.ok) return null;
      return response.json().catch(() => null);
    }));
    return uniqueExternalUrls([
      ...collectDeepImageUrls(record),
      ...payloads.flatMap((payload) => Object.values(payload?.Results || {}).flatMap((result) => result?.Images || []))
    ]);
  } catch {
    return collectDeepImageUrls(record);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadPropertyImages(house, record = null) {
  const enriched = await loadOneKeyPropertyImages(house, record);
  return propertyImages(house, enriched);
}

async function loadStoredPropertyProfile(openHouseId) {
  if (!openHouseId) return null;
  const rows = await supabaseRest(
    `open_house_property_profiles?open_house_id=eq.${encodeURIComponent(openHouseId)}&select=*&limit=1`
  );
  return first(rows);
}

function propertyProfileIsFresh(profile, now = Date.now()) {
  if (!profile?.source_checked_at || !profile?.images_checked_at) return false;
  const checkedAt = Math.min(
    new Date(profile.source_checked_at).getTime(),
    new Date(profile.images_checked_at).getTime()
  );
  return Number.isFinite(checkedAt) && now - checkedAt < PROPERTY_PROFILE_STALE_MS;
}

async function loadOneKeyRecord(house) {
  if (!oneKeyListing(house)) return null;
  const lat = numberOrNull(firstPresent(house?.lat, house?.latitude));
  const lng = numberOrNull(firstPresent(house?.lng, house?.longitude));
  if (lat === null || lng === null) return null;

  const radius = 0.08;
  const topLeft = `[${(lng - radius).toFixed(6)},${(lat + radius).toFixed(6)}]`;
  const bottomRight = `[${(lng + radius).toFixed(6)},${(lat - radius).toFixed(6)}]`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  let addressMatch = null;

  try {
    for (const offset of [0, 300, 600, 900, 1200]) {
      const url = `${ONEKEY_SEARCH_URL}?topLeft=${encodeURIComponent(topLeft)}&bottomRight=${encodeURIComponent(bottomRight)}&propertySaleType=Sale&StateOrProvince=NY&offset=${offset}`;
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json,text/plain,*/*',
          'User-Agent': 'Mozilla/5.0 (compatible; Rel8tionPropertyExperience/1.0)'
        },
        signal: controller.signal
      });
      if (!response.ok) break;
      const payload = await response.json().catch(() => null);
      const results = Array.isArray(payload?.Results) ? payload.Results : [];
      if (!results.length) break;

      const exact = results.find((row) => String(row.UniqueListingId || '') === String(house.id || ''));
      if (exact) return exact;
      addressMatch ||= results.find((row) => sameAddress(row.DisplayName, house.address));

      const total = Number(payload?.Total || 0);
      if (total && offset + results.length >= total) break;
    }
    return addressMatch;
  } catch {
    return addressMatch;
  } finally {
    clearTimeout(timeout);
  }
}

function buildPropertyProfile({ house = {}, event = null, stored = null, oneKeyRecord = null, oneKeyImages = [], targetUrl = '', now = new Date().toISOString() }) {
  const context = event?.setup_context || {};
  const existing = stored || {};
  const record = oneKeyRecord || {};
  const computed = record.Computed || {};
  const structure = record.Structure || {};
  const listing = record.Listing || {};
  const listAgent = listing.ListAgent || listing.Agent || {};
  const listOffice = listing.AgentOffice?.ListOffice || listing.ListOffice || {};
  const latitude = numberOrNull(firstPresent(record.LocationPoint?.lat, existing.latitude, house.lat, house.latitude));
  const longitude = numberOrNull(firstPresent(record.LocationPoint?.lon, existing.longitude, house.lng, house.longitude));
  const images = uniqueExternalUrls([
    ...(Array.isArray(oneKeyImages) ? oneKeyImages : []),
    ...(Array.isArray(record.Media) ? record.Media.flatMap((item) => [item?.MediaURL, item?.url]) : []),
    ...(Array.isArray(existing.images) ? existing.images : []),
    existing.primary_image,
    ...propertyImages({ ...context, ...house })
  ]);
  const features = [...oneKeyFeatures(record), ...(Array.isArray(existing.features) ? existing.features : [])]
    .map(cleanText).filter(Boolean).filter((item, index, list) => list.indexOf(item) === index).slice(0, 32);

  return {
    open_house_id: String(house.id || existing.open_house_id || event?.open_house_source_id || '').trim(),
    source: firstPresent(house.source, existing.source, oneKeyRecord ? 'onekey' : ''),
    source_listing_id: firstPresent(record.UniqueListingId, existing.source_listing_id, house.id),
    address: firstPresent(record.DisplayName, existing.address, house.address, context.address),
    city: firstPresent(record.Location?.City, existing.city, house.city, context.city),
    state: firstPresent(record.Location?.StateOrProvince, existing.state, house.state, context.state),
    zip: firstPresent(record.Location?.PostalCode, existing.zip, house.zip, house.postal_code, context.zip),
    latitude,
    longitude,
    price: positiveNumberOrNull(firstPresent(listing.Price?.ListPrice, existing.price, house.price, context.price)),
    beds: positiveNumberOrNull(firstPresent(structure.BedroomsTotal, computed.BedroomsTotalInteger, existing.beds, house.beds, context.beds)),
    baths: positiveNumberOrNull(firstPresent(structure.BathroomsTotalInteger, computed.BathroomsTotalInteger, existing.baths, house.baths, context.baths)),
    sqft: positiveNumberOrNull(firstPresent(structure.LivingArea, computed.LivingAreaSquareFeet, existing.sqft, house.sqft, context.sqft)),
    lot_size_sqft: positiveNumberOrNull(firstPresent(computed.LotSizeSquareFeet, record.LotSizeSquareFeet, existing.lot_size_sqft, house.lot_size_sqft, house.lot_size)),
    year_built: intOrNull(firstPresent(structure.YearBuilt, record.YearBuilt, existing.year_built, house.year_built)),
    annual_property_taxes: positiveNumberOrNull(firstPresent(
      firstDeepValue(record, [/taxannualamount/i, /annualtax/i, /propertytax/i, /^taxes$/i]),
      existing.annual_property_taxes,
      house.taxes
    )),
    hoa_monthly: positiveNumberOrNull(firstPresent(computed.HoaMonthlyFee, existing.hoa_monthly, house.hoa_monthly)),
    price_per_sqft: positiveNumberOrNull(firstPresent(computed.PricePerSquareFoot, existing.price_per_sqft, house.price_per_sqft)),
    property_type: firstPresent(record.PropertyType, existing.property_type, house.property_type),
    listing_status: firstPresent(listing.StandardStatus, existing.listing_status, house.listing_status),
    description: cleanText(firstPresent(
      firstDeepValue(record, [/publicremarks/i, /remarks/i, /description/i, /marketing/i]),
      existing.description,
      house.description,
      context.description
    )),
    features,
    images,
    primary_image: images[0] || null,
    listing_url: validExternalUrl(firstPresent(record.CanonicalURL, record.ListingURL, existing.listing_url, targetUrl, house.link)),
    brokerage: firstPresent(listOffice.ListOfficeName, existing.brokerage, house.brokerage, context.detected_brokerage, context.brokerage),
    agent_name: firstPresent(listAgent.FullName, listAgent.MemberFullName, existing.agent_name, house.agent, context.agent_name, event?.host_agent_slug),
    agent_phone: firstPresent(listAgent.Phone, listAgent.MobilePhone, existing.agent_phone, house.agent_phone, context.agent_phone),
    agent_email: firstPresent(listAgent.Email, existing.agent_email, house.agent_email, context.agent_email),
    open_start: firstPresent(computed.OpenHousesEarliestStartTime, existing.open_start, house.open_start, event?.start_time) || null,
    open_end: firstPresent(computed.OpenHousesEarliestEndTime, existing.open_end, house.open_end, event?.end_time) || null,
    source_payload: oneKeyRecord || existing.source_payload || {},
    source_checked_at: oneKeyRecord ? now : (existing.source_checked_at || now),
    images_checked_at: now,
    updated_at: now
  };
}

async function savePropertyProfile(profile) {
  if (!profile?.open_house_id) return null;
  const rows = await supabaseRest('open_house_property_profiles?on_conflict=open_house_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(profile)
  });
  return first(rows) || profile;
}

async function loadPropertyProfile({ house, event, targetUrl, forceRefresh = false }) {
  if (!house?.id) return null;
  const stored = await loadStoredPropertyProfile(house.id).catch(() => null);
  if (!forceRefresh && propertyProfileIsFresh(stored)) {
    return buildPropertyProfile({ house, event, stored, targetUrl });
  }

  const oneKeyRecord = await loadOneKeyRecord(house).catch(() => null);
  const oneKeyImages = await loadOneKeyPropertyImages(house, oneKeyRecord).catch(() => collectDeepImageUrls(oneKeyRecord));
  const profile = buildPropertyProfile({ house, event, stored, oneKeyRecord, oneKeyImages, targetUrl });
  await savePropertyProfile(profile).catch(() => null);
  return profile;
}

async function checkExternalUrl(url) {
  const target = validExternalUrl(url);
  if (!target) {
    return { available: false, status: null, final_url: '', reason: 'missing_url' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  };

  try {
    let response = await fetch(target, {
      method: 'HEAD',
      redirect: 'follow',
      headers,
      signal: controller.signal
    });

    if (response.status === 405 || response.status === 403) {
      response = await fetch(target, {
        method: 'GET',
        redirect: 'follow',
        headers,
        signal: controller.signal
      });
    }

    return {
      available: response.status >= 200 && response.status < 400,
      status: response.status,
      final_url: response.url || target,
      reason: response.status >= 200 && response.status < 400 ? 'ok' : 'http_status'
    };
  } catch (error) {
    return {
      available: false,
      status: null,
      final_url: '',
      reason: error?.name === 'AbortError' ? 'timeout' : 'fetch_failed'
    };
  } finally {
    clearTimeout(timeout);
  }
}

function setupContextUrl(event) {
  const context = event?.setup_context || {};
  return validExternalUrl(
    context.listing_url ||
    context.listing_link ||
    context.mls_url ||
    context.link ||
    context.url
  );
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || '';
}

function money(value) {
  const number = Number(String(value || '').replace(/[$,]/g, ''));
  if (!Number.isFinite(number) || number <= 0) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(number);
}

function eventWindow(house, event) {
  const startValue = firstPresent(house?.open_start, event?.start_time);
  const endValue = firstPresent(house?.open_end, event?.end_time);
  const start = startValue ? new Date(startValue) : null;
  const end = endValue ? new Date(endValue) : null;
  if (!start || Number.isNaN(start.getTime())) return '';

  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York'
  }).format(start);
  const startTime = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York'
  }).format(start).replace(':00', '');
  const endTime = end && !Number.isNaN(end.getTime())
    ? new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York'
    }).format(end).replace(':00', '')
    : '';

  return `${date} ${startTime}${endTime ? ` - ${endTime}` : ''}`;
}

function propertyImage(house) {
  return validExternalUrl(firstPresent(
    house?.image,
    house?.image_url,
    house?.listing_photo_url,
    house?.primary_photo_url,
    house?.photo_url,
    house?.thumbnail_url
  ));
}

async function loadOpenHouse(openHouseId) {
  if (!openHouseId) return null;
  const rows = await supabaseRest(
    `open_houses?id=eq.${encodeURIComponent(openHouseId)}&select=*&limit=1`
  );
  return first(rows);
}

async function loadHomeKey(code) {
  if (!code) return null;
  const rows = await supabaseRest(
    `property_keepsakes?public_code=eq.${encodeURIComponent(code)}&status=eq.active&select=*&limit=1`
  );
  return first(rows);
}

async function loadEvent(eventId) {
  if (!eventId) return null;
  const rows = await supabaseRest(
    `open_house_events?id=eq.${encodeURIComponent(eventId)}&select=id,open_house_source_id,host_agent_slug,setup_context,start_time,end_time&limit=1`
  );
  return first(rows);
}

async function resolveListing(id) {
  const directHouse = await loadOpenHouse(id).catch(() => null);
  if (directHouse) {
    return {
      house: directHouse,
      event: null,
      targetUrl: validExternalUrl(directHouse.link)
    };
  }

  const event = await loadEvent(id).catch(() => null);
  const eventHouse = await loadOpenHouse(event?.open_house_source_id).catch(() => null);
  return {
    house: eventHouse,
    event,
    targetUrl: setupContextUrl(event) || validExternalUrl(eventHouse?.link)
  };
}

function normalizedPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function matchAgentWebsite(agent, websites) {
  const email = cleanText(agent?.email).toLowerCase();
  const phone = normalizedPhone(agent?.phone);
  const name = cleanText(agent?.name).toLowerCase();
  return (websites || []).find((site) => (
    (email && cleanText(site.email).toLowerCase() === email)
    || (phone && normalizedPhone(site.phone) === phone)
    || (name && cleanText(site.name).toLowerCase() === name)
  )) || null;
}

function agentWebsiteUrl(site) {
  if (!site || site.status !== 'published') return '';
  const customDomain = cleanText(site.custom_domain).replace(/^https?:\/\//i, '').replace(/\/$/, '');
  if (customDomain && /^[a-z0-9.-]+(?::\d+)?$/i.test(customDomain)) return `https://${customDomain}`;
  return site.slug ? `https://my.rel8tion.me/${encodeURIComponent(site.slug)}` : '';
}

async function loadKeepsakeAgents(openHouseId, fallback = {}, listingAgentId = '') {
  const [listingRows, websiteRows] = await Promise.all([
    supabaseRest(`listing_agents?${listingAgentId ? `id=eq.${encodeURIComponent(listingAgentId)}&` : `open_house_id=eq.${encodeURIComponent(openHouseId)}&`}select=id,name,phone,email,brokerage,is_primary,primary_photo_url,directory_photo_url,profile_url&order=is_primary.desc.nullslast,created_at.asc&limit=8`).catch(() => []),
    supabaseRest('agent_websites?status=eq.published&select=name,slug,title,brokerage,email,phone,photo_url,custom_domain,status,facebook_url,instagram_url,linkedin_url,zillow_url,realtor_url&order=updated_at.desc&limit=500').catch(() => [])
  ]);
  const baseRows = (listingRows || []).length ? listingRows : [{
    name: fallback.agent_name || fallback.agent || '',
    phone: fallback.agent_phone || '',
    email: fallback.agent_email || '',
    brokerage: fallback.brokerage || '',
    is_primary: true
  }];

  return baseRows.filter((agent) => agent.name || agent.phone || agent.email).map((agent) => {
    const site = matchAgentWebsite(agent, websiteRows);
    return {
      name: firstPresent(agent.name, site?.name, fallback.agent_name, fallback.agent),
      title: firstPresent(site?.title, 'Listing Agent'),
      brokerage: firstPresent(agent.brokerage, site?.brokerage, fallback.brokerage),
      phone: firstPresent(agent.phone, site?.phone, fallback.agent_phone),
      email: firstPresent(agent.email, site?.email, fallback.agent_email),
      photo_url: validExternalUrl(firstPresent(agent.primary_photo_url, agent.directory_photo_url, site?.photo_url)),
      profile_url: validExternalUrl(firstPresent(agent.profile_url, agentWebsiteUrl(site))),
      website_url: validExternalUrl(agentWebsiteUrl(site)),
      facebook_url: validExternalUrl(site?.facebook_url),
      instagram_url: validExternalUrl(site?.instagram_url),
      linkedin_url: validExternalUrl(site?.linkedin_url),
      zillow_url: validExternalUrl(site?.zillow_url),
      realtor_url: validExternalUrl(site?.realtor_url),
      is_primary: agent.is_primary !== false
    };
  });
}

function visitDistance(visit, targetTime) {
  const visitTime = new Date(visit?.scheduled_start || 0).getTime();
  if (!Number.isFinite(visitTime)) return Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(targetTime)) return -visitTime;
  return Math.abs(visitTime - targetTime);
}

async function loadKeepsakeLoanOfficer(openHouseId, event, targetStart, attributedUid = '', preserveUnassigned = false) {
  if (attributedUid) {
    const profile = first(await supabaseRest(
      `verified_profiles?uid=eq.${encodeURIComponent(attributedUid)}&select=*&limit=1`
    ).catch(() => []));
    if (!profile) return null;
    return {
      uid: profile.uid,
      name: profile.full_name,
      title: firstPresent(profile.title, 'Loan Officer'),
      company: profile.company_name,
      phone: profile.phone,
      email: profile.email,
      photo_url: validExternalUrl(profile.photo_url),
      website_url: validExternalUrl(profile.cta_url),
      calendar_url: validExternalUrl(profile.calendar_url),
      bio: cleanText(profile.bio),
      areas: Array.isArray(profile.areas) ? profile.areas.map(cleanText).filter(Boolean).slice(0, 8) : []
    };
  }
  if (preserveUnassigned) return null;
  const visitFilters = [
    `open_house_id.eq.${encodeURIComponent(openHouseId)}`,
    event?.id ? `open_house_event_id.eq.${encodeURIComponent(event.id)}` : ''
  ].filter(Boolean);
  const [visitRows, sessionRows] = await Promise.all([
    supabaseRest(`field_demo_visits?or=(${visitFilters.join(',')})&status=neq.cancelled&select=id,open_house_event_id,scheduled_start,status&order=scheduled_start.desc&limit=20`).catch(() => []),
    event?.id
      ? supabaseRest(`event_loan_officer_sessions?open_house_event_id=eq.${encodeURIComponent(event.id)}&select=*&order=signed_in_at.desc.nullslast,created_at.desc&limit=5`).catch(() => [])
      : Promise.resolve([])
  ]);
  const targetTime = new Date(targetStart || 0).getTime();
  const visit = [...(visitRows || [])].sort((a, b) => visitDistance(a, targetTime) - visitDistance(b, targetTime))[0] || null;
  const participant = visit?.id ? first(await supabaseRest(
    `field_demo_visit_participants?field_demo_visit_id=eq.${encodeURIComponent(visit.id)}&role=eq.loan_officer&status=neq.cancelled&select=*&order=is_primary.desc,created_at.asc&limit=1`
  ).catch(() => [])) : null;
  const session = first(sessionRows);
  const uid = firstPresent(participant?.participant_profile_id, participant?.participant_uid, session?.verified_profile_uid, session?.loan_officer_uid);
  const profile = uid ? first(await supabaseRest(
    `verified_profiles?uid=eq.${encodeURIComponent(uid)}&is_active=eq.true&select=*&limit=1`
  ).catch(() => [])) : null;
  if (!participant && !session && !profile) return null;

  return {
    uid: firstPresent(profile?.uid, uid),
    name: firstPresent(profile?.full_name, participant?.participant_name, session?.loan_officer_name, session?.loan_officer_slug),
    title: firstPresent(profile?.title, session?.loan_officer_title, 'Loan Officer'),
    company: firstPresent(profile?.company_name, participant?.participant_company, session?.loan_officer_company),
    phone: firstPresent(profile?.phone, participant?.participant_phone, session?.loan_officer_phone),
    email: firstPresent(profile?.email, participant?.participant_email, session?.loan_officer_email),
    photo_url: validExternalUrl(firstPresent(profile?.photo_url, session?.loan_officer_photo_url)),
    website_url: validExternalUrl(firstPresent(profile?.cta_url, session?.loan_officer_cta_url)),
    calendar_url: validExternalUrl(firstPresent(profile?.calendar_url, session?.loan_officer_calendar_url)),
    bio: cleanText(profile?.bio),
    areas: Array.isArray(profile?.areas) ? profile.areas.map(cleanText).filter(Boolean).slice(0, 8) : []
  };
}

async function loadKeepsakePeople({ house, event, profile, homekey = null }) {
  const openHouseId = firstPresent(house?.id, profile?.open_house_id, event?.open_house_source_id);
  if (!openHouseId) return { agents: [], loanOfficer: null };
  const fallback = { ...(house || {}), ...(profile || {}), ...(event?.setup_context || {}) };
  const [agents, loanOfficer] = await Promise.all([
    loadKeepsakeAgents(openHouseId, fallback, homekey?.listing_agent_id || ''),
    loadKeepsakeLoanOfficer(
      openHouseId,
      event,
      firstPresent(profile?.open_start, house?.open_start, event?.start_time),
      homekey?.loan_officer_uid || '',
      Boolean(homekey)
    )
  ]);
  return { agents, loanOfficer };
}

function renderListingPage({ id, house, event, profile = null, targetUrl, externalCheck, images = [], buyerEventId = '', origin = 'https://app.rel8tion.me', keepsake = false, homekey = null, agents = [], loanOfficer = null }) {
  const context = event?.setup_context || {};
  const property = {
    ...context,
    ...(house || {}),
    ...(profile || {}),
    image: profile?.primary_image || house?.image || context.image
  };
  const address = firstPresent(property.address, 'Open house listing');
  const locationLine = [property.city, property.state, property.zip].filter(Boolean).join(', ').replace(/, ([A-Z]{2}), /, '$1 ');
  const price = money(property.price);
  const beds = property.beds;
  const baths = property.baths;
  const sqft = property.sqft;
  const brokerage = firstPresent(property.brokerage, context.detected_brokerage);
  const agent = firstPresent(property.agent_name, property.agent, event?.host_agent_slug);
  const agentPhone = firstPresent(property.agent_phone, context.agent_phone);
  const agentEmail = firstPresent(property.agent_email, context.agent_email);
  const description = firstPresent(property.description, context.description);
  const windowText = eventWindow(property, event);
  const gallery = propertyImages(property, images);
  const image = gallery[0] || propertyImage(house);
  const mlsAvailable = Boolean(targetUrl && externalCheck?.available);
  const returnToEvent = buyerEventId
    ? `${String(origin || '').replace(/\/$/, '')}/event?event=${encodeURIComponent(buyerEventId)}`
    : '';
  const phoneDigits = String(agentPhone || '').replace(/\D/g, '');
  const listingStatus = cleanText(property.listing_status).toLowerCase();
  const homeUnavailable = Boolean(keepsake && (
    property._homekey_source_missing
    || (listingStatus && !/(active|coming soon|pending|continue to show)/i.test(listingStatus))
  ));
  const galleryJson = JSON.stringify(gallery).replace(/</g, '\\u003c');
  const listingAgents = (agents || []).length ? agents : [{
    name: agent,
    title: 'Listing Agent',
    brokerage,
    phone: agentPhone,
    email: agentEmail,
    is_primary: true
  }];
  const primaryAgent = listingAgents.find((item) => item.is_primary) || listingAgents[0] || null;
  const socialLink = (url, label, contactKind) => url ? `<a class="social-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-homekey-contact="${esc(contactKind)}">${esc(label)}</a>` : '';
  const contactCard = (person, kind, index = 0) => {
    if (!person?.name && !person?.phone && !person?.email) return '';
    const phone = String(person.phone || '').replace(/\D/g, '');
    const contact = JSON.stringify({
      name: person.name || '',
      title: person.title || (kind === 'agent' ? 'Listing Agent' : 'Loan Officer'),
      company: person.brokerage || person.company || '',
      phone: person.phone || '',
      email: person.email || '',
      url: person.website_url || person.profile_url || ''
    });
    const links = kind === 'agent'
      ? [
        socialLink(person.website_url, 'Website', 'agent'),
        socialLink(person.profile_url && person.profile_url !== person.website_url ? person.profile_url : '', 'Profile', 'agent'),
        socialLink(person.instagram_url, 'Instagram', 'agent'),
        socialLink(person.facebook_url, 'Facebook', 'agent'),
        socialLink(person.linkedin_url, 'LinkedIn', 'agent'),
        socialLink(person.zillow_url, 'Zillow', 'agent'),
        socialLink(person.realtor_url, 'Realtor.com', 'agent')
      ]
      : [socialLink(person.website_url, 'Website', 'loan_officer'), socialLink(person.calendar_url, 'Book a time', 'loan_officer')];
    return `<article class="person-card ${kind}">
      <div class="person-head">
        ${person.photo_url ? `<img class="person-photo" src="${esc(person.photo_url)}" alt="${esc(person.name || kind)}">` : `<div class="person-photo person-fallback">${esc(String(person.name || kind).slice(0, 1).toUpperCase())}</div>`}
        <div><div class="eyebrow">${kind === 'agent' ? (index ? 'Co-listing agent' : 'Listing agent') : 'Financing resource'}</div><h2>${esc(person.name || (kind === 'agent' ? 'Listing agent' : 'Loan officer'))}</h2><p>${esc([person.title, person.brokerage || person.company].filter(Boolean).join(' · '))}</p></div>
      </div>
      ${person.bio ? `<p class="person-bio">${esc(person.bio)}</p>` : ''}
      <div class="contact-actions">
        ${phone ? `<a href="tel:${esc(phone)}" data-homekey-contact="${esc(kind)}">Call</a><a href="sms:${esc(phone)}" data-homekey-contact="${esc(kind)}">Text</a>` : ''}
        ${person.email ? `<a href="mailto:${esc(person.email)}" data-homekey-contact="${esc(kind)}">Email</a>` : ''}
        <button type="button" data-save-contact="${esc(contact)}" data-homekey-contact="${esc(kind)}">Save contact</button>
      </div>
      ${links.some(Boolean) ? `<div class="social-links">${links.join('')}</div>` : ''}
    </article>`;
  };
  const peopleHtml = keepsake
    ? `<section class="people-grid">${listingAgents.map((item, index) => contactCard(item, 'agent', index)).join('')}${loanOfficer ? contactCard(loanOfficer, 'loan_officer') : ''}</section>`
    : `<section class="detail-card"><h2>${esc(agent || 'Hosting agent')}</h2><p>${esc([brokerage, agentPhone, agentEmail].filter(Boolean).join(' · ') || 'Ask the hosting agent for current property information and next steps.')}</p></section>`;
  const factCards = [
    ['Price', price],
    ['Bedrooms', beds],
    ['Bathrooms', baths],
    ['Interior', sqft ? `${Number(sqft).toLocaleString()} sq ft` : ''],
    ['Property type', property.property_type],
    ['Listing status', property.listing_status],
    ['Year built', property.year_built],
    ['Lot size', property.lot_size_sqft ? `${Number(property.lot_size_sqft).toLocaleString()} sq ft` : ''],
    ['Taxes', property.annual_property_taxes ? `${money(property.annual_property_taxes)}/yr` : ''],
    ['HOA', property.hoa_monthly ? `${money(property.hoa_monthly)}/mo` : ''],
    ['Price / sq ft', property.price_per_sqft ? money(property.price_per_sqft) : ''],
    ['Open house', windowText]
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
  const features = (Array.isArray(property.features) ? property.features : []).map(cleanText).filter(Boolean).slice(0, 32);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(address)} | REL8TION</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #17224f;
      background: linear-gradient(180deg, #69d9f6 0%, #eaf9ff 38%, #f4fbff 100%);
    }
    body.lightbox-open { overflow: hidden; }
    button, a { font: inherit; }
    button { cursor: pointer; }
    main { width: min(1080px, calc(100% - 28px)); margin: 0 auto; padding: 28px 0 46px; }
    .brand { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    .brand img { height: 44px; width: auto; }
    .pill { border: 1px solid rgba(255,255,255,.8); border-radius: 999px; background: rgba(255,255,255,.68); padding: 10px 14px; font-size: 12px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; color: #475569; }
    .card { overflow: hidden; border: 1px solid rgba(255,255,255,.78); border-radius: 34px; background: rgba(255,255,255,.86); box-shadow: 0 24px 64px rgba(31,42,90,.14); }
    .hero-button { position: relative; display: block; width: 100%; padding: 0; border: 0; background: #e2e8f0; }
    .hero { width: 100%; aspect-ratio: 16 / 9; background: #e2e8f0; object-fit: cover; display: block; }
    .photo-count { position: absolute; right: 16px; bottom: 16px; border-radius: 999px; background: rgba(15,23,42,.78); color: #fff; padding: 10px 14px; font-size: 12px; font-weight: 900; letter-spacing: .05em; }
    .fallback { display:flex; align-items:center; justify-content:center; width:100%; aspect-ratio:16/10; background:rgba(241,245,249,.92); color:#94a3b8; font-weight:900; letter-spacing:.12em; text-transform:uppercase; }
    .body { padding: 24px; display: grid; gap: 22px; }
    h1 { margin: 0 0 12px; font-size: clamp(34px, 8vw, 64px); line-height: .94; letter-spacing: 0; color: #1f2a5a; }
    .sub { font-size: 17px; font-weight: 700; line-height: 1.45; color: #475569; }
    .gallery-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
    .thumb { width: 100%; padding: 0; overflow: hidden; border: 0; border-radius: 18px; background: #e2e8f0; }
    .thumb img { display: block; width: 100%; aspect-ratio: 4/3; object-fit: cover; transition: transform .18s ease; }
    .thumb:hover img, .thumb:focus-visible img { transform: scale(1.025); }
    .fact-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }
    .fact { border-radius: 18px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px; }
    .fact span { display: block; margin-bottom: 5px; color: #64748b; font-size: 10px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
    .fact strong { color: #17224f; font-size: 16px; }
    .detail-card { border-radius: 22px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 18px; }
    .detail-card h2 { margin: 0 0 9px; color: #1f2a5a; font-size: 22px; }
    .detail-card p { margin: 0; color: #475569; font-weight: 650; line-height: 1.65; }
    .feature-list { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 12px; }
    .feature { border-radius: 999px; background: #eaf2ff; color: #294284; padding: 9px 12px; font-size: 13px; font-weight: 850; }
    .unavailable-banner { border-radius: 20px; background: #fff7ed; border: 1px solid #fdba74; color: #9a3412; padding: 16px; font-weight: 850; line-height: 1.5; }
    .homekey-primary-actions, .future-actions, .financing-actions { display: grid; gap: 10px; }
    .homekey-action { width: 100%; min-height: 52px; border: 1px solid #bfdbfe; border-radius: 18px; background: #eff6ff; color: #1f2a5a; padding: 12px 14px; text-align: left; font-weight: 950; }
    a.homekey-action { display: flex; align-items: center; text-decoration: none; }
    .homekey-action.primary-action { border: 0; background: linear-gradient(90deg,#1f2a5a,#2563eb); color: #fff; text-align: center; }
    .relationship-cta { border-radius: 24px; background: #fff1f2; border: 1px solid #fecdd3; padding: 20px; text-align: center; }
    .relationship-cta h2, .future-card h2, .financing-card h2 { margin: 0 0 8px; color: #1f2a5a; }
    .relationship-cta p, .future-card p, .financing-card p { margin: 0 0 16px; color: #64748b; font-weight: 700; line-height: 1.5; }
    .future-card, .financing-card { border-radius: 24px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; }
    .action-selection { border-radius: 16px; background: rgba(255,255,255,.14); padding: 12px 14px; color: #fff; font-weight: 900; }
    .hidden { display: none !important; }
    .people-grid { display: grid; gap: 14px; }
    .person-card { border-radius: 24px; background: #fff; border: 1px solid #dbeafe; padding: 18px; box-shadow: 0 14px 34px rgba(31,42,90,.08); }
    .person-card.loan_officer { border-color: #bae6fd; background: linear-gradient(145deg,#f0f9ff,#fff); }
    .person-head { display: grid; grid-template-columns: 68px minmax(0,1fr); align-items: center; gap: 14px; }
    .person-photo { width: 68px; height: 68px; border-radius: 20px; object-fit: cover; background: #dbeafe; }
    .person-fallback { display: grid; place-items: center; color: #294284; font-size: 28px; font-weight: 950; }
    .eyebrow { color: #2563eb; font-size: 10px; font-weight: 950; letter-spacing: .13em; text-transform: uppercase; }
    .person-card h2 { margin: 4px 0; color: #1f2a5a; font-size: 22px; }
    .person-card p { margin: 0; color: #64748b; font-weight: 700; line-height: 1.45; }
    .person-bio { margin-top: 14px !important; }
    .contact-actions, .social-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    .contact-actions a, .contact-actions button, .social-link { border: 1px solid #dbeafe; border-radius: 999px; background: #eff6ff; color: #294284; padding: 9px 12px; text-decoration: none; font-size: 13px; font-weight: 900; }
    .social-link { background: #fff; color: #334155; border-color: #e2e8f0; }
    .keepsake-card { overflow: hidden; border-radius: 26px; background: linear-gradient(135deg,#17224f,#2563eb); color: #fff; padding: 22px; }
    .keepsake-card h2 { margin: 0 0 8px; font-size: 28px; }
    .keepsake-card > p { margin: 0; color: #dbeafe; font-weight: 700; line-height: 1.55; }
    .choice-grid { display: grid; gap: 10px; margin: 18px 0; }
    .choice { display: flex; align-items: flex-start; gap: 11px; border-radius: 17px; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.2); padding: 13px; color: #fff; font-weight: 850; }
    .choice input { width: 20px; height: 20px; margin-top: 1px; accent-color: #67e8f9; }
    .interest-form { display: grid; gap: 10px; }
    .interest-fields { display: grid; gap: 10px; }
    .interest-form input[type="text"], .interest-form input[type="tel"], .interest-form input[type="email"] { width: 100%; min-height: 50px; border: 1px solid rgba(255,255,255,.25); border-radius: 15px; background: #fff; color: #17224f; padding: 12px 14px; font: inherit; font-weight: 750; }
    .consent { display: flex; align-items: flex-start; gap: 10px; color: #dbeafe; font-size: 12px; font-weight: 700; line-height: 1.45; }
    .consent input { width: 18px; height: 18px; flex: 0 0 auto; accent-color: #67e8f9; }
    .interest-form button[type="submit"] { min-height: 52px; border: 0; border-radius: 999px; background: #67e8f9; color: #17224f; padding: 13px 18px; font-weight: 950; }
    .form-status { min-height: 18px; color: #fff; font-size: 13px; font-weight: 850; }
    .keepsake-tools { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 16px; }
    .keepsake-tools button { border: 1px solid rgba(255,255,255,.3); border-radius: 999px; background: transparent; color: #fff; padding: 10px 13px; font-weight: 900; }
    .hp-field { position: absolute !important; left: -10000px !important; width: 1px !important; height: 1px !important; overflow: hidden !important; }
    .actions { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 22px; }
    a.button { display: flex; align-items: center; justify-content: center; min-height: 54px; border-radius: 999px; padding: 14px 18px; text-decoration: none; font-size: 16px; font-weight: 900; }
    .primary { background: linear-gradient(90deg, #1f2a5a, #2563eb); color: white; box-shadow: 0 18px 38px rgba(37,99,235,.22); }
    .secondary { background: #fff; color: #334155; border: 1px solid #e2e8f0; }
    .note { margin-top: 14px; font-size: 12px; font-weight: 800; color: #64748b; line-height: 1.4; }
    .lightbox { position: fixed; inset: 0; z-index: 100; display: none; place-items: center; padding: 16px; background: rgba(2,6,23,.92); }
    .lightbox.open { display: grid; }
    .lightbox-panel { width: min(1180px,100%); height: min(900px,calc(100dvh - 32px)); display: grid; grid-template-rows: auto minmax(0,1fr) auto; gap: 12px; }
    .lightbox-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #fff; font-weight: 900; }
    .lightbox-close, .lightbox-nav { border: 1px solid rgba(255,255,255,.24); border-radius: 999px; background: rgba(255,255,255,.12); color: #fff; padding: 11px 15px; font-weight: 900; }
    .lightbox-image { width: 100%; height: 100%; min-height: 0; object-fit: contain; border-radius: 18px; }
    .lightbox-controls { display: flex; justify-content: center; gap: 12px; }
    @media (min-width: 720px) { .actions { grid-template-columns: repeat(${[mlsAvailable, returnToEvent, phoneDigits].filter(Boolean).length || 1}, minmax(0,1fr)); } .body { padding: 34px; } .gallery-grid { grid-template-columns: repeat(3,minmax(0,1fr)); } .fact-grid { grid-template-columns: repeat(3,minmax(0,1fr)); } .people-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } .interest-fields { grid-template-columns: repeat(3,minmax(0,1fr)); } .homekey-primary-actions, .future-actions, .financing-actions { grid-template-columns: repeat(3,minmax(0,1fr)); } }
  </style>
</head>
<body>
  <main>
    <div class="brand">
      <img src="https://rel8tion.me/wp-content/uploads/2026/04/logo150x100trans.png" alt="REL8TION">
      <div class="pill">${keepsake ? 'Keep This Home' : 'Open House'}</div>
    </div>
    <section class="card">
      ${image ? `<button type="button" class="hero-button" data-gallery-index="0" aria-label="Open property photo gallery"><img class="hero" src="${esc(image)}" alt="${esc(address)}"><span class="photo-count">${esc(gallery.length)} photo${gallery.length === 1 ? '' : 's'} · tap to expand</span></button>` : '<div class="fallback">Property</div>'}
      <div class="body">
        <div>
          <h1>${esc(address)}</h1>
          <div class="sub">${esc([locationLine, brokerage, agent ? `${keepsake ? 'Listed by' : 'Hosted by'} ${agent}` : ''].filter(Boolean).join(' · '))}</div>
        </div>

        ${homeUnavailable ? '<div class="unavailable-banner">This home is no longer available, but your HomeKey still works. Use it to reach the original listing agent, explore similar homes, ask about off-market opportunities, or get financing guidance.</div>' : ''}

        ${keepsake ? `<div class="homekey-primary-actions">
          <button type="button" class="homekey-action" data-homekey-action="home_saved">♡ Save This Home</button>
          <button type="button" class="homekey-action" data-homekey-action="similar_homes">🏘 Show Me Similar Homes</button>
          <button type="button" class="homekey-action" data-homekey-action="financing_help">💰 What Would My Payment Be?</button>
        </div>` : ''}

        ${gallery.length > 1 ? `<div class="gallery-grid">${gallery.slice(1).map((url, index) => `<button type="button" class="thumb" data-gallery-index="${index + 1}" aria-label="Open property photo ${index + 2} of ${gallery.length}"><img src="${esc(url)}" alt="${esc(`${address} photo ${index + 2}`)}" loading="lazy"></button>`).join('')}</div>` : ''}

        ${factCards.length ? `<div class="fact-grid">${factCards.map(([label, value]) => `<div class="fact"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>` : ''}

        <section class="detail-card">
          <h2>About this property</h2>
          <p>${esc(description || 'Explore the property photos and open-house details, then speak with the hosting agent for disclosures, availability, and answers specific to this home.')}</p>
        </section>

        ${features.length ? `<section class="detail-card"><h2>Property features</h2><div class="feature-list">${features.map((feature) => `<span class="feature">${esc(feature)}</span>`).join('')}</div></section>` : ''}

        ${peopleHtml}

        ${keepsake && primaryAgent ? `<section class="relationship-cta">
          <h2>❤️ I Want This Agent To Help Me</h2>
          <p>Keep ${esc(primaryAgent.name || 'this listing agent')} as your real-estate connection for similar properties and future opportunities.</p>
          <button type="button" class="homekey-action primary-action" data-homekey-action="agent_relationship">I want this agent to help me</button>
        </section>` : ''}

        ${keepsake ? `<section class="future-card">
          <h2>DIDN'T LOVE THIS HOUSE?</h2>
          <p>Your HomeKey remains useful. Tell us what would help next.</p>
          <div class="future-actions">
            <button type="button" class="homekey-action" data-homekey-action="similar_homes">Show Me Similar Homes</button>
            <button type="button" class="homekey-action" data-homekey-action="off_market">Tell Me About Off-Market Opportunities</button>
            <button type="button" class="homekey-action" data-homekey-action="price_alert">Alert Me If The Price Changes</button>
            <button type="button" class="homekey-action" data-homekey-action="different_area">I'm Looking Somewhere Else</button>
          </div>
        </section>
        <section class="financing-card">
          <h2>FINANCING SUPPORT</h2>
          <p>${loanOfficer?.name ? `${esc(loanOfficer.name)} is the financing resource attributed to this HomeKey.` : 'Ask for optional financing help without completing an application on this page.'}</p>
          <div class="financing-actions">
            <button type="button" class="homekey-action" data-homekey-action="financing_help">💰 Estimate My Payment</button>
            <button type="button" class="homekey-action" data-homekey-action="financing_help">🏦 See What I Could Qualify For</button>
            ${loanOfficer?.phone ? `<a class="homekey-action" href="sms:${esc(String(loanOfficer.phone).replace(/\D/g, ''))}" data-homekey-contact="loan_officer">💬 Ask My Loan Officer</a>` : ''}
            <button type="button" class="homekey-action" data-homekey-action="financing_help">Get Pre-Approved</button>
          </div>
        </section>` : ''}

        ${keepsake ? `<section class="keepsake-card">
          <h2>Keep the little house.</h2>
          <p>Nothing is required just to view this page. If you choose an action above, share only the contact information needed for follow-up.</p>
          <form class="interest-form hidden" id="keepsakeInterestForm">
            <div class="action-selection" id="keepsakeActionSelection"></div>
            <input type="hidden" name="selected_action" value="">
            <div class="interest-fields">
              <input type="text" name="name" autocomplete="name" placeholder="Your name" maxlength="120" required>
              <input type="tel" name="phone" autocomplete="tel" placeholder="Mobile number">
              <input type="email" name="email" autocomplete="email" placeholder="Email address">
            </div>
            <label class="hp-field" aria-hidden="true">Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
            <label class="consent"><input type="checkbox" name="consent" required><span>I agree that the attributed listing agent, loan officer when relevant, and REL8TION may contact me about the request I selected. Recurring alerts or marketing require this explicit opt-in. Consent is not required to view the property.</span></label>
            <button type="submit">Send my request</button>
            <div class="form-status" id="keepsakeFormStatus" role="status" aria-live="polite"></div>
          </form>
          <div class="keepsake-tools"><button type="button" id="shareKeepsake">Share this home</button></div>
        </section>` : ''}

        <div class="actions">
          ${mlsAvailable ? `<a class="button primary" href="${esc(targetUrl)}" rel="noopener noreferrer">Open MLS Listing</a>` : ''}
          ${returnToEvent ? `<a class="button secondary" href="${esc(returnToEvent)}">Back to check-in</a>` : ''}
          ${phoneDigits ? `<a class="button secondary" href="sms:${esc(phoneDigits)}?body=${encodeURIComponent(`Hi${agent ? ` ${agent}` : ''}, I have a question about ${address}.`)}">Ask the host agent</a>` : ''}
          ${!returnToEvent && !mlsAvailable && !phoneDigits ? '<a class="button secondary" href="/">Back To REL8TION</a>' : ''}
        </div>
        <div class="note">Listing information is provided for the open-house experience and should be verified with the listing real estate professional. Loan officer information is provided as an optional resource; no financing application data is collected here. ${property.source ? `Source: ${esc(property.source)}.` : ''}</div>
      </div>
    </section>
  </main>
  ${gallery.length ? `<div class="lightbox" id="propertyLightbox" role="dialog" aria-modal="true" aria-label="Property photo gallery"><div class="lightbox-panel"><div class="lightbox-head"><span id="propertyLightboxCount"></span><button type="button" class="lightbox-close" data-lightbox-close>Close</button></div><img class="lightbox-image" id="propertyLightboxImage" src="${esc(gallery[0])}" alt="${esc(address)}"><div class="lightbox-controls"><button type="button" class="lightbox-nav" data-lightbox-prev>Previous</button><button type="button" class="lightbox-nav" data-lightbox-next>Next</button></div></div></div>` : ''}
  <script>
    const propertyGallery = ${galleryJson};
    const propertyLightbox = document.getElementById('propertyLightbox');
    const propertyLightboxImage = document.getElementById('propertyLightboxImage');
    const propertyLightboxCount = document.getElementById('propertyLightboxCount');
    let propertyGalleryIndex = 0;
    function showPropertyPhoto(index) {
      if (!propertyGallery.length || !propertyLightbox) return;
      propertyGalleryIndex = (index + propertyGallery.length) % propertyGallery.length;
      propertyLightboxImage.src = propertyGallery[propertyGalleryIndex];
      propertyLightboxCount.textContent = 'Photo ' + (propertyGalleryIndex + 1) + ' of ' + propertyGallery.length;
    }
    function openPropertyGallery(index) {
      showPropertyPhoto(index);
      propertyLightbox.classList.add('open');
      document.body.classList.add('lightbox-open');
      propertyLightbox.querySelector('[data-lightbox-close]').focus();
    }
    function closePropertyGallery() {
      if (!propertyLightbox) return;
      propertyLightbox.classList.remove('open');
      document.body.classList.remove('lightbox-open');
    }
    document.querySelectorAll('[data-gallery-index]').forEach((button) => button.addEventListener('click', () => openPropertyGallery(Number(button.dataset.galleryIndex || 0))));
    document.querySelector('[data-lightbox-close]')?.addEventListener('click', closePropertyGallery);
    document.querySelector('[data-lightbox-prev]')?.addEventListener('click', () => showPropertyPhoto(propertyGalleryIndex - 1));
    document.querySelector('[data-lightbox-next]')?.addEventListener('click', () => showPropertyPhoto(propertyGalleryIndex + 1));
    propertyLightbox?.addEventListener('click', (event) => { if (event.target === propertyLightbox) closePropertyGallery(); });
    document.addEventListener('keydown', (event) => {
      if (!propertyLightbox?.classList.contains('open')) return;
      if (event.key === 'Escape') closePropertyGallery();
      if (event.key === 'ArrowLeft') showPropertyPhoto(propertyGalleryIndex - 1);
      if (event.key === 'ArrowRight') showPropertyPhoto(propertyGalleryIndex + 1);
    });
    document.querySelectorAll('[data-save-contact]').forEach((button) => button.addEventListener('click', () => {
      let contact = {};
      try { contact = JSON.parse(button.dataset.saveContact || '{}'); } catch (_) {}
      const escapeVcard = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
      const vcard = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:' + escapeVcard(contact.name),
        contact.title ? 'TITLE:' + escapeVcard(contact.title) : '',
        contact.company ? 'ORG:' + escapeVcard(contact.company) : '',
        contact.phone ? 'TEL;TYPE=CELL:' + escapeVcard(contact.phone) : '',
        contact.email ? 'EMAIL:' + escapeVcard(contact.email) : '',
        contact.url ? 'URL:' + escapeVcard(contact.url) : '',
        'END:VCARD'
      ].filter(Boolean).join('\r\n');
      const blob = new Blob([vcard], { type: 'text/vcard;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = String(contact.name || 'rel8tion-contact').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.vcf';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }));
    const keepsakeForm = document.getElementById('keepsakeInterestForm');
    const homekeyCode = ${JSON.stringify(homekey?.public_code || '')};
    const homekeyActionLabels = {
      home_saved: 'Save This Home',
      agent_relationship: 'I Want This Agent To Help Me',
      similar_homes: 'Show Me Similar Homes',
      off_market: 'Tell Me About Off-Market Opportunities',
      price_alert: 'Alert Me If The Price Changes',
      different_area: "I'm Looking Somewhere Else",
      financing_help: 'Financing Help'
    };
    document.querySelectorAll('[data-homekey-action]').forEach((button) => button.addEventListener('click', () => {
      if (!keepsakeForm) return;
      const action = button.dataset.homekeyAction || '';
      keepsakeForm.elements.selected_action.value = action;
      let detail = keepsakeForm.elements.request_detail;
      if (!detail) {
        detail = document.createElement('input');
        detail.type = 'hidden';
        detail.name = 'request_detail';
        keepsakeForm.appendChild(detail);
      }
      detail.value = button.textContent.trim();
      document.getElementById('keepsakeActionSelection').textContent = 'Selected: ' + (homekeyActionLabels[action] || button.textContent.trim());
      keepsakeForm.classList.remove('hidden');
      keepsakeForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
      keepsakeForm.elements.name?.focus({ preventScroll: true });
    }));
    keepsakeForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = document.getElementById('keepsakeFormStatus');
      const submit = keepsakeForm.querySelector('button[type="submit"]');
      const form = new FormData(keepsakeForm);
      const selectedAction = String(form.get('selected_action') || '');
      if (!selectedAction) {
        status.textContent = 'Choose an action first.';
        return;
      }
      submit.disabled = true;
      status.textContent = 'Saving your preferences...';
      try {
        const response = await fetch('/api/open-house-keepsake-interest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            homekey_code: homekeyCode,
            selected_action: selectedAction,
            request_detail: form.get('request_detail'),
            name: form.get('name'),
            phone: form.get('phone'),
            email: form.get('email'),
            website: form.get('website'),
            consent: form.get('consent') === 'on'
          })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok === false) throw new Error(result.error || 'Unable to save your preferences.');
        status.textContent = result.updated_existing ? 'Updated — your choices are saved without creating a duplicate.' : 'Saved — you are connected. Keep this little house handy.';
      } catch (error) {
        status.textContent = error.message || 'Unable to save your preferences.';
      } finally {
        submit.disabled = false;
      }
    });
    async function recordHomekeyEvent(eventType, metadata = {}) {
      if (!homekeyCode) return;
      await fetch('/api/homekey-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({ homekey_code: homekeyCode, event_type: eventType, metadata })
      }).catch(() => null);
    }
    document.querySelectorAll('[data-homekey-contact]').forEach((link) => link.addEventListener('click', () => {
      const kind = link.dataset.homekeyContact === 'loan_officer'
        ? 'loan_officer_contact_clicked'
        : 'agent_contact_clicked';
      recordHomekeyEvent(kind, { label: String(link.textContent || '').trim().slice(0, 80) });
    }));
    document.getElementById('shareKeepsake')?.addEventListener('click', async () => {
      const shareData = { title: document.title, text: 'Keep this home and its local contacts handy.', url: window.location.href };
      if (navigator.share) {
        await navigator.share(shareData).catch(() => null);
      } else {
        await navigator.clipboard?.writeText(window.location.href).catch(() => null);
        const status = document.getElementById('keepsakeFormStatus');
        if (status) status.textContent = 'Property link copied.';
      }
    });
  </script>
</body>
</html>`;
}

async function trackHomeKeyView(homekey) {
  if (!homekey?.id) return;
  await supabaseRest('property_keepsake_events', {
    method: 'POST',
    body: JSON.stringify({
      property_keepsake_id: homekey.id,
      event_type: 'homekey_viewed',
      metadata: {}
    })
  }).catch(() => null);
}

module.exports = async function handler(req, res) {
  try {
    if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
      res.setHeader('Allow', 'GET, HEAD');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }

    const homekeyCode = cleanId(readQuery(req, 'homekey'));
    const homekey = homekeyCode ? await loadHomeKey(homekeyCode).catch(() => null) : null;
    if (homekeyCode && !homekey) {
      return sendJson(res, 404, { ok: false, error: 'HomeKey not found.' });
    }
    const id = cleanId(homekey?.open_house_id || readQuery(req, 'id'));
    if (!id) {
      return sendJson(res, 400, { ok: false, error: 'Missing listing id.' });
    }

    const buyerEventId = cleanId(readQuery(req, 'event'));
    const listing = await resolveListing(id);
    if (homekey?.open_house_event_id) {
      const attributedEvent = await loadEvent(homekey.open_house_event_id).catch(() => null);
      if (attributedEvent) {
        listing.event = attributedEvent;
        listing.targetUrl = listing.targetUrl || setupContextUrl(attributedEvent);
      }
    }
    if (buyerEventId && !listing.event) {
      const buyerEvent = await loadEvent(buyerEventId).catch(() => null);
      if (buyerEvent && (!listing.house?.id || String(buyerEvent.open_house_source_id || '') === String(listing.house.id))) {
        listing.event = buyerEvent;
        listing.targetUrl = listing.targetUrl || setupContextUrl(buyerEvent);
      }
    }
    const targetUrl = listing.targetUrl || '';

    if (readQuery(req, 'direct') === '1') {
      if (!targetUrl) {
        return sendJson(res, 404, { ok: false, error: 'No listing link is saved for this open house.' });
      }
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
      res.writeHead(302, { Location: targetUrl });
      return res.end();
    }

    if (readQuery(req, 'format') === 'json') {
      const externalCheck = await checkExternalUrl(targetUrl);
      const shortUrl = `${requestOrigin(req)}/l/${encodeURIComponent(id)}`;
      return sendJson(res, 200, {
        ok: Boolean(listing.house || listing.event),
        id,
        short_url: shortUrl,
        direct_url: targetUrl ? `${shortUrl}?direct=1` : '',
        listing_url: targetUrl,
        external_available: externalCheck.available,
        external_status: externalCheck.status,
        external_final_url: externalCheck.final_url,
        external_reason: externalCheck.reason,
        sms_label: targetUrl && externalCheck.available ? 'MLS page' : 'Property page'
      });
    }

    if (!listing.house && homekey) {
      const stored = await loadStoredPropertyProfile(id).catch(() => null);
      listing.house = {
        ...(stored || {}),
        id,
        address: stored?.address || 'Your HomeKey property',
        _homekey_source_missing: true
      };
    }

    if (!listing.house && !listing.event) {
      return sendJson(res, 404, { ok: false, error: 'No open house was found for this link.' });
    }

    const profile = await loadPropertyProfile({
      house: listing.house,
      event: listing.event,
      targetUrl
    }).catch(() => buildPropertyProfile({
      house: listing.house,
      event: listing.event,
      targetUrl
    }));
    const propertyTargetUrl = targetUrl || profile?.listing_url || '';
    const externalCheck = await checkExternalUrl(propertyTargetUrl);
    const images = propertyImages(profile || listing.house);
    const people = homekey
      ? await loadKeepsakePeople({ house: listing.house, event: listing.event, profile, homekey })
      : { agents: [], loanOfficer: null };
    if (homekey && req.method !== 'HEAD') await trackHomeKeyView(homekey);

    res.setHeader('Cache-Control', homekey ? 'no-store, no-cache, max-age=0, must-revalidate' : 'public, max-age=300, s-maxage=300');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderListingPage({
      id,
      ...listing,
      profile,
      targetUrl: propertyTargetUrl,
      externalCheck,
      images,
      buyerEventId,
      origin: requestOrigin(req),
      keepsake: Boolean(homekey),
      homekey,
      agents: people.agents,
      loanOfficer: people.loanOfficer
    }));
  } catch (error) {
    return sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to open listing link.'
    });
  }
};

module.exports.__test = {
  buildPropertyProfile,
  collectDeepImageUrls,
  loadOneKeyPropertyImages,
  loadOneKeyRecord,
  loadPropertyImages,
  loadPropertyProfile,
  loadKeepsakePeople,
  oneKeyImageIdentifiers,
  propertyProfileIsFresh,
  propertyImages,
  renderListingPage,
  uniqueExternalUrls
};
