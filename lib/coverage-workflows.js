const { supabaseRest } = require('./admin-auth');

function enc(value) {
  return encodeURIComponent(String(value || '').trim());
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && clean(value) !== '') return value;
  }
  return '';
}

function httpError(status, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

async function list(path) {
  const rows = await supabaseRest(path);
  return Array.isArray(rows) ? rows : [];
}

async function maybeOne(path) {
  const rows = await list(`${path}${path.includes('?') ? '&' : '?'}limit=1`);
  return rows[0] || null;
}

async function one(path, label) {
  const row = await maybeOne(path);
  if (!row) throw httpError(404, `${label} not found.`);
  return row;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function slugify(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 52) || 'agent';
}

function isGenericAgentName(value) {
  const normalized = clean(value).toLowerCase();
  return !normalized
    || normalized === 'agent'
    || normalized === 'listing agent'
    || normalized === 'unknown agent'
    || normalized === 'real estate agent'
    || /^agent\s+(phone|email|name)\s*:?\s*$/i.test(normalized);
}

function safeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function addHoursIso(value, hours = 2) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function extractZip(...values) {
  for (const value of values) {
    const match = String(value || '').match(/\b(\d{5})(?:-\d{4})?\b/);
    if (match) return match[1];
  }
  return '';
}

function syntheticSmartSignUid(prefix, publicCode) {
  const cleanPrefix = slugify(prefix || 'qr-only').slice(0, 28) || 'qr-only';
  const cleanCode = slugify(publicCode || Date.now().toString(36)).slice(0, 80);
  return `synthetic:${cleanPrefix}:${cleanCode || Date.now().toString(36)}`;
}

function publicProfile(profile = null) {
  if (!profile) return null;
  return {
    id: profile.id || profile.uid || '',
    uid: profile.uid || profile.id || '',
    slug: profile.slug || '',
    full_name: profile.full_name || '',
    title: profile.title || '',
    company_name: profile.company_name || '',
    phone: profile.phone || '',
    email: profile.email || '',
    photo_url: profile.photo_url || '',
    cta_url: profile.cta_url || '',
    calendar_url: profile.calendar_url || '',
    is_active: profile.is_active !== false
  };
}

function sponsorDisplayName(profile = {}) {
  return clean(profile.full_name || profile.slug || 'the sponsoring loan officer');
}

function sponsorCompany(profile = {}) {
  return clean(profile.company_name || profile.company || 'Rel8tion event support');
}

function sponsoredConsentText(profile = {}) {
  return `This Sponsored Event Pass was issued by ${sponsorDisplayName(profile)}, ${sponsorCompany(profile)}. By activating it for this open house, you authorize this loan officer to be assigned as the live coverage provider for this event. You understand that buyer check-in activity and event-related contact information may be shared with the sponsoring loan officer so they can support this open house, respond to buyer questions, and assist when buyers request financing help. You remain responsible for your open house, brokerage requirements, and your relationships with buyers, sellers, and clients.`;
}

function getClientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'] || req.headers?.['X-Forwarded-For'] || '';
  return String(forwarded).split(',')[0].trim() || req.socket?.remoteAddress || '';
}

function userAgent(req) {
  return String(req.headers?.['user-agent'] || req.headers?.['User-Agent'] || '');
}

async function loadVerifiedProfile({ profileId = '', uid = '' } = {}) {
  const id = clean(profileId);
  const profileUid = clean(uid);
  const tries = [];
  if (id) tries.push(`verified_profiles?uid=eq.${enc(id)}&select=*`);
  if (id) tries.push(`verified_profiles?id=eq.${enc(id)}&select=*`);
  if (profileUid) tries.push(`verified_profiles?uid=eq.${enc(profileUid)}&select=*`);
  if (profileUid) tries.push(`verified_profiles?id=eq.${enc(profileUid)}&select=*`);

  for (const path of tries) {
    const row = await maybeOne(path).catch(() => null);
    if (row) return row;
  }
  return null;
}

async function loadOpenHouse(openHouseId) {
  if (!openHouseId) return null;
  return maybeOne(`open_houses?id=eq.${enc(openHouseId)}&select=*`).catch(() => null);
}

function propertyAddress(house = {}) {
  return clean(firstPresent(
    house.address,
    house.property_address,
    house.listing_address,
    house.full_address,
    house.UnparsedAddress
  ));
}

function listingPhoto(house = {}) {
  return clean(firstPresent(
    house.listing_photo_url,
    house.primary_photo_url,
    house.photo_url,
    house.image_url,
    house.thumbnail_url,
    Array.isArray(house.media) ? house.media[0]?.url || house.media[0]?.MediaURL : ''
  ));
}

function normalizeOpenHouse(payload = {}, loaded = null) {
  const source = { ...(loaded || {}), ...(payload || {}) };
  return {
    ...source,
    id: clean(firstPresent(source.id, source.open_house_id)),
    address: propertyAddress(source),
    city: clean(source.city || source.City || ''),
    state: clean(source.state || source.StateOrProvince || ''),
    zip: clean(source.zip || source.PostalCode || ''),
    price: firstPresent(source.price, source.list_price, source.ListPrice),
    beds: firstPresent(source.beds, source.bedrooms, source.BedroomsTotal),
    baths: firstPresent(source.baths, source.bathrooms, source.BathroomsTotal),
    sqft: firstPresent(source.sqft, source.square_feet, source.LivingArea),
    brokerage: clean(source.brokerage || source.office_name || source.listing_office_name || ''),
    listing_photo_url: listingPhoto(source),
    open_start: firstPresent(source.open_start, source.start_time),
    open_end: firstPresent(source.open_end, source.end_time),
    listing_url: clean(firstPresent(source.listing_url, source.link, source.url, source.mls_url))
  };
}

function hasUsefulInput(value) {
  return value !== undefined && value !== null && clean(value) !== '';
}

function mergeNonEmpty(...objects) {
  return objects.reduce((acc, object) => {
    Object.entries(object || {}).forEach(([key, value]) => {
      if (hasUsefulInput(value)) acc[key] = value;
    });
    return acc;
  }, {});
}

async function loadListingAgents(openHouseId) {
  if (!openHouseId) return [];
  return list(`listing_agents?open_house_id=eq.${enc(openHouseId)}&select=*&limit=10`).catch(() => []);
}

async function loadAgentBySlug(slug) {
  const agentSlug = clean(slug);
  if (!agentSlug) return null;
  return maybeOne(`agents?slug=eq.${enc(agentSlug)}&select=*`).catch(() => null);
}

function normalizeListingAgent(row = {}) {
  return {
    name: clean(firstPresent(row.name, row.agent_name, row.full_name, row.member_name)),
    phone: clean(firstPresent(row.phone, row.agent_phone)),
    phone_normalized: normalizePhone(firstPresent(row.phone_normalized, row.phone, row.agent_phone)),
    email: normalizeEmail(firstPresent(row.email, row.agent_email)),
    brokerage: clean(firstPresent(row.brokerage, row.office_name, row.company)),
    image_url: clean(firstPresent(row.primary_photo_url, row.photo_url, row.directory_photo_url, row.image_url))
  };
}

function pickAgentInput(input = {}, house = {}, listingAgent = {}) {
  return {
    slug: clean(input.slug || input.agent_slug || ''),
    name: clean(firstPresent(input.name, input.agent_name, listingAgent.name, house.agent_name, house.listing_agent_name)),
    phone: clean(firstPresent(input.phone, input.agent_phone, listingAgent.phone, house.agent_phone)),
    phone_normalized: normalizePhone(firstPresent(input.phone_normalized, input.phone, input.agent_phone, listingAgent.phone_normalized, listingAgent.phone, house.agent_phone)),
    email: normalizeEmail(firstPresent(input.email, input.agent_email, listingAgent.email, house.agent_email)),
    brokerage: clean(firstPresent(input.brokerage, listingAgent.brokerage, house.brokerage)),
    image_url: clean(firstPresent(input.image_url, input.photo_url, listingAgent.image_url, house.agent_photo_url))
  };
}

function compactOpenHouseSeed(house = {}, event = null) {
  return {
    id: house.id || event?.open_house_source_id || '',
    address: house.address || '',
    city: house.city || '',
    state: house.state || '',
    zip: house.zip || '',
    price: house.price || null,
    beds: house.beds || null,
    baths: house.baths || null,
    sqft: house.sqft || null,
    brokerage: house.brokerage || '',
    listing_photo_url: house.listing_photo_url || '',
    listing_url: house.listing_url || '',
    open_start: house.open_start || event?.start_time || '',
    open_end: house.open_end || event?.end_time || ''
  };
}

function compactAgentSeed(agent = {}) {
  return {
    slug: agent.slug || agent.agent_slug || '',
    name: agent.name || agent.agent_name || agent.full_name || '',
    phone: agent.phone || agent.agent_phone || '',
    phone_normalized: agent.phone_normalized || normalizePhone(agent.phone || agent.agent_phone || ''),
    email: agent.email || agent.agent_email || '',
    brokerage: agent.brokerage || '',
    image_url: clean(firstPresent(agent.image_url, agent.photo_url, agent.agent_photo_url, agent.primary_photo_url))
  };
}

function timestampMs(value) {
  const stamp = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(stamp) ? stamp : 0;
}

function seedContextConsumed(inventory = {}, metadata = {}) {
  const nested = safeMetadata(metadata.seeded_context);
  const seedAt = firstPresent(metadata.seeded_at, metadata.issued_at, nested.seeded_at, nested.issued_at);
  const consumedAt = firstPresent(metadata.seed_consumed_at, nested.consumed_at);
  const lastActivatedAt = firstPresent(safeMetadata(metadata.latest_activation).activated_at, inventory.last_activated_at);

  if (!seedAt) return Boolean(lastActivatedAt && firstPresent(metadata.issued_for_event_id, metadata.seeded_open_house_event_id));
  const seedMs = timestampMs(seedAt);
  return Boolean(seedMs && (
    (timestampMs(consumedAt) && timestampMs(consumedAt) >= seedMs)
    || (timestampMs(lastActivatedAt) && timestampMs(lastActivatedAt) >= seedMs)
  ));
}

async function buildSponsoredPassSeedContext(inventory = {}) {
  const metadata = safeMetadata(inventory.metadata);
  if (seedContextConsumed(inventory, metadata)) return null;

  const nested = safeMetadata(metadata.seeded_context);
  const metaHouse = mergeNonEmpty(
    safeMetadata(nested.open_house),
    safeMetadata(metadata.open_house),
    safeMetadata(metadata.seeded_open_house)
  );
  const metaAgent = mergeNonEmpty(
    safeMetadata(nested.agent),
    safeMetadata(metadata.agent),
    safeMetadata(metadata.seeded_agent)
  );

  let coverageSign = null;
  let eventId = clean(firstPresent(
    nested.event_id,
    metadata.seeded_open_house_event_id,
    metadata.issued_for_event_id
  ));
  if (!eventId && inventory.id) {
    coverageSign = await maybeOne(
      `loan_officer_coverage_signs?active_event_pass_inventory_id=eq.${enc(inventory.id)}&select=*&order=updated_at.desc&limit=1`
    ).catch(() => null);
    eventId = clean(coverageSign?.active_event_id || '');
  }

  const event = eventId ? await loadEventById(eventId).catch(() => null) : null;
  const eventContext = safeMetadata(event?.setup_context);
  const openHouseId = clean(firstPresent(
    metaHouse.id,
    metaHouse.open_house_id,
    nested.open_house_id,
    metadata.seeded_open_house_id,
    metadata.issued_for_open_house_id,
    eventContext.open_house_id,
    event?.open_house_source_id
  ));
  const loadedHouse = openHouseId ? await loadOpenHouse(openHouseId).catch(() => null) : null;
  const housePayload = mergeNonEmpty(eventContext, metaHouse, {
    id: openHouseId,
    address: firstPresent(metaHouse.address, metaHouse.property_address, eventContext.address, eventContext.property_address),
    open_start: firstPresent(metaHouse.open_start, eventContext.open_start, event?.start_time),
    open_end: firstPresent(metaHouse.open_end, eventContext.open_end, event?.end_time)
  });
  const house = normalizeOpenHouse(housePayload, loadedHouse);

  const agentSlug = clean(firstPresent(
    metaAgent.slug,
    metaAgent.agent_slug,
    metadata.issued_for_agent_slug,
    inventory.assigned_agent_slug,
    eventContext.agent_slug,
    event?.host_agent_slug
  ));
  const loadedAgent = await loadAgentBySlug(agentSlug);
  const agent = compactAgentSeed(mergeNonEmpty({
    slug: agentSlug,
    name: eventContext.agent_name,
    phone: inventory.assigned_agent_phone || eventContext.agent_phone,
    email: eventContext.agent_email,
    brokerage: eventContext.brokerage
  }, metaAgent, loadedAgent || {}));

  if (!event?.id && !house.id && !house.address && !agent.slug && !agent.name && !agent.phone) return null;

  return {
    source: 'loan_officer_coverage_sign',
    event,
    event_id: event?.id || eventId || '',
    prepared_at: clean(firstPresent(metadata.seeded_at, metadata.issued_at, nested.seeded_at)),
    loan_officer_coverage_sign_id: coverageSign?.id || metadata.issued_by_loan_officer_coverage_sign_id || nested.loan_officer_coverage_sign_id || '',
    loan_officer_coverage_sign_public_code: coverageSign?.public_code || nested.loan_officer_coverage_sign_public_code || '',
    open_house: compactOpenHouseSeed(house, event),
    agent
  };
}

function publicSeedContext(seed = null) {
  if (!seed) return null;
  return {
    source: seed.source || '',
    event_id: seed.event_id || '',
    prepared_at: seed.prepared_at || '',
    loan_officer_coverage_sign_id: seed.loan_officer_coverage_sign_id || '',
    loan_officer_coverage_sign_public_code: seed.loan_officer_coverage_sign_public_code || '',
    open_house: seed.open_house || null,
    agent: seed.agent || null
  };
}

async function uniqueAgentSlug(seed) {
  const base = slugify(seed);
  for (let index = 0; index < 20; index += 1) {
    const slug = index === 0 ? base : `${base}-${index + 1}`;
    const existing = await maybeOne(`agents?slug=eq.${enc(slug)}&select=slug`).catch(() => null);
    if (!existing) return slug;
  }
  return `${base}-${Date.now().toString(36).slice(-5)}`;
}

function agentPatch(existing, input) {
  const patch = {};
  if (!existing.name || isGenericAgentName(existing.name)) {
    if (input.name && !isGenericAgentName(input.name)) patch.name = input.name;
  }
  if (!existing.phone && input.phone) patch.phone = input.phone;
  if (!existing.phone_normalized && input.phone_normalized) patch.phone_normalized = input.phone_normalized;
  if (!existing.email && input.email) patch.email = input.email;
  if (!existing.brokerage && input.brokerage) patch.brokerage = input.brokerage;
  if (!existing.image_url && input.image_url) patch.image_url = input.image_url;
  return patch;
}

async function ensureAgent(input = {}, house = {}) {
  const listingAgents = await loadListingAgents(house.id);
  const listingAgent = listingAgents.map(normalizeListingAgent)
    .find((row) => row.name || row.phone_normalized || row.email) || {};
  const agent = pickAgentInput(input, house, listingAgent);

  let existing = null;
  if (agent.slug) existing = await maybeOne(`agents?slug=eq.${enc(agent.slug)}&select=*`).catch(() => null);
  if (!existing && agent.phone_normalized) existing = await maybeOne(`agents?phone_normalized=eq.${enc(agent.phone_normalized)}&select=*`).catch(() => null);
  if (!existing && agent.email) existing = await maybeOne(`agents?email=eq.${enc(agent.email)}&select=*`).catch(() => null);

  if (existing) {
    const patch = agentPatch(existing, agent);
    if (Object.keys(patch).length) {
      const rows = await supabaseRest(`agents?slug=eq.${enc(existing.slug)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(patch)
      });
      return Array.isArray(rows) && rows[0] ? rows[0] : { ...existing, ...patch };
    }
    return existing;
  }

  if (!agent.name || isGenericAgentName(agent.name)) {
    throw httpError(400, 'Add the host agent name before activating.');
  }
  if (!agent.phone_normalized && !agent.email) {
    throw httpError(400, 'Add the host agent phone or email before activating.');
  }

  const slug = await uniqueAgentSlug(agent.slug || agent.name || agent.phone_normalized);
  const rows = await supabaseRest('agents', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      slug,
      name: agent.name,
      phone: agent.phone,
      phone_normalized: agent.phone_normalized || null,
      email: agent.email || null,
      brokerage: agent.brokerage || null,
      image_url: agent.image_url || null
    })
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : { ...agent, slug };
}

async function loadInventoryByCode(publicCode) {
  return one(`smart_sign_inventory?public_code=eq.${enc(publicCode)}&select=*`, 'Event Pass inventory');
}

async function loadSignById(signId) {
  if (!signId) return null;
  return maybeOne(`smart_signs?id=eq.${enc(signId)}&select=*`).catch(() => null);
}

async function loadEventById(eventId) {
  if (!eventId) return null;
  return maybeOne(`open_house_events?id=eq.${enc(eventId)}&select=*`).catch(() => null);
}

function isLiveEvent(event = null) {
  return Boolean(event?.id && event.status === 'active' && !event.ended_at);
}

async function ensureSmartSignForInventory(inventory, agent, method) {
  if (inventory.smart_sign_id) {
    const sign = await loadSignById(inventory.smart_sign_id);
    if (sign) return sign;
  }

  const existing = await maybeOne(`smart_signs?public_code=eq.${enc(inventory.public_code)}&select=*&order=created_at.desc&limit=1`).catch(() => null);
  if (existing) return existing;

  const now = nowIso();
  const rows = await supabaseRest('smart_signs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      public_code: inventory.public_code,
      uid_primary: syntheticSmartSignUid('event-pass-qr', inventory.public_code),
      status: 'inactive',
      owner_agent_slug: agent.slug || null,
      assigned_agent_slug: agent.slug || null,
      activation_method: method,
      primary_device_type: 'event_pass_qr',
      setup_confirmed_at: now,
      updated_at: now
    })
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function ensureSyntheticSmartSign(publicCode, agent, method) {
  const code = `lo-${clean(publicCode)}`;
  const existing = await maybeOne(`smart_signs?public_code=eq.${enc(code)}&select=*&order=created_at.desc&limit=1`).catch(() => null);
  if (existing) return existing;
  const now = nowIso();
  const rows = await supabaseRest('smart_signs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      public_code: code,
      uid_primary: syntheticSmartSignUid('lo-coverage-sign', publicCode),
      status: 'inactive',
      owner_agent_slug: agent.slug || null,
      assigned_agent_slug: agent.slug || null,
      activation_method: method,
      primary_device_type: 'loan_officer_coverage_qr',
      setup_confirmed_at: now,
      updated_at: now
    })
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function assertNoDifferentLiveEvent(sign, house, agent) {
  if (!sign?.active_event_id) return null;
  const active = await loadEventById(sign.active_event_id);
  if (!isLiveEvent(active)) return null;
  const sameHouse = house.id && active.open_house_source_id && String(house.id) === String(active.open_house_source_id);
  const sameAgent = agent.slug && active.host_agent_slug && agent.slug === active.host_agent_slug;
  if (sameHouse && sameAgent) return active;
  throw httpError(409, 'This pass already has a live event. End the current event before activating a new one.', {
    event_id: active.id
  });
}

function eventSetupContext({ source, house, agent, sponsor, eventPassInventoryId = '', loanOfficerSignId = '', extra = {} }) {
  return {
    source,
    qr_source: source,
    event_pass_inventory_id: eventPassInventoryId || null,
    loan_officer_coverage_sign_id: loanOfficerSignId || null,
    sponsor_loan_officer_profile_id: sponsor?.id || sponsor?.uid || null,
    sponsor_loan_officer_uid: sponsor?.uid || sponsor?.id || null,
    sponsor_loan_officer_name: sponsor?.full_name || '',
    sponsor_loan_officer_company: sponsor?.company_name || '',
    agent_slug: agent.slug || '',
    agent_name: agent.name || '',
    agent_phone: agent.phone || '',
    agent_email: agent.email || '',
    brokerage: agent.brokerage || '',
    address: house.address || '',
    city: house.city || '',
    state: house.state || '',
    zip: house.zip || '',
    price: house.price || null,
    beds: house.beds || null,
    baths: house.baths || null,
    sqft: house.sqft || null,
    listing_photo_url: house.listing_photo_url || '',
    listing_url: house.listing_url || '',
    compliance_note: 'Sponsored technology and live event support. Buyer financing help is routed only when explicitly requested.',
    ...extra
  };
}

async function createOpenHouseEvent({ sign, house, agent, source, sponsor, eventPassInventoryId = '', loanOfficerSignId = '', extraContext = {} }) {
  const live = await assertNoDifferentLiveEvent(sign, house, agent);
  if (live) return live;

  const now = nowIso();
  const rows = await supabaseRest('open_house_events', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      smart_sign_id: sign?.id || null,
      open_house_source_id: house.id || null,
      host_agent_slug: agent.slug,
      status: 'active',
      start_time: house.open_start || now,
      end_time: house.open_end || null,
      activation_method: source,
      setup_confirmed_at: now,
      last_activity_at: now,
      setup_context: eventSetupContext({
        source,
        house,
        agent,
        sponsor,
        eventPassInventoryId,
        loanOfficerSignId,
        extra: extraContext
      })
    })
  });
  const event = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!event?.id) throw httpError(500, 'Unable to create open house event.');
  return event;
}

function eventMatchesHouseAndAgent(event = null, house = {}, agent = {}) {
  if (!event?.id) return false;
  const sameHouse = !event.open_house_source_id || !house.id || String(event.open_house_source_id) === String(house.id);
  const sameAgent = !event.host_agent_slug || !agent.slug || event.host_agent_slug === agent.slug;
  return sameHouse && sameAgent;
}

async function attachSponsoredPassContextToEvent({ event, inventory, agent, house, sponsor, extraContext = {} }) {
  if (!event?.id) return event;
  const now = nowIso();
  const setupContext = {
    ...safeMetadata(event.setup_context),
    event_pass_inventory_id: inventory.id || null,
    sponsor_loan_officer_profile_id: sponsor?.id || sponsor?.uid || null,
    sponsor_loan_officer_uid: sponsor?.uid || sponsor?.id || null,
    sponsor_loan_officer_name: sponsor?.full_name || '',
    sponsor_loan_officer_company: sponsor?.company_name || '',
    agent_slug: agent.slug || event.host_agent_slug || '',
    agent_name: agent.name || '',
    agent_phone: agent.phone || '',
    agent_email: agent.email || '',
    brokerage: agent.brokerage || '',
    address: house.address || safeMetadata(event.setup_context).address || '',
    compliance_note: 'Sponsored technology and live event support. Buyer financing help is routed only when explicitly requested.',
    ...extraContext
  };
  const rows = await supabaseRest(`open_house_events?id=eq.${enc(event.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      host_agent_slug: agent.slug || event.host_agent_slug || null,
      last_activity_at: now,
      setup_context: setupContext
    })
  }).catch(() => null);
  return Array.isArray(rows) && rows[0] ? rows[0] : { ...event, setup_context: setupContext };
}

async function activateSmartSign(sign, event, agent, method) {
  const rows = await supabaseRest(`smart_signs?id=eq.${enc(sign.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      active_event_id: event.id,
      status: 'active',
      owner_agent_slug: agent.slug || sign.owner_agent_slug || null,
      assigned_agent_slug: agent.slug || sign.assigned_agent_slug || null,
      activation_method: method,
      deactivated_at: null,
      setup_confirmed_at: nowIso(),
      updated_at: nowIso()
    })
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : { ...sign, active_event_id: event.id, status: 'active' };
}

async function upsertLoanOfficerSession({ eventId, profile, source, metadata = {} }) {
  const now = nowIso();
  const existing = await maybeOne(`event_loan_officer_sessions?open_house_event_id=eq.${enc(eventId)}&status=eq.live&select=*`).catch(() => null);
  const payload = {
    verified_profile_uid: profile.uid || profile.id || null,
    loan_officer_uid: profile.uid || profile.id || null,
    loan_officer_slug: profile.slug || '',
    loan_officer_name: profile.full_name || '',
    loan_officer_title: profile.title || '',
    loan_officer_company: profile.company_name || '',
    loan_officer_phone: profile.phone || '',
    loan_officer_email: profile.email || '',
    loan_officer_photo_url: profile.photo_url || '',
    loan_officer_cta_url: profile.cta_url || '',
    loan_officer_calendar_url: profile.calendar_url || '',
    status: 'live',
    signed_out_at: null,
    last_seen_at: now,
    updated_at: now,
    source,
    metadata: {
      ...safeMetadata(existing?.metadata),
      source,
      ...metadata
    }
  };

  const path = existing?.id
    ? `event_loan_officer_sessions?id=eq.${enc(existing.id)}`
    : 'event_loan_officer_sessions';
  const method = existing?.id ? 'PATCH' : 'POST';
  if (!existing?.id) payload.open_house_event_id = eventId;

  try {
    const rows = await supabaseRest(path, {
      method,
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    });
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (error) {
    if (!/source|metadata|schema cache|PGRST204/i.test(error.message || '')) throw error;
    delete payload.source;
    delete payload.metadata;
    const rows = await supabaseRest(path, {
      method,
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    });
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }
}

async function ensureFieldDashboardVisitForCoverage({ event, house, agent, profile, coverageSign, activeSmartSign }) {
  if (!event?.id || !profile) return null;
  const existingVisit = await maybeOne(`field_demo_visits?open_house_event_id=eq.${enc(event.id)}&select=*`).catch(() => null);
  const now = nowIso();
  const start = event.start_time || house.open_start || now;
  const end = event.end_time || house.open_end || addHoursIso(start, 2);
  let visit = existingVisit;

  if (!visit?.id) {
    const visitRows = await supabaseRest('field_demo_visits', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        open_house_id: house.id || event.open_house_source_id || null,
        open_house_event_id: event.id,
        agent_slug: agent.slug || event.host_agent_slug || null,
        agent_name: agent.name || null,
        agent_phone: agent.phone || null,
        agent_email: agent.email || null,
        brokerage: agent.brokerage || null,
        demo_sign_id: activeSmartSign?.id || null,
        demo_public_code: activeSmartSign?.public_code || null,
        property_zip: house.zip || extractZip(house.address),
        scheduled_start: start,
        scheduled_end: end,
        status: 'live',
        coverage_mode: 'physical_support',
        demo_type: 'buyer_financing_support',
        source: 'loan_officer_coverage_sign',
        notes: 'Created from Loan Officer Coverage Sign activation so the LO field dashboard can render this live event.',
        live_started_at: now
      })
    });
    visit = Array.isArray(visitRows) && visitRows[0] ? visitRows[0] : null;
  }

  if (!visit?.id) return null;

  const profileUid = clean(profile.uid || profile.id);
  if (!profileUid) return { visit, participant: null, coverage_sign_id: coverageSign?.id || '' };

  const participantFilters = [`participant_uid.eq.${enc(profileUid)}`];
  if (isUuid(profileUid)) participantFilters.push(`participant_profile_id.eq.${enc(profileUid)}`);
  const existingParticipant = await maybeOne(
    `field_demo_visit_participants?field_demo_visit_id=eq.${enc(visit.id)}&responsibility=eq.financing_support&or=(${participantFilters.join(',')})&select=*`
  ).catch(() => null);

  let participant = existingParticipant;
  if (!participant?.id) {
    const participantRows = await supabaseRest('field_demo_visit_participants', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        field_demo_visit_id: visit.id,
        participant_profile_id: isUuid(profileUid) ? profileUid : null,
        participant_uid: profileUid || null,
        participant_name: profile.full_name || profile.slug || null,
        participant_phone: profile.phone || null,
        participant_email: profile.email || null,
        participant_company: profile.company_name || null,
        role: 'loan_officer',
        responsibility: 'financing_support',
        status: 'live',
        is_primary: true
      })
    });
    participant = Array.isArray(participantRows) && participantRows[0] ? participantRows[0] : null;
  }

  return { visit, participant, coverage_sign_id: coverageSign?.id || '' };
}

async function insertCoverageConsent({ inventory, event, sponsor, agent, house, req }) {
  const text = sponsoredConsentText(sponsor);
  const rows = await supabaseRest('event_pass_coverage_consents', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      event_pass_inventory_id: inventory.id || null,
      open_house_event_id: event.id,
      sponsor_loan_officer_profile_id: sponsor.id || sponsor.uid || null,
      sponsor_loan_officer_uid: sponsor.uid || sponsor.id || null,
      agent_slug: agent.slug || null,
      agent_name: agent.name || null,
      agent_phone: agent.phone || null,
      agent_email: agent.email || null,
      brokerage: agent.brokerage || null,
      open_house_id: house.id || null,
      property_address: house.address || null,
      consent_text: text,
      consent_version: 'sponsored_event_pass_v1',
      ip_address: getClientIp(req),
      user_agent: userAgent(req),
      metadata: {
        source: 'sponsored_event_pass',
        sponsor_company: sponsor.company_name || '',
        buyer_financing_help_requires_request: true
      }
    })
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function updateSponsoredInventory({ inventory, sign, event, sponsor, agent, house }) {
  const now = nowIso();
  const metadata = {
    ...safeMetadata(inventory.metadata),
    current_event_id: event.id,
    current_smart_sign_id: sign.id,
    current_open_house_id: house.id || null,
    current_property_address: house.address || '',
    seed_consumed_at: now,
    seed_consumed_event_id: event.id,
    sponsor_loan_officer_profile_id: sponsor.id || sponsor.uid || null,
    sponsor_loan_officer_uid: sponsor.uid || sponsor.id || null,
    latest_activation: {
      activated_at: now,
      event_id: event.id,
      agent_slug: agent.slug || '',
      open_house_id: house.id || null
    }
  };

  const payload = {
    smart_sign_id: sign.id,
    assigned_agent_slug: agent.slug || null,
    assigned_agent_phone: agent.phone || null,
    sponsor_loan_officer_profile_id: sponsor.id || sponsor.uid || inventory.sponsor_loan_officer_profile_id || null,
    sponsor_loan_officer_uid: sponsor.uid || sponsor.id || inventory.sponsor_loan_officer_uid || null,
    last_activated_at: now,
    metadata
  };
  if (!inventory.claimed_at) payload.claimed_at = now;
  if (inventory.pass_model) payload.pass_model = inventory.pass_model;
  if (inventory.reuse_allowed !== undefined) payload.reuse_allowed = inventory.reuse_allowed === true;
  if (inventory.reuse_status) payload.reuse_status = inventory.reuse_status;
  if (inventory.sponsor_coverage_required !== undefined) payload.sponsor_coverage_required = inventory.sponsor_coverage_required === true;
  if (inventory.sponsor_coverage_consent_required !== undefined) payload.sponsor_coverage_consent_required = inventory.sponsor_coverage_consent_required !== false;

  const rows = await supabaseRest(`smart_sign_inventory?id=eq.${enc(inventory.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : { ...inventory, ...payload };
}

async function resolveSponsoredPass(publicCode) {
  const inventory = await loadInventoryByCode(publicCode);
  const sponsor = await loadVerifiedProfile({
    profileId: inventory.sponsor_loan_officer_profile_id,
    uid: inventory.sponsor_loan_officer_uid
  });
  const sign = await loadSignById(inventory.smart_sign_id);
  const event = sign?.active_event_id ? await loadEventById(sign.active_event_id) : null;
  const seed = await buildSponsoredPassSeedContext(inventory);
  return {
    inventory,
    sponsor,
    sign,
    event,
    live: isLiveEvent(event),
    consent_text: sponsor ? sponsoredConsentText(sponsor) : '',
    seeded_context: publicSeedContext(seed)
  };
}

async function activateSponsoredPass({ publicCode, body, req }) {
  const inventory = await loadInventoryByCode(publicCode);
  if (inventory.inventory_type !== 'event_pass') throw httpError(400, 'That QR code is not an Event Pass.');
  if (inventory.pass_model !== 'sponsored_agent_pass') throw httpError(400, 'That Event Pass is not a Sponsored Event Pass.');
  if (inventory.reuse_allowed !== true || inventory.reuse_status !== 'active') {
    throw httpError(409, 'This Sponsored Event Pass is not currently reusable. Contact the sponsor or Rel8tion.');
  }

  const sponsor = await loadVerifiedProfile({
    profileId: inventory.sponsor_loan_officer_profile_id,
    uid: inventory.sponsor_loan_officer_uid
  });
  if (!sponsor || sponsor.is_active === false) {
    throw httpError(409, 'This Sponsored Event Pass needs an active sponsor before it can be used.');
  }
  if (body.consent_accepted !== true && body.consent_accepted !== 'true') {
    throw httpError(400, 'Agent consent is required before activation.');
  }

  const seed = await buildSponsoredPassSeedContext(inventory);
  const requestedHouse = body.open_house || {};
  const seedHouse = seed?.open_house || {};
  const openHouseId = clean(firstPresent(body.open_house_id, requestedHouse.id, seedHouse.id));
  const loadedHouse = await loadOpenHouse(openHouseId);
  const house = normalizeOpenHouse(mergeNonEmpty(seedHouse, requestedHouse, { id: openHouseId }), loadedHouse);
  if (!house.id && !house.address) throw httpError(400, 'Choose or enter the open house address before activating.');

  const agent = await ensureAgent(mergeNonEmpty(seed?.agent || {}, body.agent || {}), house);
  const sign = await ensureSmartSignForInventory(inventory, agent, 'sponsored_event_pass');
  if (!sign?.id) throw httpError(500, 'Unable to prepare the Sponsored Event Pass sign record.');

  const existingPassEvent = await assertNoDifferentLiveEvent(sign, house, agent);
  const seededLiveEvent = seed?.event && isLiveEvent(seed.event) && eventMatchesHouseAndAgent(seed.event, house, agent)
    ? seed.event
    : null;
  let event = existingPassEvent || seededLiveEvent;
  if (event?.id) {
    event = await attachSponsoredPassContextToEvent({
      event,
      inventory,
      agent,
      house,
      sponsor,
      extraContext: {
        source: event.setup_context?.source || 'sponsored_event_pass',
        pass_model: 'sponsored_agent_pass',
        sponsor_coverage_consent_required: true,
        sponsored_pass_confirmed_at: nowIso(),
        sponsored_pass_reused_seed_event: Boolean(seededLiveEvent)
      }
    });
  } else {
    event = await createOpenHouseEvent({
      sign,
      house,
      agent,
      source: 'sponsored_event_pass',
      sponsor,
      eventPassInventoryId: inventory.id,
      extraContext: {
        pass_model: 'sponsored_agent_pass',
        sponsor_coverage_consent_required: true
      }
    });
  }
  const activeSign = await activateSmartSign(sign, event, agent, 'sponsored_event_pass');
  const consent = await insertCoverageConsent({ inventory, event, sponsor, agent, house, req });
  const loanSession = await upsertLoanOfficerSession({
    eventId: event.id,
    profile: sponsor,
    source: 'sponsored_event_pass',
    metadata: {
      event_pass_inventory_id: inventory.id,
      consent_id: consent?.id || null
    }
  });
  const updatedInventory = await updateSponsoredInventory({
    inventory,
    sign: activeSign,
    event,
    sponsor,
    agent,
    house
  });

  return {
    inventory: updatedInventory,
    sign: activeSign,
    event,
    sponsor: publicProfile(sponsor),
    agent,
    house,
    consent,
    loan_officer_session: loanSession,
    dashboard_url: `/agent-dashboard?event=${encodeURIComponent(event.id)}&agent=${encodeURIComponent(agent.slug || '')}`,
    lo_dashboard_url: `/lo-field-dashboard?uid=${encodeURIComponent(sponsor.uid || sponsor.id || '')}&event=${encodeURIComponent(event.id)}`
  };
}

async function endEventLinks({ eventId, now = nowIso() }) {
  const event = await loadEventById(eventId);
  if (!event) throw httpError(404, 'Open house event not found.');
  const eventRows = await supabaseRest(`open_house_events?id=eq.${enc(event.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      status: 'ended',
      ended_at: event.ended_at || now,
      last_activity_at: now
    })
  });
  const endedEvent = Array.isArray(eventRows) && eventRows[0] ? eventRows[0] : event;

  const loanSessions = await supabaseRest(`event_loan_officer_sessions?open_house_event_id=eq.${enc(event.id)}&status=eq.live`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      status: 'ended',
      signed_out_at: now,
      updated_at: now
    })
  }).catch((error) => ({ warning: error.message || String(error) }));

  const signRows = await supabaseRest(`smart_signs?active_event_id=eq.${enc(event.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      active_event_id: null,
      status: 'inactive',
      deactivated_at: now,
      updated_at: now
    })
  }).catch((error) => ({ warning: error.message || String(error) }));
  const activeSigns = Array.isArray(signRows) ? signRows : [];
  const sign = activeSigns.find((row) => row.id === event.smart_sign_id) || activeSigns[0] || null;

  return { event: endedEvent, sign, signs: activeSigns, loan_officer_coverage: loanSessions };
}

async function loadLoanOfficerSign({ publicCode = '', uid = '' } = {}) {
  if (publicCode) {
    const row = await maybeOne(`loan_officer_coverage_signs?public_code=eq.${enc(publicCode)}&select=*`).catch(() => null);
    if (row) return row;
  }
  if (uid) {
    const chipUid = enc(uid);
    const row = await maybeOne(`loan_officer_coverage_signs?or=(uid.eq.${chipUid},uid_primary.eq.${chipUid},uid_secondary.eq.${chipUid})&select=*`).catch(() => null);
    if (row) return row;
  }
  return null;
}

async function resolveLoanOfficerSign({ publicCode = '', uid = '' } = {}) {
  const sign = await loadLoanOfficerSign({ publicCode, uid });
  if (!sign) return { sign: null, profile: null, event: null, live: false };
  const profile = await loadVerifiedProfile({
    profileId: sign.loan_officer_profile_id,
    uid: sign.loan_officer_uid || sign.uid || uid
  });
  const event = sign.active_event_id ? await loadEventById(sign.active_event_id) : null;
  return {
    sign,
    profile,
    event,
    live: isLiveEvent(event)
  };
}

async function activateLoanOfficerCoverage({ publicCode, uid = '', body }) {
  const coverageSign = await loadLoanOfficerSign({ publicCode, uid });
  if (!coverageSign) throw httpError(404, 'Loan Officer Coverage Sign not found.');
  const profile = await loadVerifiedProfile({
    profileId: coverageSign.loan_officer_profile_id,
    uid: coverageSign.loan_officer_uid || uid
  });
  if (!profile || profile.is_active === false) {
    throw httpError(409, 'This Loan Officer Coverage Sign needs an active verified profile before it can be used.');
  }

  if (coverageSign.active_event_id) {
    const active = await loadEventById(coverageSign.active_event_id);
    if (isLiveEvent(active)) {
      return {
        coverage_sign: coverageSign,
        profile: publicProfile(profile),
        event: active,
        dashboard_url: `/lo-field-dashboard?uid=${encodeURIComponent(profile.uid || coverageSign.uid || '')}&event=${encodeURIComponent(active.id)}`
      };
    }
  }

  const loadedHouse = await loadOpenHouse(body.open_house_id || body.open_house?.id || '');
  const house = normalizeOpenHouse(body.open_house || {}, loadedHouse);
  if (!house.id && !house.address) throw httpError(400, 'Choose or enter the open house address before activating coverage.');
  const agent = await ensureAgent(body.agent || {}, house);
  const backingSign = await ensureSyntheticSmartSign(coverageSign.public_code, agent, 'loan_officer_coverage_sign');
  const event = await createOpenHouseEvent({
    sign: backingSign,
    house,
    agent,
    source: 'loan_officer_coverage_sign',
    sponsor: profile,
    loanOfficerSignId: coverageSign.id,
    extraContext: {
      lo_sign_public_code: coverageSign.public_code,
      sponsored_pass_issued: Boolean(body.event_pass_code)
    }
  });
  const activeSmartSign = await activateSmartSign(backingSign, event, agent, 'loan_officer_coverage_sign');
  const loanSession = await upsertLoanOfficerSession({
    eventId: event.id,
    profile,
    source: 'loan_officer_coverage_sign',
    metadata: {
      loan_officer_coverage_sign_id: coverageSign.id
    }
  });
  const fieldDashboardVisit = await ensureFieldDashboardVisitForCoverage({
    event,
    house,
    agent,
    profile,
    coverageSign,
    activeSmartSign
  }).catch((error) => ({ warning: error.message || String(error) }));

  let passInventory = null;
  if (body.event_pass_code) {
    passInventory = await loadInventoryByCode(body.event_pass_code);
    if (passInventory.inventory_type !== 'event_pass') throw httpError(400, 'The pass code is not an Event Pass inventory row.');
    const issuedAt = nowIso();
    const seededOpenHouse = compactOpenHouseSeed(house, event);
    const seededAgent = compactAgentSeed(agent);
    const passRows = await supabaseRest(`smart_sign_inventory?id=eq.${enc(passInventory.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        pass_model: 'sponsored_agent_pass',
        sponsor_loan_officer_profile_id: profile.id || profile.uid || null,
        sponsor_loan_officer_uid: profile.uid || profile.id || null,
        assigned_agent_slug: agent.slug || null,
        assigned_agent_phone: agent.phone || null,
        sponsor_coverage_required: true,
        sponsor_coverage_consent_required: true,
        reuse_allowed: true,
        reuse_status: 'active',
        metadata: {
          ...safeMetadata(passInventory.metadata),
          issued_by_loan_officer_coverage_sign_id: coverageSign.id,
          issued_by_loan_officer_coverage_sign_public_code: coverageSign.public_code,
          issued_for_event_id: event.id,
          issued_for_open_house_id: house.id || null,
          issued_for_property_address: house.address || '',
          issued_for_agent_slug: agent.slug || '',
          issued_at: issuedAt,
          seeded_at: issuedAt,
          seeded_open_house_event_id: event.id,
          seeded_open_house: seededOpenHouse,
          seeded_agent: seededAgent,
          seeded_context: {
            source: 'loan_officer_coverage_sign',
            seeded_at: issuedAt,
            event_id: event.id,
            loan_officer_coverage_sign_id: coverageSign.id,
            loan_officer_coverage_sign_public_code: coverageSign.public_code,
            open_house: seededOpenHouse,
            agent: seededAgent
          }
        }
      })
    });
    passInventory = Array.isArray(passRows) && passRows[0] ? passRows[0] : passInventory;
  }

  const now = nowIso();
  const signRows = await supabaseRest(`loan_officer_coverage_signs?id=eq.${enc(coverageSign.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      loan_officer_profile_id: profile.id || profile.uid || coverageSign.loan_officer_profile_id || null,
      loan_officer_uid: profile.uid || profile.id || coverageSign.loan_officer_uid || null,
      status: 'live',
      active_event_id: event.id,
      active_event_pass_inventory_id: passInventory?.id || coverageSign.active_event_pass_inventory_id || null,
      active_smart_sign_id: activeSmartSign.id || null,
      last_open_house_id: house.id || null,
      last_agent_slug: agent.slug || null,
      last_used_at: now,
      updated_at: now,
      metadata: {
        ...safeMetadata(coverageSign.metadata),
        current_event_id: event.id,
        current_property_address: house.address || '',
        current_agent_slug: agent.slug || '',
        source: 'loan_officer_coverage_sign'
      }
    })
  });
  const updatedSign = Array.isArray(signRows) && signRows[0] ? signRows[0] : coverageSign;

  const historyRows = await supabaseRest('loan_officer_sign_events', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      loan_officer_sign_id: coverageSign.id,
      loan_officer_profile_id: profile.id || profile.uid || null,
      open_house_event_id: event.id,
      event_pass_inventory_id: passInventory?.id || null,
      open_house_id: house.id || null,
      host_agent_slug: agent.slug || null,
      setup_method: 'lo_sign_activation',
      status: 'live',
      metadata: {
        source: 'loan_officer_coverage_sign',
        event_pass_code: body.event_pass_code || ''
      }
    })
  }).catch((error) => ({ warning: error.message || String(error) }));

  return {
    coverage_sign: updatedSign,
    profile: publicProfile(profile),
    event,
    agent,
    house,
    smart_sign: activeSmartSign,
    event_pass_inventory: passInventory,
    loan_officer_session: loanSession,
    field_dashboard_visit: fieldDashboardVisit,
    loan_officer_sign_event: Array.isArray(historyRows) ? historyRows[0] || null : historyRows,
    dashboard_url: `/lo-field-dashboard?uid=${encodeURIComponent(profile.uid || coverageSign.uid || '')}&event=${encodeURIComponent(event.id)}`,
    agent_dashboard_url: `/agent-dashboard?event=${encodeURIComponent(event.id)}&agent=${encodeURIComponent(agent.slug || '')}`
  };
}

module.exports = {
  activateLoanOfficerCoverage,
  activateSponsoredPass,
  clean,
  enc,
  endEventLinks,
  httpError,
  isLiveEvent,
  list,
  loadEventById,
  loadInventoryByCode,
  loadLoanOfficerSign,
  loadVerifiedProfile,
  maybeOne,
  normalizeOpenHouse,
  normalizePhone,
  publicProfile,
  resolveLoanOfficerSign,
  resolveSponsoredPass,
  safeMetadata,
  sponsoredConsentText,
  updateSponsoredInventory,
  upsertLoanOfficerSession
};
