const nodemailer = require('nodemailer');
const bookingCalendar = require('../config/booking-calendar.json');
const { supabaseRest } = require('./admin-auth');

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

function authorizationError(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

function authorizeListingHost({ house = {}, listingAgents = [], agent = {}, supportingListingAgent = false, identityVerified = false } = {}) {
  if (!clean(house.id)) {
    throw authorizationError('Choose a verified listing from the open-house feed. Manual listings cannot activate a locked Event Pass.');
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
    throw authorizationError('This listing belongs to an agent at your brokerage. Confirm that you are hosting for the listing agent who is not present.');
  }
  if (supportingListingAgent && !identityVerified) {
    throw authorizationError('REL8TION could not verify the supporting agent from an existing agent profile. Use the claimed agent keychain or contact support.');
  }
  throw authorizationError('This Event Pass can only be activated by the listing agent or a verified agent from the same brokerage who is hosting for them.');
}

async function list(path) {
  const rows = await supabaseRest(path);
  return Array.isArray(rows) ? rows : [];
}

async function one(path) {
  return (await list(`${path}${path.includes('?') ? '&' : '?'}limit=1`))[0] || null;
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

async function activateNormalEventPass(body = {}) {
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
  const supportingListingAgent = body.supporting_listing_agent === true || body.supporting_listing_agent === 'true';
  const authorization = await loadListingAuthorization({
    house,
    agent,
    supportingListingAgent,
    identityVerified: true
  });

  const signId = clean(inventory.smart_sign_id || body.sign_id, 100);
  let sign = signId ? await one(`smart_signs?id=eq.${enc(signId)}&select=*`) : null;
  if (!sign) sign = await one(`smart_signs?public_code=eq.${enc(publicCode)}&select=*&order=created_at.desc`).catch(() => null);
  if (!sign?.id) {
    const error = new Error('The Event Pass NFC and QR must be paired before activation.');
    error.status = 409;
    throw error;
  }
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
    event = await one(`open_house_events?host_agent_slug=eq.${enc(key.agent_slug)}&open_house_source_id=eq.${enc(openHouseId)}&status=eq.active&ended_at=is.null&select=*&order=created_at.desc`).catch(() => null);
  }

  const setupContext = {
    ...safeObject(event?.setup_context),
    flow: 'event-pass',
    source: 'event-pass-keychain',
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
    coverage_model: 'two_carried_passes_plus_sign'
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
    source: 'event_pass_keychain'
  });
  event = notification.event || event;
  return {
    event,
    sign,
    agent: publicAgent(agent),
    house,
    authorization,
    notification: { status: notification.status, warning: notification.warning || null },
    dashboard_url: `/agent-dashboard?event=${encodeURIComponent(event.id)}&agent=${encodeURIComponent(key.agent_slug)}`
  };
}

module.exports = {
  activateNormalEventPass,
  authorizeListingHost,
  loadListingAuthorization,
  normalizeBrokerage,
  notifyOpenHouseRegistration,
  publicAgent,
  resolveExistingAgent,
  sameBrokerage,
  sameContact
};
