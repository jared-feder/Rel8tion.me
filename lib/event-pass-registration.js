const nodemailer = require('nodemailer');
const bookingCalendar = require('../config/booking-calendar.json');
const { supabaseRest } = require('./admin-auth');

const DEFAULT_REUSABLE_EVENT_PASS_SPONSOR_UID = '7e05fcf5-18de-4ba1-b689-b944602ed4ca';

function clean(value, max = 1000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function enc(value) {
  return encodeURIComponent(clean(value));
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizePhone(value) {
  const digits = clean(value, 80).replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function normalizeEmail(value) {
  return clean(value, 320).toLowerCase();
}

function normalizeName(value) {
  return clean(value, 240).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeBrokerage(value) {
  return clean(value, 300)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\breal\s+estate\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((part) => part && !['llc', 'inc', 'incorporated', 'corp', 'corporation', 'company', 'co', 'brokerage', 'realty'].includes(part))
    .join(' ')
    .trim();
}

function publicAgent(agent = {}) {
  return {
    slug: clean(agent.slug || agent.agent_slug, 160),
    name: clean(agent.name || agent.agent_name || agent.full_name, 240),
    phone: clean(agent.phone || agent.agent_phone, 80),
    phone_normalized: normalizePhone(agent.phone_normalized || agent.phone || agent.agent_phone),
    email: normalizeEmail(agent.email || agent.agent_email),
    brokerage: clean(agent.brokerage || agent.company || agent.company_name, 300)
  };
}

function listingCandidates(house = {}, listingAgents = []) {
  const rows = (listingAgents || []).map((row) => ({
    id: row.id || null,
    name: clean(row.name || row.agent_name, 240),
    phone: clean(row.phone || row.agent_phone, 80),
    email: normalizeEmail(row.email || row.agent_email),
    brokerage: clean(row.brokerage || row.office_name || row.company, 300),
    is_primary: row.is_primary === true
  }));
  rows.push({
    id: null,
    name: clean(house.agent || house.agent_name || house.listing_agent_name, 240),
    phone: clean(house.agent_phone, 80),
    email: normalizeEmail(house.agent_email),
    brokerage: clean(house.brokerage || house.office_name || house.listing_office_name, 300),
    is_primary: false
  });
  return rows.filter((row) => row.name || row.phone || row.email || row.brokerage);
}

function sameContact(left = {}, right = {}) {
  const leftPhone = normalizePhone(left.phone || left.phone_normalized);
  const rightPhone = normalizePhone(right.phone || right.phone_normalized);
  const leftEmail = normalizeEmail(left.email);
  const rightEmail = normalizeEmail(right.email);
  return Boolean(
    (leftPhone.length === 10 && rightPhone.length === 10 && leftPhone === rightPhone)
    || (leftEmail && rightEmail && leftEmail === rightEmail)
  );
}

function sameBrokerage(left, right) {
  const a = normalizeBrokerage(left);
  const b = normalizeBrokerage(right);
  return Boolean(a.length >= 4 && b.length >= 4 && a === b);
}

function authorizationError(message, code = null) {
  const error = new Error(message);
  error.status = 403;
  error.code = code;
  return error;
}

function listingAuthorizationError(message) {
  return authorizationError(message, 'event_pass_listing_authorization_failed');
}

function isActiveAgentMembership(row = {}) {
  const codes = Array.isArray(row.entitlement_codes) ? row.entitlement_codes : [];
  return row.status === 'active'
    && row.role === 'real_estate_agent'
    && codes.includes('agent_dashboard')
    && codes.includes('digital_card');
}

async function requireReusableEventPassMembership(agentSlug, signId) {
  if (!agentSlug || !signId) return;
  const priorEvent = await one(
    `open_house_events?smart_sign_id=eq.${enc(signId)}&ended_at=not.is.null&select=id&order=ended_at.desc&limit=1`
  ).catch(() => null);
  if (!priorEvent?.id) return;
  const entitlements = await list(
    `pricing_entitlements?subject_slug=eq.${enc(agentSlug)}&role=eq.real_estate_agent&status=eq.active&select=role,status,entitlement_codes&order=updated_at.desc&limit=10`
  );
  if (entitlements.some(isActiveAgentMembership)) return;
  const error = new Error('Choose loan-officer sponsorship or REL8TION Agent membership to reuse this Event Pass.');
  error.status = 402;
  error.code = 'event_pass_membership_required';
  throw error;
}

function canRebindFreshenedEventPass(inventory = {}, byUid = null, byCode = null) {
  const metadata = safeObject(inventory.metadata);
  return Boolean(
    byCode?.id
    && !byUid?.id
    && !inventory.smart_sign_id
    && !inventory.claimed_at
    && metadata.freshened_at
    && metadata.freshened_source === 'admin_event_pass_scanner'
    && byCode.status === 'inactive'
    && !byCode.owner_agent_slug
    && !byCode.active_event_id
    && (!byCode.activation_method || byCode.activation_method === 'event_pass_keychain')
  );
}

function matchingEventPassBackingSign(inventory = {}, uid = '', byUid = null, byCode = null) {
  const code = clean(inventory.public_code, 300);
  const chipUid = clean(uid, 300);
  const mismatch = () => authorizationError('This Event Pass QR and NFC do not match. Use the QR and NFC on the same physical Event Pass, or contact support.');
  if (byUid?.id && clean(byUid.public_code, 300) !== code) throw mismatch();
  if (byCode?.id) {
    const codeUids = [byCode.uid_primary, byCode.activation_uid_primary].filter(Boolean).map(String);
    if ((byCode.activation_method && byCode.activation_method !== 'event_pass_keychain') || !chipUid || !codeUids.includes(chipUid)) {
      throw mismatch();
    }
  }
  if (byUid?.id && byCode?.id && byUid.id !== byCode.id) throw mismatch();
  return byCode || byUid || null;
}

async function ensureEventPassBackingSign({ inventory = {}, uid = '', agentSlug = '', requestedSignId = '' } = {}) {
  const publicCode = clean(inventory.public_code, 300);
  const chipUid = clean(uid, 300);
  const ownerSlug = clean(agentSlug, 160);
  if (!inventory.id || !publicCode || !chipUid || !ownerSlug) {
    const error = new Error('Missing Event Pass inventory, NFC, or agent identity.');
    error.status = 400;
    throw error;
  }

  const [linked, requested, byUid, byCode] = await Promise.all([
    inventory.smart_sign_id ? one(`smart_signs?id=eq.${enc(inventory.smart_sign_id)}&select=*`) : null,
    requestedSignId ? one(`smart_signs?id=eq.${enc(requestedSignId)}&select=*`) : null,
    one(`smart_signs?or=(uid_primary.eq.${enc(chipUid)},uid_secondary.eq.${enc(chipUid)},activation_uid_primary.eq.${enc(chipUid)},activation_uid_secondary.eq.${enc(chipUid)})&select=*&order=created_at.desc`).catch(() => null),
    one(`smart_signs?public_code=eq.${enc(publicCode)}&select=*&order=created_at.desc`).catch(() => null)
  ]);

  const candidateIds = new Set([linked?.id, requested?.id, byUid?.id, byCode?.id].filter(Boolean));
  if (candidateIds.size > 1) {
    throw authorizationError('This Event Pass QR and NFC resolve to different inventory records. Contact support before retrying.');
  }

  let sign = linked || requested || byCode || byUid || null;
  if (sign?.id) {
    if (clean(sign.public_code, 300) !== publicCode) {
      throw authorizationError('The Event Pass QR is linked to a different NFC record.');
    }
    if (sign.owner_agent_slug && sign.owner_agent_slug !== ownerSlug) {
      throw authorizationError('This Event Pass is locked to another agent. End and reset its assignment before transferring it.');
    }

    const signUids = [sign.uid_primary, sign.activation_uid_primary].filter(Boolean).map(String);
    if (!signUids.includes(chipUid)) {
      if (!canRebindFreshenedEventPass(inventory, byUid, byCode) || sign.id !== byCode?.id) {
        throw authorizationError('The Event Pass QR and NFC do not match.');
      }
      try {
        const reboundRows = await supabaseRest(`smart_signs?id=eq.${enc(sign.id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            uid_primary: chipUid,
            activation_uid_primary: chipUid,
            owner_agent_slug: ownerSlug,
            status: 'inactive',
            activation_method: 'event_pass_keychain',
            primary_device_type: 'event_pass_keychain',
            setup_confirmed_at: new Date().toISOString(),
            deactivated_at: null
          })
        });
        sign = Array.isArray(reboundRows) && reboundRows[0] ? reboundRows[0] : null;
      } catch (error) {
        if (error.status === 409 || /23505/.test(String(error.message || error))) {
          throw authorizationError('This Event Pass NFC is already connected to another pass. Use that matching pass or contact support.');
        }
        throw error;
      }
      if (!sign?.id) throw Object.assign(new Error('Could not restore this Freshened Event Pass.'), { status: 500 });
    }
    return sign;
  }

  const now = new Date().toISOString();
  try {
    const rows = await supabaseRest('smart_signs', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        public_code: publicCode,
        uid_primary: chipUid,
        owner_agent_slug: ownerSlug,
        status: 'inactive',
        activation_uid_primary: chipUid,
        primary_device_type: 'event_pass_keychain',
        activation_method: 'event_pass_keychain',
        setup_confirmed_at: now
      })
    });
    sign = Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (error) {
    if (error.status !== 409 && !/23505/.test(String(error.message || error))) throw error;
    const [racedByUid, racedByCode] = await Promise.all([
      one(`smart_signs?or=(uid_primary.eq.${enc(chipUid)},activation_uid_primary.eq.${enc(chipUid)})&select=*&order=created_at.desc`).catch(() => null),
      one(`smart_signs?public_code=eq.${enc(publicCode)}&select=*&order=created_at.desc`).catch(() => null)
    ]);
    sign = matchingEventPassBackingSign(inventory, chipUid, racedByUid, racedByCode);
  }
  if (!sign?.id) throw Object.assign(new Error('Could not create the Event Pass activation row.'), { status: 500 });
  return sign;
}

function authorizeListingHost({ house = {}, listingAgents = [], agent = {}, supportingListingAgent = false, identityVerified = false } = {}) {
  if (!clean(house.id)) {
    throw listingAuthorizationError('Choose a verified listing from the open-house feed. Manual listings cannot activate a locked Event Pass.');
  }

  const host = publicAgent(agent);
  const candidates = listingCandidates(house, listingAgents);
  const primary = candidates.find((row) => row.is_primary) || candidates.find((row) => row.name || row.phone || row.email) || candidates[0] || {};
  const exactContact = candidates.find((row) => sameContact(host, row));
  const exactNameAndCompany = candidates.find((row) => (
    normalizeName(host.name).length >= 5
    && normalizeName(host.name) === normalizeName(row.name)
    && sameBrokerage(host.brokerage, row.brokerage)
  ));

  if (exactContact || exactNameAndCompany) {
    const matched = exactContact || exactNameAndCompany;
    return {
      basis: 'listing_agent',
      host_agent_slug: host.slug,
      listing_agent_id: matched.id || primary.id || null,
      listing_agent_name: matched.name || primary.name || '',
      listing_agent_brokerage: matched.brokerage || primary.brokerage || house.brokerage || '',
      brokerage_match: sameBrokerage(host.brokerage, matched.brokerage || house.brokerage),
      supporting_listing_agent: false
    };
  }

  const brokerageMatch = candidates.find((row) => sameBrokerage(host.brokerage, row.brokerage || house.brokerage));
  if (supportingListingAgent && identityVerified && brokerageMatch) {
    return {
      basis: 'same_brokerage_substitute',
      host_agent_slug: host.slug,
      listing_agent_id: primary.id || null,
      listing_agent_name: primary.name || '',
      listing_agent_brokerage: brokerageMatch.brokerage || house.brokerage || '',
      brokerage_match: true,
      supporting_listing_agent: true
    };
  }

  if (brokerageMatch && !supportingListingAgent) {
    throw listingAuthorizationError('This listing belongs to an agent at your brokerage. Confirm that you are hosting for the listing agent who is not present.');
  }
  if (supportingListingAgent && !identityVerified) {
    throw listingAuthorizationError('REL8TION could not verify the supporting agent from an existing agent profile. Use the claimed agent keychain or contact support.');
  }
  throw listingAuthorizationError('This Event Pass can only be activated by the listing agent or a verified agent from the same brokerage who is hosting for them.');
}

async function list(path) {
  const rows = await supabaseRest(path);
  return Array.isArray(rows) ? rows : [];
}

async function one(path) {
  return (await list(`${path}${path.includes('?') ? '&' : '?'}limit=1`))[0] || null;
}

function publicLoanOfficer(profile = {}) {
  return {
    id: clean(profile.id || profile.uid, 160),
    uid: clean(profile.uid || profile.id, 160),
    slug: clean(profile.slug, 160),
    name: clean(profile.full_name || profile.name, 240),
    title: clean(profile.title || 'Loan Officer', 160),
    company: clean(profile.company_name || profile.company, 240),
    photo_url: clean(profile.photo_url || profile.image_url || profile.avatar_url, 1000)
  };
}

async function loadVerifiedLoanOfficer(profileId) {
  const id = clean(profileId, 160);
  if (!id) return null;
  const byUid = await one(`verified_profiles?uid=eq.${enc(id)}&is_active=eq.true&select=*`).catch(() => null);
  if (byUid) return byUid;
  return one(`verified_profiles?id=eq.${enc(id)}&is_active=eq.true&select=*`).catch(() => null);
}

async function loadFirstVerifiedLoanOfficer(profileIds = []) {
  const candidates = [...new Set(profileIds.map((value) => clean(value, 160)).filter(Boolean))];
  for (const candidate of candidates) {
    const profile = await loadVerifiedLoanOfficer(candidate);
    if (profile) return profile;
  }
  return null;
}

async function resolveReusableEventPassSponsor({ signId } = {}) {
  const resolvedSignId = clean(signId, 160);
  let initialEvent = null;
  let initialSession = null;
  if (resolvedSignId) {
    initialEvent = await one(
      `open_house_events?smart_sign_id=eq.${enc(resolvedSignId)}&select=id,setup_context,created_at&order=created_at.asc`
    ).catch(() => null);
    if (initialEvent?.id) {
      initialSession = await one(
        `event_loan_officer_sessions?open_house_event_id=eq.${enc(initialEvent.id)}&select=*&order=signed_in_at.asc.nullslast,created_at.asc`
      ).catch(() => null);
      const setupContext = safeObject(initialEvent.setup_context);
      const originalProfile = await loadFirstVerifiedLoanOfficer([
        initialSession?.verified_profile_uid,
        initialSession?.loan_officer_uid,
        setupContext.sponsor_loan_officer_profile_id,
        setupContext.sponsor_loan_officer_uid
      ]);
      if (originalProfile) {
        return {
          profile: originalProfile,
          source: 'initial_event_loan_officer',
          initial_event: initialEvent,
          initial_session: initialSession
        };
      }
    }
  }

  const fallbackProfile = await loadVerifiedLoanOfficer(DEFAULT_REUSABLE_EVENT_PASS_SPONSOR_UID);
  return fallbackProfile ? {
    profile: fallbackProfile,
    source: 'default_brian_puls',
    initial_event: initialEvent,
    initial_session: initialSession
  } : null;
}

async function loadEventPassReuseOptions({ uid, agentSlug, publicCode, openHouseId, supportingListingAgent = false } = {}) {
  const chipUid = clean(uid, 300);
  const requestedAgentSlug = clean(agentSlug, 160);
  const code = clean(publicCode, 300);
  const houseId = clean(openHouseId, 300);
  if (!chipUid || !requestedAgentSlug || !code || !houseId) {
    const error = new Error('Missing Event Pass, claimed agent, or selected open house.');
    error.status = 400;
    throw error;
  }

  const [key, inventory, house] = await Promise.all([
    one(`keys?uid=eq.${enc(chipUid)}&claimed=eq.true&select=*`),
    one(`smart_sign_inventory?public_code=eq.${enc(code)}&inventory_type=eq.event_pass&select=*`),
    one(`open_houses?id=eq.${enc(houseId)}&select=*`)
  ]);
  if (!key?.agent_slug || key.agent_slug !== requestedAgentSlug) {
    throw authorizationError('This Event Pass NFC is not claimed by the requested agent.');
  }
  if (!inventory?.id || inventory.pass_model === 'sponsored_agent_pass') {
    throw authorizationError('This reuse page only supports a normal Event Pass.');
  }
  if (!house?.id) {
    const error = new Error('The selected open house is no longer available.');
    error.status = 404;
    throw error;
  }

  const agent = await one(`agents?slug=eq.${enc(key.agent_slug)}&select=*`);
  if (!agent) throw authorizationError('The claimed Event Pass is not connected to an agent profile.');
  const authorization = await loadListingAuthorization({
    house,
    agent,
    supportingListingAgent: supportingListingAgent === true || supportingListingAgent === 'true',
    identityVerified: true
  });

  const [linkedSign, byCode, byUid] = await Promise.all([
    inventory.smart_sign_id ? one(`smart_signs?id=eq.${enc(inventory.smart_sign_id)}&select=*`).catch(() => null) : null,
    one(`smart_signs?public_code=eq.${enc(code)}&select=*&order=created_at.desc`).catch(() => null),
    one(`smart_signs?or=(uid_primary.eq.${enc(chipUid)},activation_uid_primary.eq.${enc(chipUid)})&select=*&order=created_at.desc`).catch(() => null)
  ]);
  const signIds = new Set([linkedSign?.id, byCode?.id, byUid?.id].filter(Boolean));
  if (signIds.size > 1) throw authorizationError('This Event Pass QR and NFC resolve to different records. Contact support.');
  const sign = linkedSign || byCode || byUid || null;
  if (!sign?.id || clean(sign.public_code, 300) !== code) {
    throw authorizationError('This Event Pass QR and NFC are not connected to the same pass.');
  }
  const signUids = [sign.uid_primary, sign.activation_uid_primary].filter(Boolean).map(String);
  if (!signUids.includes(chipUid)) throw authorizationError('This Event Pass NFC does not match the printed pass.');
  if (sign.owner_agent_slug && sign.owner_agent_slug !== key.agent_slug) {
    throw authorizationError('This Event Pass is assigned to another agent.');
  }

  const [priorEvent, entitlements, sponsorContext] = await Promise.all([
    one(`open_house_events?smart_sign_id=eq.${enc(sign.id)}&ended_at=not.is.null&select=id,ended_at&order=ended_at.desc`).catch(() => null),
    list(`pricing_entitlements?subject_slug=eq.${enc(key.agent_slug)}&role=eq.real_estate_agent&status=eq.active&select=role,status,entitlement_codes&order=updated_at.desc&limit=10`),
    resolveReusableEventPassSponsor({ signId: sign.id })
  ]);

  return {
    agent: { ...publicAgent(agent), image_url: clean(agent.image_url, 1000) },
    inventory: { id: inventory.id, public_code: inventory.public_code },
    sign: { id: sign.id },
    house: {
      id: house.id,
      address: clean(house.address, 500),
      open_start: house.open_start || null,
      open_end: house.open_end || null,
      image: clean(house.image || house.image_url || house.photo_url, 1000)
    },
    authorization,
    membership_active: entitlements.some(isActiveAgentMembership),
    reuse_required: Boolean(priorEvent?.id),
    sponsor: sponsorContext ? publicLoanOfficer(sponsorContext.profile) : null,
    sponsor_source: sponsorContext?.source || null
  };
}

function clientIp(req = {}) {
  return clean(req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'], 200).split(',')[0].trim();
}

async function recordSponsoredReuseConsent({ inventory, event, sponsor, agent, house, req, source }) {
  const sponsorId = clean(sponsor.uid || sponsor.id, 160);
  const existing = await one(
    `event_pass_coverage_consents?event_pass_inventory_id=eq.${enc(inventory.id)}&open_house_event_id=eq.${enc(event.id)}&agent_slug=eq.${enc(agent.slug)}&sponsor_loan_officer_uid=eq.${enc(sponsorId)}&select=*`
  ).catch(() => null);
  if (existing?.id) return existing;
  const sponsorName = clean(sponsor.full_name || sponsor.name, 240) || 'your loan officer';
  const sponsorCompany = clean(sponsor.company_name || sponsor.company, 240);
  const consentText = `By continuing, you authorize ${sponsorName}${sponsorCompany ? ` of ${sponsorCompany}` : ''} to sponsor this open house, appear as the live loan officer supporting the event, and receive event check-in visibility. Buyer financing help is shared only when a buyer explicitly requests it.`;
  const rows = await supabaseRest('event_pass_coverage_consents', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      event_pass_inventory_id: inventory.id,
      open_house_event_id: event.id,
      sponsor_loan_officer_profile_id: sponsor.id || sponsor.uid || null,
      sponsor_loan_officer_uid: sponsor.uid || sponsor.id || null,
      agent_slug: agent.slug,
      agent_name: agent.name || null,
      agent_phone: agent.phone || null,
      agent_email: agent.email || null,
      brokerage: agent.brokerage || null,
      open_house_id: house.id,
      property_address: house.address || null,
      consent_text: consentText,
      consent_version: 'event_pass_sponsored_reuse_v1',
      ip_address: clientIp(req),
      user_agent: clean(req.headers?.['user-agent'], 1000),
      metadata: {
        source,
        sponsor_company: sponsorCompany,
        limited_rel8tion_version: true,
        buyer_financing_help_requires_request: true
      }
    })
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function upsertSponsoredReuseSession({ event, sponsor, source }) {
  const existing = await one(`event_loan_officer_sessions?open_house_event_id=eq.${enc(event.id)}&status=eq.live&select=*`).catch(() => null);
  const now = new Date().toISOString();
  const payload = {
    verified_profile_uid: sponsor.uid || sponsor.id || null,
    loan_officer_uid: sponsor.uid || sponsor.id || null,
    loan_officer_slug: sponsor.slug || '',
    loan_officer_name: sponsor.full_name || '',
    loan_officer_title: sponsor.title || '',
    loan_officer_company: sponsor.company_name || '',
    loan_officer_phone: sponsor.phone || '',
    loan_officer_email: sponsor.email || '',
    loan_officer_photo_url: sponsor.photo_url || '',
    loan_officer_cta_url: sponsor.cta_url || '',
    loan_officer_calendar_url: sponsor.calendar_url || '',
    status: 'live',
    signed_out_at: null,
    last_seen_at: now,
    updated_at: now,
    source,
    metadata: { limited_rel8tion_version: true, source }
  };
  if (!existing?.id) payload.open_house_event_id = event.id;
  const path = existing?.id ? `event_loan_officer_sessions?id=eq.${enc(existing.id)}` : 'event_loan_officer_sessions';
  const method = existing?.id ? 'PATCH' : 'POST';
  try {
    const rows = await supabaseRest(path, {
      method,
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    });
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch (error) {
    if (!/source|metadata|schema cache|PGRST204/i.test(error.message || '')) throw error;
    delete payload.source;
    delete payload.metadata;
    const rows = await supabaseRest(path, {
      method,
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    });
    return Array.isArray(rows) ? rows[0] || null : null;
  }
}

async function loadListingAuthorization({ house, agent, supportingListingAgent, identityVerified }) {
  const listingAgents = await list(`listing_agents?open_house_id=eq.${enc(house.id)}&select=*&order=is_primary.desc.nullslast,created_at.asc&limit=12`).catch(() => []);
  return authorizeListingHost({ house, listingAgents, agent, supportingListingAgent, identityVerified });
}

async function resolveExistingAgent(input = {}) {
  const candidate = publicAgent(input);
  const paths = [];
  if (candidate.slug) paths.push(`agents?slug=eq.${enc(candidate.slug)}&select=*`);
  if (candidate.phone_normalized) paths.push(`agents?phone_normalized=eq.${enc(candidate.phone_normalized)}&select=*`);
  if (candidate.email) paths.push(`agents?email=eq.${enc(candidate.email)}&select=*`);
  for (const path of paths) {
    const row = await one(path).catch(() => null);
    if (row) return row;
  }
  return null;
}

function escapeHtml(value) {
  return clean(value, 4000).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function ownerNotificationEmail() {
  return clean(process.env.OPEN_HOUSE_REGISTRATION_NOTIFICATION_EMAIL || bookingCalendar.notification_email, 320);
}

async function deliverOwnerEmail({ to, subject, html, eventId }) {
  const smtpHost = clean(process.env.SMTP_HOST, 500);
  const smtpPort = Number(process.env.SMTP_PORT || 465);
  const smtpUser = clean(process.env.SMTP_USER, 500);
  const smtpPassword = clean(process.env.SMTP_PASSWORD, 1000);
  const fromEmail = clean(process.env.REL8TION_FROM_EMAIL || process.env.LEAD_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || smtpUser, 320);
  if (smtpHost && smtpUser && smtpPassword && fromEmail) {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPassword }
    });
    return transporter.sendMail({
      from: `REL8TION <${fromEmail}>`,
      to,
      replyTo: 'jared@rel8tion.me',
      messageId: `<open-house-registration-${eventId}@rel8tion.me>`,
      subject,
      html
    });
  }

  const apiKey = clean(process.env.RESEND_API_KEY, 1000);
  if (!apiKey) throw new Error('No open-house registration email provider is configured.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `open-house-registration-${eventId}`
    },
    body: JSON.stringify({
      from: clean(process.env.REL8TION_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'REL8TION <onboarding@resend.dev>', 320),
      to: [to],
      subject,
      html,
      tags: [{ name: 'category', value: 'open_house_registration' }]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `Registration email failed: ${response.status}`);
  return payload;
}

async function patchNotificationStatus(event, status) {
  const context = {
    ...safeObject(event.setup_context),
    owner_registration_notification: status
  };
  const rows = await supabaseRest(`open_house_events?id=eq.${enc(event.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ setup_context: context })
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : { ...event, setup_context: context };
}

async function notifyOpenHouseRegistration({ event, house, agent, authorization, inventory, source }) {
  const existing = safeObject(event?.setup_context).owner_registration_notification;
  if (existing?.status === 'sent') return { status: 'already_sent', id: existing.id || null, event };
  const to = ownerNotificationEmail();
  if (!to) return { status: 'warning', warning: 'Owner notification email is not configured.', event };

  const attemptedAt = new Date().toISOString();
  let trackedEvent = await patchNotificationStatus(event, {
    status: 'pending',
    attempted_at: attemptedAt,
    recipient: to
  }).catch(() => event);

  const address = clean(house.address || safeObject(event.setup_context).address || 'Open house', 400);
  const host = publicAgent(agent);
  const basis = authorization?.basis === 'same_brokerage_substitute'
    ? 'Same-brokerage substitute for an absent listing agent'
    : 'Listing agent';
  const whenValue = house.open_start || event.start_time;
  const when = whenValue
    ? new Date(whenValue).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
    : 'Time not provided';
  const dashboardUrl = `https://app.rel8tion.me/agent-dashboard?event=${encodeURIComponent(event.id)}&agent=${encodeURIComponent(host.slug)}`;
  const subject = `Open house registered: ${address} - ${host.name || host.slug}`;
  const html = [
    '<h1>New REL8TION open house registration</h1>',
    `<p><strong>${escapeHtml(address)}</strong><br>${escapeHtml(when)}</p>`,
    `<p>Host agent: <strong>${escapeHtml(host.name || host.slug)}</strong><br>Brokerage: ${escapeHtml(host.brokerage || 'Not available')}</p>`,
    `<p>Authorization: <strong>${escapeHtml(basis)}</strong>${authorization?.listing_agent_name ? `<br>Listing agent: ${escapeHtml(authorization.listing_agent_name)}` : ''}</p>`,
    `<p>Event Pass: ${escapeHtml(inventory?.public_code || 'Not available')}<br>Activation source: ${escapeHtml(source || 'event_pass')}</p>`,
    `<p><a href="${escapeHtml(dashboardUrl)}">Open the agent event dashboard</a></p>`,
    `<p>Event ID: ${escapeHtml(event.id)}</p>`
  ].join('');

  try {
    const delivery = await deliverOwnerEmail({ to, subject, html, eventId: event.id });
    const sent = {
      status: 'sent',
      attempted_at: attemptedAt,
      sent_at: new Date().toISOString(),
      recipient: to,
      id: clean(delivery?.messageId || delivery?.id, 500) || null
    };
    trackedEvent = await patchNotificationStatus(trackedEvent, sent).catch(() => trackedEvent);
    return { ...sent, event: trackedEvent };
  } catch (error) {
    const failed = {
      status: 'failed',
      attempted_at: attemptedAt,
      failed_at: new Date().toISOString(),
      recipient: to,
      error: clean(error.message || error, 1000)
    };
    trackedEvent = await patchNotificationStatus(trackedEvent, failed).catch(() => trackedEvent);
    console.error('[event-pass-registration] owner email failed', failed.error);
    return { status: 'warning', warning: failed.error, event: trackedEvent };
  }
}

async function activateNormalEventPass(body = {}, req = {}) {
  const uid = clean(body.uid, 300);
  const publicCode = clean(body.public_code || body.code, 300);
  const openHouseId = clean(body.open_house_id || body.open_house?.id, 300);
  if (!uid || !publicCode || !openHouseId) {
    const error = new Error('Missing Event Pass, claimed keychain, or verified listing.');
    error.status = 400;
    throw error;
  }

  const [key, inventory, house] = await Promise.all([
    one(`keys?uid=eq.${enc(uid)}&select=*`),
    one(`smart_sign_inventory?public_code=eq.${enc(publicCode)}&select=*`),
    one(`open_houses?id=eq.${enc(openHouseId)}&select=*`)
  ]);
  if (!key?.claimed || !key.agent_slug) throw authorizationError('Tap a claimed agent keychain before activating this Event Pass.');
  if (!inventory || inventory.inventory_type !== 'event_pass') {
    const error = new Error('Event Pass inventory was not found.');
    error.status = 404;
    throw error;
  }
  if (inventory.pass_model === 'sponsored_agent_pass') {
    const error = new Error('Use the Sponsored Event Pass activation page for this pass.');
    error.status = 400;
    throw error;
  }
  if (!house) {
    const error = new Error('Choose a verified listing from the open-house feed.');
    error.status = 404;
    throw error;
  }

  const agent = await one(`agents?slug=eq.${enc(key.agent_slug)}&select=*`);
  if (!agent) throw authorizationError('The claimed keychain is not connected to an agent profile.');
  if (body.agent_slug && clean(body.agent_slug) !== key.agent_slug) throw authorizationError('The claimed keychain does not match the requested agent.');
  if (inventory.assigned_agent_slug && inventory.assigned_agent_slug !== key.agent_slug) {
    throw authorizationError('This Event Pass is locked to another agent. End and reset its assignment before transferring it.');
  }
  const supportingListingAgent = body.supporting_listing_agent === true || body.supporting_listing_agent === 'true';
  const authorization = await loadListingAuthorization({
    house,
    agent,
    supportingListingAgent,
    identityVerified: true
  });
  const sponsoredReuseRequested = clean(body.reuse_mode, 80) === 'loan_officer_sponsored';
  let sponsorContext = null;

  let sign = await ensureEventPassBackingSign({
    inventory,
    uid,
    agentSlug: key.agent_slug,
    requestedSignId: clean(body.sign_id, 100)
  });
  if (inventory.smart_sign_id && inventory.smart_sign_id !== sign.id) throw authorizationError('The Event Pass QR is linked to a different NFC record.');
  if (clean(sign.public_code) !== publicCode) throw authorizationError('The Event Pass QR and NFC do not match.');
  const signUids = [sign.uid_primary, sign.activation_uid_primary].filter(Boolean).map(String);
  if (!signUids.includes(uid)) throw authorizationError('The claimed keychain does not match this Event Pass activation.');
  if (sign.owner_agent_slug && sign.owner_agent_slug !== key.agent_slug) {
    throw authorizationError('This Event Pass is locked to another agent. End and reset its assignment before transferring it.');
  }

  const now = new Date().toISOString();
  let event = sign.active_event_id ? await one(`open_house_events?id=eq.${enc(sign.active_event_id)}&select=*`).catch(() => null) : null;
  if (event?.id && event.status === 'active' && !event.ended_at) {
    if (event.host_agent_slug !== key.agent_slug || String(event.open_house_source_id || '') !== openHouseId) {
      const error = new Error('This Event Pass is already live for another agent or open house. End its current event before activating it again.');
      error.status = 409;
      error.event_id = event.id;
      throw error;
    }
  } else {
    if (sponsoredReuseRequested) {
      if (body.consent_accepted !== true && body.consent_accepted !== 'true') {
        const error = new Error('Agent consent is required before loan-officer-sponsored activation.');
        error.status = 400;
        error.code = 'event_pass_sponsor_consent_required';
        throw error;
      }
      sponsorContext = await resolveReusableEventPassSponsor({
        signId: sign.id
      });
      if (!sponsorContext?.profile) {
        const error = new Error('No active loan officer is assigned to sponsor this open house. Choose REL8TION Agent membership or contact support.');
        error.status = 409;
        error.code = 'event_pass_sponsor_unavailable';
        throw error;
      }
      const requestedSponsor = clean(body.sponsor_profile_id, 160);
      const resolvedSponsorIds = [sponsorContext.profile.id, sponsorContext.profile.uid].filter(Boolean).map(String);
      if (requestedSponsor && !resolvedSponsorIds.includes(requestedSponsor)) {
        throw authorizationError('The selected loan officer is not the server-assigned sponsor for this open house.');
      }
    } else {
      await requireReusableEventPassMembership(key.agent_slug, sign.id);
    }
    event = await one(`open_house_events?host_agent_slug=eq.${enc(key.agent_slug)}&open_house_source_id=eq.${enc(openHouseId)}&status=eq.active&ended_at=is.null&select=*&order=created_at.desc`).catch(() => null);
  }

  const sponsor = sponsorContext?.profile || null;
  const activationSource = sponsor ? 'event_pass_loan_officer_sponsored_reuse' : 'event-pass-keychain';
  const eventAccessMode = sponsor ? 'sponsored_event_only' : 'member_permanent';
  const setupContext = {
    ...safeObject(event?.setup_context),
    flow: sponsor ? 'event-pass-sponsored-reuse' : 'event-pass',
    source: activationSource,
    qr_source: 'event_pass',
    event_pass_inventory_id: inventory.id,
    agent_slug: key.agent_slug,
    agent_name: agent.name || '',
    agent_phone: agent.phone || '',
    agent_email: agent.email || '',
    brokerage: agent.brokerage || '',
    address: house.address || '',
    detected_brokerage: house.brokerage || '',
    price: house.price || null,
    beds: house.beds || null,
    baths: house.baths || null,
    sqft: house.sqft || null,
    listing_url: house.link || '',
    listing_link: house.link || '',
    manual_listing: false,
    supporting_listing_agent: authorization.supporting_listing_agent,
    host_authorization_basis: authorization.basis,
    host_authorization_verified_at: now,
    listing_agent_id: authorization.listing_agent_id,
    listing_agent_name: authorization.listing_agent_name,
    listing_agent_brokerage: authorization.listing_agent_brokerage,
    coverage_model: 'two_carried_passes_plus_sign',
    event_access_mode: eventAccessMode,
    agent_dashboard_retention: sponsor ? 'event_only' : 'permanent',
    event_recap_delivery: sponsor ? 'email' : 'dashboard',
    limited_rel8tion_version: Boolean(sponsor),
    sponsorship_message_required: Boolean(sponsor),
    sponsor_loan_officer_profile_id: sponsor?.id || sponsor?.uid || null,
    sponsor_loan_officer_uid: sponsor?.uid || sponsor?.id || null,
    sponsor_loan_officer_name: sponsor?.full_name || null,
    sponsor_loan_officer_company: sponsor?.company_name || null
  };

  let created = false;
  if (!event?.id) {
    try {
      const rows = await supabaseRest('open_house_events', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          open_house_source_id: openHouseId,
          host_agent_slug: key.agent_slug,
          smart_sign_id: sign.id,
          status: 'active',
          start_time: house.open_start || null,
          end_time: house.open_end || null,
          last_activity_at: now,
          activation_uid_primary: uid,
          activation_uid_secondary: null,
          activation_method: 'event_pass_keychain',
          setup_confirmed_at: now,
          setup_context: setupContext
        })
      });
      event = Array.isArray(rows) ? rows[0] : null;
      created = Boolean(event?.id);
    } catch (error) {
      if (error.status !== 409) throw error;
      event = await one(`open_house_events?host_agent_slug=eq.${enc(key.agent_slug)}&open_house_source_id=eq.${enc(openHouseId)}&status=eq.active&ended_at=is.null&select=*&order=created_at.desc`).catch(() => null);
    }
  } else {
    const rows = await supabaseRest(`open_house_events?id=eq.${enc(event.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ last_activity_at: now, setup_context: setupContext })
    });
    event = Array.isArray(rows) && rows[0] ? rows[0] : event;
  }
  if (!event?.id) throw Object.assign(new Error('Unable to create or join the open house event.'), { status: 500 });

  let sponsorship = null;
  if (sponsor) {
    try {
      const consent = await recordSponsoredReuseConsent({
        inventory,
        event,
        sponsor,
        agent,
        house,
        req,
        source: activationSource
      });
      if (!consent?.id) throw new Error('The required sponsorship consent could not be recorded.');
      const session = await upsertSponsoredReuseSession({ event, sponsor, source: activationSource });
      if (!session?.id) throw new Error('The sponsoring loan officer could not be attached to this open house.');
      sponsorship = { consent, session, sponsor: publicLoanOfficer(sponsor) };
    } catch (error) {
      if (created) {
        await supabaseRest(`open_house_events?id=eq.${enc(event.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'ended',
            ended_at: new Date().toISOString(),
            last_activity_at: new Date().toISOString()
          })
        }).catch(() => null);
      }
      throw error;
    }
  }

  const signRows = await supabaseRest(`smart_signs?id=eq.${enc(sign.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      owner_agent_slug: key.agent_slug,
      assigned_agent_slug: key.agent_slug,
      status: 'active',
      active_event_id: event.id,
      activation_uid_primary: uid,
      activation_method: 'event_pass_keychain',
      primary_device_type: 'event_pass_keychain',
      setup_confirmed_at: now,
      deactivated_at: null
    })
  });
  sign = Array.isArray(signRows) && signRows[0] ? signRows[0] : sign;

  const metadata = {
    ...safeObject(inventory.metadata),
    current_event_id: event.id,
    coverage_device_role: created ? 'host_event_pass' : 'carried_coverage_event_pass',
    coverage_model: 'two_carried_passes_plus_sign',
    host_authorization_basis: authorization.basis,
    host_agent_slug: key.agent_slug
  };
  await Promise.all([
    supabaseRest(`smart_sign_inventory?id=eq.${enc(inventory.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        smart_sign_id: sign.id,
        assigned_agent_slug: key.agent_slug,
        assigned_agent_phone: agent.phone || null,
        claimed_at: inventory.claimed_at || now,
        last_activated_at: now,
        metadata
      })
    }),
    supabaseRest(`keys?uid=eq.${enc(uid)}`, {
      method: 'PATCH',
      body: JSON.stringify({ device_role: 'event_pass_keychain', assigned_slot: null })
    })
  ]);

  const notification = await notifyOpenHouseRegistration({
    event,
    house,
    agent,
    authorization,
    inventory,
    source: activationSource
  });
  event = notification.event || event;
  return {
    event,
    sign,
    agent: publicAgent(agent),
    house,
    authorization,
    sponsorship,
    limited_sponsored: Boolean(sponsor),
    notification: { status: notification.status, warning: notification.warning || null },
    dashboard_url: `/agent-dashboard?event=${encodeURIComponent(event.id)}&agent=${encodeURIComponent(key.agent_slug)}`
  };
}

module.exports = {
  DEFAULT_REUSABLE_EVENT_PASS_SPONSOR_UID,
  activateNormalEventPass,
  authorizeListingHost,
  canRebindFreshenedEventPass,
  ensureEventPassBackingSign,
  isActiveAgentMembership,
  matchingEventPassBackingSign,
  requireReusableEventPassMembership,
  loadListingAuthorization,
  loadEventPassReuseOptions,
  normalizeBrokerage,
  notifyOpenHouseRegistration,
  publicAgent,
  publicLoanOfficer,
  recordSponsoredReuseConsent,
  resolveReusableEventPassSponsor,
  resolveExistingAgent,
  sameBrokerage,
  sameContact,
  upsertSponsoredReuseSession
};
