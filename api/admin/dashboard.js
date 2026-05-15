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
      safeRest('agent_outreach_queue?select=id,open_house_id,agent_name,agent_phone,agent_phone_normalized,agent_email,brokerage,address,city,state,zip,price,beds,baths,open_start,open_end,template_key,review_status,initial_send_status,initial_sent_at,followup_send_status,followup_send_at,followup_sent_at,send_mode,last_outreach_at,created_at&order=created_at.desc&limit=1000', [], warnings, 'agent_outreach_queue'),
      safeRest('agent_outreach_inbox?select=thread_key,queue_row_id,last_reply_at,latest_reply_body,latest_reply_opt_out,any_opt_out,direction,agent_name,agent_phone,agent_phone_normalized,brokerage,address,review_status&order=last_reply_at.desc&limit=250', [], warnings, 'agent_outreach_inbox')
    ]);

    const crmRows = buildCrm({ agents, keys, outreach, inbox, leads });
    const signRows = buildSigns({ signs, inventory, events });
    const eventRows = buildEvents({ events, checkins, loanSessions });
    const leadRows = buildLeads({ leads, checkins, events });
    const fieldVisitRows = buildFieldVisits({ visits: fieldVisits, participants: fieldParticipants });
    const paymentRows = buildPayments({ crmRows, signs });

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
        incoming_threads: inbox.length,
        needs_reply: inbox.filter((row) => row.direction !== 'outbound' && !row.any_opt_out).length,
        payments_needing_setup: paymentRows.filter((row) => row.payment_status === 'needs_billing_record').length
      },
      crm: crmRows,
      leads: leadRows,
      signs: signRows,
      inventory: inventory.slice(0, 150),
      events: eventRows,
      checkins: recent(checkins, 'created_at', 100),
      field_visits: fieldVisitRows,
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
