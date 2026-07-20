const TIME_ZONE = 'America/New_York';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function config() {
  return {
    supabaseUrl: required('SUPABASE_URL').replace(/\/$/, ''),
    serviceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    resendKey: String(process.env.RESEND_API_KEY || '').trim(),
    from: String(process.env.REL8TION_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'REL8TION <onboarding@resend.dev>').trim(),
    recipients: String(process.env.PRODUCTION_REPORT_EMAILS || process.env.PRODUCTION_REPORT_EMAIL || process.env.REL8TION_OWNER_EMAIL || '')
      .split(',').map((value) => value.trim()).filter(Boolean)
  };
}

const enc = (value) => encodeURIComponent(String(value ?? '').trim());
const clean = (value) => String(value ?? '').trim();
const one = (rows) => Array.isArray(rows) ? rows[0] || null : null;
const safeObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const esc = (value) => clean(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function nyParts(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hour12: false
  }).formatToParts(date).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
}

function nyOffsetMinutes(date) {
  const label = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, timeZoneName: 'shortOffset' })
    .formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || 'GMT-5';
  const match = label.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
  if (!match) return -300;
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === '-' ? -minutes : minutes;
}

function nyMidnightUtc(year, month, day) {
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  const offset = nyOffsetMinutes(noon);
  return new Date(Date.UTC(year, month - 1, day) - offset * 60000);
}

function reportWindow(now = new Date()) {
  const parts = nyParts(now);
  const current = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const day = current.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(current.getTime() - daysSinceMonday * 86400000);
  const end = nyMidnightUtc(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
  const prior = new Date(monday.getTime() - 7 * 86400000);
  const start = nyMidnightUtc(prior.getUTCFullYear(), prior.getUTCMonth() + 1, prior.getUTCDate());
  return { start, end, key: start.toISOString().slice(0, 10), ny: parts };
}

function mondayNineAmNewYork(now = new Date()) {
  const parts = nyParts(now);
  return parts.weekday === 'Mon' && Number(parts.hour) === 9;
}

function headers(extra = {}) {
  const { serviceKey } = config();
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json', ...extra };
}

async function rest(path, options = {}) {
  const { supabaseUrl } = config();
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: headers({ 'Content-Type': 'application/json', ...(options.headers || {}) })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}

async function patch(path, body) {
  return rest(path, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
}

async function loadEvents(window) {
  const byStart = await rest(
    `open_house_events?start_time=gte.${enc(window.start.toISOString())}` +
    `&start_time=lt.${enc(window.end.toISOString())}` +
    '&select=*&order=start_time.asc.nullslast,created_at.asc&limit=1000'
  );
  const withoutStart = await rest(
    `open_house_events?start_time=is.null&created_at=gte.${enc(window.start.toISOString())}` +
    `&created_at=lt.${enc(window.end.toISOString())}` +
    '&select=*&order=created_at.asc&limit=1000'
  );
  return [...new Map([...byStart, ...withoutStart].map((event) => [event.id, event])).values()];
}

async function loadStaleOpenEvents(window) {
  const byStart = await rest(
    `open_house_events?status=eq.active&ended_at=is.null&start_time=lt.${enc(window.end.toISOString())}&select=*&limit=1000`
  );
  const withoutStart = await rest(
    `open_house_events?status=eq.active&ended_at=is.null&start_time=is.null&created_at=lt.${enc(window.end.toISOString())}&select=*&limit=1000`
  );
  return [...new Map([...byStart, ...withoutStart].map((event) => [event.id, event])).values()];
}

async function closeEvent(event, now, dryRun) {
  const signs = await rest(`smart_signs?active_event_id=eq.${enc(event.id)}&select=id`).catch(() => []);
  if (dryRun) return { eventId: event.id, deviceCount: signs.length, closed: false };
  await patch(`open_house_events?id=eq.${enc(event.id)}`, {
    status: 'ended', ended_at: event.ended_at || now, last_activity_at: now
  });
  await patch(`smart_signs?active_event_id=eq.${enc(event.id)}`, {
    active_event_id: null, status: 'inactive', deactivated_at: now, updated_at: now
  }).catch(() => []);
  await patch(`event_loan_officer_sessions?open_house_event_id=eq.${enc(event.id)}&status=eq.live`, {
    status: 'ended', signed_out_at: now, last_seen_at: now, updated_at: now
  }).catch(() => []);
  await patch(`loan_officer_coverage_signs?active_event_id=eq.${enc(event.id)}`, {
    active_event_id: null, active_event_pass_inventory_id: null, active_smart_sign_id: null,
    status: 'assigned', updated_at: now
  }).catch(() => []);
  await patch(`loan_officer_sign_events?open_house_event_id=eq.${enc(event.id)}&status=eq.live`, {
    status: 'ended', ended_at: now
  }).catch(() => []);
  return { eventId: event.id, deviceCount: signs.length, closed: true };
}

function inFilter(ids) {
  return `in.(${ids.map(enc).join(',')})`;
}

async function supportingRows(events) {
  const eventIds = events.map((event) => event.id).filter(Boolean);
  if (!eventIds.length) return { houses: [], agents: [], checkins: [], sessions: [], messages: [], guidance: [] };
  const houseIds = [...new Set(events.map((event) => event.open_house_source_id).filter(Boolean))];
  const slugs = [...new Set(events.map((event) => event.host_agent_slug).filter(Boolean))];
  const [houses, agents, checkins, sessions, messages, guidance] = await Promise.all([
    houseIds.length ? rest(`open_houses?id=${inFilter(houseIds)}&select=id,address,price,open_start,open_end,image,agent,brokerage&limit=1000`) : [],
    slugs.length ? rest(`agents?slug=${inFilter(slugs)}&select=slug,name,email,phone,brokerage&limit=1000`) : [],
    rest(`event_checkins?open_house_event_id=${inFilter(eventIds)}&select=id,open_house_event_id,visitor_type,pre_approved,metadata,created_at&limit=5000`),
    rest(`event_loan_officer_sessions?open_house_event_id=${inFilter(eventIds)}&select=id,open_house_event_id,loan_officer_name,loan_officer_email,loan_officer_company,status,source&limit=2000`),
    rest(`event_conversation_messages?open_house_event_id=${inFilter(eventIds)}&select=id,open_house_event_id,sender_role,created_at&limit=5000`).catch(() => []),
    rest(`buyer_affordability_guidance?source_event_id=${inFilter(eventIds)}&select=id,source_event_id,status,created_at&limit=5000`).catch(() => [])
  ]);
  return { houses, agents, checkins, sessions, messages, guidance };
}

function summarize(events, related, closedDevices = new Map()) {
  const houseById = new Map(related.houses.map((row) => [String(row.id), row]));
  const agentBySlug = new Map(related.agents.map((row) => [row.slug, row]));
  const rows = events.map((event) => {
    const checkins = related.checkins.filter((row) => row.open_house_event_id === event.id);
    const sessions = related.sessions.filter((row) => row.open_house_event_id === event.id);
    const messages = related.messages.filter((row) => row.open_house_event_id === event.id);
    const guidance = related.guidance.filter((row) => row.source_event_id === event.id);
    const financing = checkins.filter((row) => safeObject(row.metadata).financing_requested === true).length;
    const disclosures = checkins.filter((row) => safeObject(row.metadata).disclosure_accepted === true).length;
    const house = houseById.get(String(event.open_house_source_id)) || {};
    const agent = agentBySlug.get(event.host_agent_slug) || {};
    const context = safeObject(event.setup_context);
    return {
      id: event.id,
      address: house.address || context.address || 'Open house',
      start: event.start_time || event.created_at,
      agent: agent.name || context.agent_name || event.host_agent_slug || 'Unassigned agent',
      brokerage: agent.brokerage || context.brokerage || context.detected_brokerage || '',
      loanOfficer: sessions[0]?.loan_officer_name || context.sponsor_loan_officer_name || 'None',
      checkins: checkins.length,
      financing,
      preApproved: checkins.filter((row) => row.pre_approved === true).length,
      disclosures,
      messages: messages.length,
      guidance: guidance.length,
      devices: closedDevices.get(event.id) || Number(context.coverage_device_count || 1),
      status: event.status || ''
    };
  });
  return {
    rows,
    totals: rows.reduce((out, row) => ({
      events: out.events + 1,
      checkins: out.checkins + row.checkins,
      financing: out.financing + row.financing,
      disclosures: out.disclosures + row.disclosures,
      messages: out.messages + row.messages,
      guidance: out.guidance + row.guidance
    }), { events: 0, checkins: 0, financing: 0, disclosures: 0, messages: 0, guidance: 0 })
  };
}

function reportHtml(summary, window, staleClosed) {
  const range = `${window.start.toLocaleDateString('en-US', { timeZone: TIME_ZONE })} – ${new Date(window.end.getTime() - 1).toLocaleDateString('en-US', { timeZone: TIME_ZONE })}`;
  const metric = (label, value) => `<td style="padding:14px;border:1px solid #dbeafe;background:#eff6ff;text-align:center"><div style="font-size:25px;font-weight:900;color:#172554">${value}</div><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#64748b">${esc(label)}</div></td>`;
  const eventRows = summary.rows.length ? summary.rows.map((row) => `<tr><td style="padding:10px;border-bottom:1px solid #e2e8f0"><strong>${esc(row.address)}</strong><br><span style="color:#64748b">${esc(new Date(row.start).toLocaleString('en-US', { timeZone: TIME_ZONE }))}</span></td><td style="padding:10px;border-bottom:1px solid #e2e8f0">${esc(row.agent)}<br><span style="color:#64748b">${esc(row.loanOfficer)}</span></td><td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:center">${row.checkins}</td><td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:center">${row.financing}</td><td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:center">${row.disclosures}</td><td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:center">${row.devices}</td></tr>`).join('') : '<tr><td colspan="6" style="padding:18px;text-align:center;color:#64748b">No events were recorded in this reporting period.</td></tr>';
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:900px;margin:auto;padding:28px"><div style="background:#172554;color:white;padding:24px;border-radius:22px"><div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:#7dd3fc">REL8TION</div><h1 style="margin:8px 0 4px">Weekly Open House Production Report</h1><div>${esc(range)}</div></div><table style="width:100%;border-collapse:collapse;margin-top:18px"><tr>${metric('Events',summary.totals.events)}${metric('Buyer check-ins',summary.totals.checkins)}${metric('Financing requests',summary.totals.financing)}${metric('Disclosures',summary.totals.disclosures)}${metric('Messages',summary.totals.messages)}${metric('LO guidance',summary.totals.guidance)}</tr></table><div style="margin-top:18px;background:white;border-radius:18px;padding:18px"><h2 style="margin-top:0">Event production</h2><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;color:#475569"><th style="padding:10px">Open house</th><th style="padding:10px">Agent / LO</th><th style="padding:10px">Buyers</th><th style="padding:10px">Finance</th><th style="padding:10px">Docs</th><th style="padding:10px">Devices</th></tr></thead><tbody>${eventRows}</tbody></table></div><p style="color:#475569;font-size:13px">${staleClosed} stale open event${staleClosed===1?' was':'s were'} automatically closed Monday morning. Buyer records and disclosure evidence remain saved.</p></div></body></html>`;
}

function reportText(summary, window, staleClosed) {
  const lines = [
    'REL8TION Weekly Open House Production Report',
    `${window.start.toLocaleDateString('en-US', { timeZone: TIME_ZONE })} - ${new Date(window.end.getTime() - 1).toLocaleDateString('en-US', { timeZone: TIME_ZONE })}`,
    `Events: ${summary.totals.events} | Check-ins: ${summary.totals.checkins} | Financing requests: ${summary.totals.financing} | Disclosures: ${summary.totals.disclosures}`,
    `Stale events automatically closed: ${staleClosed}`,
    ''
  ];
  summary.rows.forEach((row) => lines.push(`${row.address} | ${row.agent} | LO: ${row.loanOfficer} | Buyers: ${row.checkins} | Financing: ${row.financing} | Docs: ${row.disclosures} | Devices: ${row.devices}`));
  return lines.join('\n');
}

async function sendReport(summary, window, staleClosed) {
  const cfg = config();
  if (!cfg.resendKey || !cfg.recipients.length) {
    return { status: 'not_configured', missing: [!cfg.resendKey ? 'RESEND_API_KEY' : '', !cfg.recipients.length ? 'PRODUCTION_REPORT_EMAILS' : ''].filter(Boolean) };
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `rel8tion-weekly-production-${window.key}` },
    body: JSON.stringify({
      from: cfg.from,
      to: cfg.recipients,
      subject: `REL8TION Weekly Production Report — week of ${window.key}`,
      html: reportHtml(summary, window, staleClosed),
      text: reportText(summary, window, staleClosed)
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Resend ${response.status}: ${JSON.stringify(payload)}`);
  return { status: 'sent', id: payload.id || '', recipients: cfg.recipients.length };
}

async function run({ now = new Date(), dryRun = false, force = false } = {}) {
  if (!force && !mondayNineAmNewYork(now)) return { skipped: true, reason: 'outside_monday_9am_new_york' };
  const window = reportWindow(now);
  const staleEvents = await loadStaleOpenEvents(window);
  const closedDevices = new Map();
  for (const event of staleEvents) {
    const result = await closeEvent(event, now.toISOString(), dryRun);
    closedDevices.set(event.id, result.deviceCount);
  }
  const events = await loadEvents(window);
  const related = await supportingRows(events);
  const summary = summarize(events, related, closedDevices);
  const email = dryRun ? { status: 'dry_run' } : await sendReport(summary, window, staleEvents.length);
  return {
    skipped: false,
    dryRun,
    window: { start: window.start.toISOString(), end: window.end.toISOString(), key: window.key },
    staleEventsClosed: dryRun ? 0 : staleEvents.length,
    staleEventsWouldClose: dryRun ? staleEvents.length : 0,
    totals: summary.totals,
    events: summary.rows,
    email
  };
}

module.exports = { mondayNineAmNewYork, reportWindow, run };
