const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');

async function safeRest(path, fallback, warnings, label) {
  try {
    const rows = await supabaseRest(path);
    return Array.isArray(rows) ? rows : fallback;
  } catch (error) {
    warnings.push({ label, error: error.message || String(error) });
    return fallback;
  }
}

function countBy(rows, pick) {
  const counts = {};
  for (const row of rows || []) {
    const key = pick(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function recent(rows, field, limit = 12) {
  return [...(rows || [])]
    .sort((a, b) => new Date(b?.[field] || 0) - new Date(a?.[field] || 0))
    .slice(0, limit);
}

function enc(value) {
  return encodeURIComponent(String(value || '').trim());
}

function inFilter(ids) {
  return `in.(${ids.map((id) => enc(id)).join(',')})`;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

async function safeRestInChunks(ids, buildPath, fallback, warnings, label, chunkSize = 80) {
  const uniqueIds = unique(ids);
  if (!uniqueIds.length) return fallback;
  const batches = [];
  for (let index = 0; index < uniqueIds.length; index += chunkSize) {
    const chunk = uniqueIds.slice(index, index + chunkSize);
    batches.push(safeRest(buildPath(chunk), [], warnings, label));
  }
  const rows = await Promise.all(batches);
  return rows.flat();
}

function phoneDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function buildCrm({ agents, keys, outreach, inbox, leads }) {
  const keyCounts = countBy(keys.filter((row) => row.claimed), (row) => row.agent_slug);
  const outreachCounts = countBy(outreach, (row) => row.agent_phone_normalized || phoneDigits(row.agent_phone) || row.agent_name);
  const replyCounts = countBy(inbox, (row) => row.agent_phone_normalized || phoneDigits(row.agent_phone || row.from_phone) || row.agent_name);
  const leadCounts = countBy(leads, (row) => row.agent_slug || row.agent || row.phone);

  const agentRows = agents.map((agent) => {
    const phoneKey = agent.phone_normalized || phoneDigits(agent.phone);
    return {
      ...agent,
      keychain_count: keyCounts[agent.slug] || 0,
      outreach_count: outreachCounts[phoneKey] || outreachCounts[agent.name] || 0,
      reply_count: replyCounts[phoneKey] || replyCounts[agent.name] || 0,
      lead_count: leadCounts[agent.slug] || leadCounts[agent.name] || 0,
      source: 'agents'
    };
  });

  const knownPhones = new Set(agents.map((agent) => agent.phone_normalized || phoneDigits(agent.phone)).filter(Boolean));
  const outreachOnly = outreach
    .filter((row) => {
      const phone = row.agent_phone_normalized || phoneDigits(row.agent_phone);
      return phone && !knownPhones.has(phone);
    })
    .slice(0, 120)
    .map((row) => {
      const phone = row.agent_phone_normalized || phoneDigits(row.agent_phone);
      return {
        slug: '',
        name: row.agent_name,
        phone: row.agent_phone,
        email: row.agent_email,
        brokerage: row.brokerage,
        keychain_count: 0,
        outreach_count: outreachCounts[phone] || 1,
        reply_count: replyCounts[phone] || 0,
        lead_count: 0,
        source: 'outreach'
      };
    });

  return [...agentRows, ...outreachOnly]
    .sort((a, b) => (b.reply_count + b.lead_count + b.keychain_count) - (a.reply_count + a.lead_count + a.keychain_count))
    .slice(0, 150);
}

function buildSigns({ signs, inventory, events }) {
  const inventoryBySign = countBy(inventory.filter((row) => row.smart_sign_id), (row) => row.smart_sign_id);
  const eventById = new Map(events.map((event) => [event.id, event]));

  return signs.map((sign) => {
    const activeEvent = sign.active_event_id ? eventById.get(sign.active_event_id) || null : null;
    return {
      ...sign,
      inventory_alias_count: inventoryBySign[sign.id] || 0,
      active_event_status: activeEvent?.status || '',
      active_event_host: activeEvent?.host_agent_slug || '',
      active_event_start: activeEvent?.start_time || ''
    };
  });
}

function buildEvents({ events, checkins, loanSessions }) {
  const checkinCounts = countBy(checkins, (row) => row.open_house_event_id);
  const financingCounts = countBy(checkins.filter((row) => row.pre_approved === false), (row) => row.open_house_event_id);
  const liveLoanSessions = loanSessions.filter((row) => row.status === 'live');
  const loanCounts = countBy(liveLoanSessions, (row) => row.open_house_event_id);
  const loanByEvent = new Map();
  for (const session of liveLoanSessions) {
    const existing = loanByEvent.get(session.open_house_event_id);
    if (!existing || new Date(session.signed_in_at || session.created_at || 0) > new Date(existing.signed_in_at || existing.created_at || 0)) {
      loanByEvent.set(session.open_house_event_id, session);
    }
  }

  return events.map((event) => ({
    ...event,
    checkin_count: checkinCounts[event.id] || 0,
    financing_need_count: financingCounts[event.id] || 0,
    live_loan_officer_count: loanCounts[event.id] || 0,
    live_loan_officer: loanByEvent.get(event.id) || null
  }));
}

function eventContext(event) {
  return event?.setup_context && typeof event.setup_context === 'object' ? event.setup_context : {};
}

function eventAddress(event) {
  const context = eventContext(event);
  return context.address || context.property_address || context.listing_address || context.open_house_address || event?.open_house_source_id || event?.id || 'Open house';
}

function compactAddress(parts) {
  return [
    parts.address,
    [parts.city, parts.state].filter(Boolean).join(', '),
    parts.zip
  ].filter(Boolean).join(' ');
}

function buildConversationSnapshot(queue, messages) {
  const lines = [];
  if (queue?.selected_sms) {
    const sentAt = queue.initial_sent_at || queue.last_outreach_at || queue.created_at || '';
    lines.push(`OUTBOUND${sentAt ? ` ${sentAt}` : ''}: ${queue.selected_sms}`);
  }

  for (const message of messages || []) {
    const direction = message.direction === 'outbound' ? 'OUTBOUND' : 'INBOUND';
    const when = message.received_at || message.created_at || '';
    lines.push(`${direction}${when ? ` ${when}` : ''}: ${message.body || ''}`);
  }

  return lines.join('\n\n');
}

function reportCandidateQueueIds({ outreach, visits }) {
  const reportStatuses = new Set(['confirmed_open_house', 'accepted_open_house']);
  return unique([
    ...(visits || [])
      .filter((visit) => visit.status !== 'cancelled')
      .map((visit) => visit.outreach_queue_id),
    ...(outreach || [])
      .filter((row) => reportStatuses.has(row.review_status))
      .map((row) => row.id)
  ]);
}

function buildConfirmedOpenHouses({ outreach, visits, participants, messages, openHouses, events, loanSessions }) {
  const queueById = new Map((outreach || []).map((row) => [row.id, row]));
  const openHouseById = new Map((openHouses || []).map((row) => [row.id, row]));
  const eventById = new Map((events || []).map((row) => [row.id, row]));
  const visitsByQueue = new Map();
  const participantsByVisit = new Map();
  const messagesByQueue = new Map();
  const liveLoanByEvent = new Map();

  for (const visit of visits || []) {
    if (!visit.outreach_queue_id || visit.status === 'cancelled') continue;
    const existing = visitsByQueue.get(visit.outreach_queue_id);
    if (!existing || new Date(visit.confirmed_at || visit.created_at || 0) > new Date(existing.confirmed_at || existing.created_at || 0)) {
      visitsByQueue.set(visit.outreach_queue_id, visit);
    }
  }

  for (const participant of participants || []) {
    if (!participant.field_demo_visit_id) continue;
    if (!participantsByVisit.has(participant.field_demo_visit_id)) participantsByVisit.set(participant.field_demo_visit_id, []);
    participantsByVisit.get(participant.field_demo_visit_id).push(participant);
  }

  for (const message of messages || []) {
    if (!message.queue_row_id) continue;
    if (!messagesByQueue.has(message.queue_row_id)) messagesByQueue.set(message.queue_row_id, []);
    messagesByQueue.get(message.queue_row_id).push(message);
  }

  for (const session of (loanSessions || []).filter((row) => row.status === 'live')) {
    const existing = liveLoanByEvent.get(session.open_house_event_id);
    if (!existing || new Date(session.signed_in_at || session.created_at || 0) > new Date(existing.signed_in_at || existing.created_at || 0)) {
      liveLoanByEvent.set(session.open_house_event_id, session);
    }
  }

  const queueIds = reportCandidateQueueIds({ outreach, visits });
  return queueIds.map((queueId) => {
    const queue = queueById.get(queueId) || {};
    const visit = visitsByQueue.get(queueId) || {};
    const openHouse = queue.open_house_id ? openHouseById.get(queue.open_house_id) || {} : {};
    const event = visit.open_house_event_id ? eventById.get(visit.open_house_event_id) || {} : {};
    const context = eventContext(event);
    const visitParticipants = participantsByVisit.get(visit.id) || [];
    const primaryParticipant = visitParticipants.find((item) => item.is_primary) || visitParticipants[0] || null;
    const liveLoan = event.id ? liveLoanByEvent.get(event.id) || null : null;
    const rowMessages = messagesByQueue.get(queueId) || [];

    const scheduledStart = firstPresent(visit.scheduled_start, queue.open_start, event.start_time, openHouse.open_start, context.open_start);
    const scheduledEnd = firstPresent(visit.scheduled_end, queue.open_end, event.end_time, openHouse.open_end, context.open_end);
    const address = firstPresent(queue.address, openHouse.address, context.address, context.property_address, eventAddress(event));
    const city = firstPresent(queue.city, openHouse.city, context.city);
    const state = firstPresent(queue.state, openHouse.state, context.state);
    const zip = firstPresent(queue.zip, openHouse.zip, context.zip, visit.property_zip);
    const fullAddress = compactAddress({ address, city, state, zip }) || address || 'Confirmed open house';

    return {
      id: visit.id || queueId,
      queue_row_id: queueId,
      field_visit_id: visit.id || null,
      open_house_id: firstPresent(queue.open_house_id, visit.open_house_id, event.open_house_source_id, openHouse.id),
      open_house_event_id: visit.open_house_event_id || event.id || null,
      review_status: queue.review_status || '',
      visit_status: visit.status || '',
      confirmed_at: firstPresent(visit.confirmed_at, visit.created_at, queue.initial_sent_at, queue.created_at),
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
      property_address: fullAddress,
      address,
      city,
      state,
      zip,
      price: firstPresent(queue.price, openHouse.price, openHouse.list_price, openHouse.ListPrice),
      beds: firstPresent(queue.beds, openHouse.beds, openHouse.bedrooms, openHouse.BedroomsTotal),
      baths: firstPresent(queue.baths, openHouse.baths, openHouse.bathrooms, openHouse.BathroomsTotal),
      listing_photo_url: firstPresent(queue.listing_photo_url, openHouse.listing_photo_url, openHouse.photo_url, openHouse.image_url, openHouse.primary_photo_url),
      mockup_image_url: queue.mockup_image_url || '',
      agent_photo_url: queue.agent_photo_url || '',
      agent_name: firstPresent(queue.agent_name, visit.agent_name, context.agent_name),
      agent_phone: firstPresent(queue.agent_phone, visit.agent_phone, context.agent_phone),
      agent_email: firstPresent(queue.agent_email, visit.agent_email, context.agent_email),
      brokerage: firstPresent(queue.brokerage, visit.brokerage, context.brokerage),
      loan_officer_name: firstPresent(primaryParticipant?.participant_name, liveLoan?.loan_officer_name, liveLoan?.loan_officer_slug),
      loan_officer_phone: firstPresent(primaryParticipant?.participant_phone, liveLoan?.loan_officer_phone),
      loan_officer_email: firstPresent(primaryParticipant?.participant_email, liveLoan?.loan_officer_email),
      loan_officer_company: firstPresent(primaryParticipant?.participant_company, liveLoan?.loan_officer_company),
      loan_officer_uid: firstPresent(primaryParticipant?.participant_uid, liveLoan?.loan_officer_uid, liveLoan?.verified_profile_uid),
      loan_officer_status: firstPresent(primaryParticipant?.status, liveLoan?.status),
      selected_sms: queue.selected_sms || '',
      followup_sms: queue.followup_sms || '',
      conversation_snapshot: buildConversationSnapshot(queue, rowMessages),
      message_count: rowMessages.length,
      messages: rowMessages
    };
  }).sort((a, b) => new Date(a.scheduled_start || a.confirmed_at || 0) - new Date(b.scheduled_start || b.confirmed_at || 0));
}

function buildLeads({ leads, checkins, events }) {
  const eventById = new Map((events || []).map((event) => [event.id, event]));
  const profileLeads = (leads || []).map((lead) => ({
    ...lead,
    lead_source: 'profile',
    lead_name: lead.name || 'Buyer lead',
    lead_phone: lead.phone || '',
    lead_email: lead.email || '',
    property_label: lead.property_address || '',
    agent_label: lead.agent_slug || lead.agent || '',
    financing_label: lead.preapproved === true ? 'Pre-approved' : lead.preapproved === false ? 'Needs financing' : 'Unknown',
    created_at: lead.created_at
  }));

  const eventLeads = (checkins || []).map((checkin) => {
    const event = eventById.get(checkin.open_house_event_id) || null;
    return {
      ...checkin,
      lead_source: 'event_checkin',
      lead_name: checkin.visitor_name || checkin.metadata?.name || 'Buyer check-in',
      lead_phone: checkin.visitor_phone || checkin.metadata?.phone || '',
      lead_email: checkin.visitor_email || checkin.metadata?.email || '',
      property_label: eventAddress(event),
      agent_label: event?.host_agent_slug || '',
      financing_label: checkin.pre_approved === true ? 'Pre-approved' : checkin.pre_approved === false ? 'Needs financing' : 'Unknown',
      event_status: event?.status || '',
      created_at: checkin.created_at
    };
  });

  return recent([...eventLeads, ...profileLeads], 'created_at', 200);
}

function buildFieldVisits({ visits, participants }) {
  const grouped = new Map();
  for (const visit of visits || []) {
    grouped.set(visit.id, { ...visit, participants: [] });
  }
  for (const participant of participants || []) {
    const visit = grouped.get(participant.field_demo_visit_id);
    if (visit) visit.participants.push(participant);
  }
  return [...grouped.values()]
    .sort((a, b) => new Date(a.scheduled_start || a.created_at || 0) - new Date(b.scheduled_start || b.created_at || 0))
    .slice(0, 150);
}

function buildPayments({ crmRows, signs }) {
  const signCounts = countBy(signs.filter((row) => row.owner_agent_slug || row.assigned_agent_slug), (row) => row.owner_agent_slug || row.assigned_agent_slug);

  return crmRows.slice(0, 120).map((agent) => ({
    agent_slug: agent.slug || '',
    agent_name: agent.name || '',
    brokerage: agent.brokerage || '',
    phone: agent.phone || '',
    sign_count: signCounts[agent.slug] || 0,
    lead_count: agent.lead_count || 0,
    outreach_count: agent.outreach_count || 0,
    payment_status: 'needs_billing_record',
    billing_note: 'No billing/subscription table is wired yet.'
  }));
}

module.exports = async function handler(req, res) {
  const warnings = [];

  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    assertAdminConfig();
    const auth = adminAuthorized(req);
    if (!auth.ok) {
      sendJson(res, 401, { ok: false, error: auth.error });
      return;
    }

    const [
      agents,
      keys,
      signs,
      inventory,
      events,
      checkins,
      loanSessions,
      verifiedProfiles,
      leads,
      fieldVisits,
      fieldParticipants,
      outreach,
      inbox
    ] = await Promise.all([
      safeRest('agents?select=id,slug,name,phone,phone_normalized,email,brokerage,image_url,website&order=name.asc&limit=250', [], warnings, 'agents'),
      safeRest('keys?select=uid,agent_slug,claimed,device_role,assigned_slot&limit=1000', [], warnings, 'keys'),
      safeRest('smart_signs?select=id,public_code,status,owner_agent_slug,assigned_agent_slug,assigned_slot,active_event_id,uid_primary,uid_secondary,primary_device_type,secondary_device_type,created_at,updated_at,deactivated_at&order=updated_at.desc.nullslast,created_at.desc&limit=250', [], warnings, 'smart_signs'),
      safeRest('smart_sign_inventory?select=id,public_code,smart_sign_id,is_printed,claimed_at,created_at,notes&order=created_at.desc&limit=600', [], warnings, 'smart_sign_inventory'),
      safeRest('open_house_events?select=id,host_agent_slug,smart_sign_id,open_house_source_id,status,start_time,end_time,ended_at,last_activity_at,created_at,updated_at,setup_context&order=created_at.desc&limit=250', [], warnings, 'open_house_events'),
      safeRest('event_checkins?select=id,open_house_event_id,visitor_name,visitor_phone,visitor_email,pre_approved,created_at,metadata&order=created_at.desc&limit=800', [], warnings, 'event_checkins'),
      safeRest('event_loan_officer_sessions?select=*&order=signed_in_at.desc.nullslast,created_at.desc&limit=250', [], warnings, 'event_loan_officer_sessions'),
      safeRest('verified_profiles?select=uid,industry,slug,full_name,title,company_name,phone,email,photo_url,cta_url,calendar_url,is_active,activated_at,updated_at,created_at&order=updated_at.desc.nullslast,created_at.desc&limit=250', [], warnings, 'verified_profiles'),
      safeRest('leads?select=id,name,phone,email,agent_slug,agent,preapproved,property_address,created_at&order=created_at.desc&limit=500', [], warnings, 'leads'),
      safeRest('field_demo_visits?select=*&order=scheduled_start.asc.nullslast,created_at.desc&limit=250', [], warnings, 'field_demo_visits'),
      safeRest('field_demo_visit_participants?select=*&order=is_primary.desc,created_at.asc&limit=500', [], warnings, 'field_demo_visit_participants'),
      safeRest('agent_outreach_queue?select=id,open_house_id,agent_name,agent_phone,agent_phone_normalized,agent_email,brokerage,address,city,state,zip,price,beds,baths,open_start,open_end,template_key,listing_photo_url,agent_photo_url,mockup_image_url,selected_sms,review_status,initial_send_status,initial_sent_at,followup_sms,followup_send_status,followup_send_at,followup_sent_at,send_mode,last_outreach_at,created_at&order=created_at.desc&limit=1000', [], warnings, 'agent_outreach_queue'),
      safeRest('agent_outreach_inbox?select=thread_key,queue_row_id,last_reply_at,latest_reply_body,latest_reply_opt_out,any_opt_out,direction,agent_name,agent_phone,agent_phone_normalized,brokerage,address,review_status&order=last_reply_at.desc&limit=250', [], warnings, 'agent_outreach_inbox')
    ]);

    const confirmedQueueIds = reportCandidateQueueIds({ outreach, visits: fieldVisits });
    const confirmedOpenHouseIds = unique(outreach
      .filter((row) => confirmedQueueIds.includes(row.id))
      .map((row) => row.open_house_id));
    const [confirmedMessages, confirmedOpenHouses] = await Promise.all([
      safeRestInChunks(
        confirmedQueueIds,
        (ids) => `agent_outreach_replies?queue_row_id=${inFilter(ids)}&select=id,queue_row_id,from_phone,to_phone,body,direction,opt_out,message_sid,received_at,created_at&order=received_at.asc&limit=1000`,
        [],
        warnings,
        'confirmed_open_house_messages'
      ),
      safeRestInChunks(
        confirmedOpenHouseIds,
        (ids) => `open_houses?id=${inFilter(ids)}&select=*&limit=${ids.length}`,
        [],
        warnings,
        'confirmed_open_house_listings'
      )
    ]);

    const crmRows = buildCrm({ agents, keys, outreach, inbox, leads });
    const signRows = buildSigns({ signs, inventory, events });
    const eventRows = buildEvents({ events, checkins, loanSessions });
    const leadRows = buildLeads({ leads, checkins, events });
    const fieldVisitRows = buildFieldVisits({ visits: fieldVisits, participants: fieldParticipants });
    const paymentRows = buildPayments({ crmRows, signs });
    const confirmedOpenHouseRows = buildConfirmedOpenHouses({
      outreach,
      visits: fieldVisits,
      participants: fieldParticipants,
      messages: confirmedMessages,
      openHouses: confirmedOpenHouses,
      events,
      loanSessions
    });

    sendJson(res, 200, {
      ok: true,
      loaded_at: new Date().toISOString(),
      warnings,
      overview: {
        agents: crmRows.length,
        claimed_keychains: keys.filter((row) => row.claimed).length,
        smart_signs: signs.length,
        active_signs: signs.filter((row) => row.status === 'active').length,
        open_events: events.filter((row) => row.status === 'active' && !row.ended_at).length,
        checkins: checkins.length,
        leads: leadRows.length,
        live_loan_officers: loanSessions.filter((row) => row.status === 'live').length,
        open_events_without_lo: eventRows.filter((row) => row.status === 'active' && !row.ended_at && !row.live_loan_officer).length,
        confirmed_open_houses: confirmedOpenHouseRows.length,
        incoming_threads: inbox.length,
        needs_reply: inbox.filter((row) => row.direction !== 'outbound' && !row.any_opt_out && !['interested', 'confirmed_open_house', 'accepted_open_house', 'drip_scheduled'].includes(row.review_status)).length,
        payments_needing_setup: paymentRows.filter((row) => row.payment_status === 'needs_billing_record').length
      },
      crm: crmRows,
      leads: leadRows,
      signs: signRows,
      inventory: inventory.slice(0, 150),
      events: eventRows,
      checkins: recent(checkins, 'created_at', 100),
      field_visits: fieldVisitRows,
      confirmed_open_houses: confirmedOpenHouseRows,
      loan_officers: verifiedProfiles,
      loan_sessions: loanSessions,
      payments: paymentRows,
      outreach: {
        by_review_status: countBy(outreach, (row) => row.review_status || 'pending'),
        by_initial_status: countBy(outreach, (row) => row.initial_send_status || row.send_status || 'unknown'),
        recent: recent(outreach, 'created_at', 60)
      },
      billing: {
        configured: false,
        note: 'No billing/subscription table is wired in the current Supabase contract.'
      }
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to load admin dashboard.',
      details: error.payload || null
    });
  }
};
