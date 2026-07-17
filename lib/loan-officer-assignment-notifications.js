function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function escapeHtml(value) {
  return clean(value, 5000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizePhone(value) {
  const digits = clean(value, 40).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return clean(value, 40);
}

function baseUrl(req) {
  const configured = clean(process.env.PUBLIC_APP_URL || process.env.REL8TION_APP_URL, 500).replace(/\/$/, '');
  if (configured) return configured;
  const proto = clean(req?.headers?.['x-forwarded-proto'], 20) || 'https';
  const host = clean(req?.headers?.['x-forwarded-host'] || req?.headers?.host, 300);
  return host ? `${proto}://${host}` : 'https://app.rel8tion.me';
}

function eventDetails(event, house) {
  const context = event?.setup_context && typeof event.setup_context === 'object' ? event.setup_context : {};
  const start = event.start_time || context.open_start || context.start_time || new Date().toISOString();
  const startDate = new Date(start);
  const fallbackEnd = new Date((Number.isFinite(startDate.getTime()) ? startDate.getTime() : Date.now()) + 2 * 60 * 60 * 1000).toISOString();
  return {
    start,
    end: event.end_time || context.open_end || context.end_time || fallbackEnd,
    address: clean(house?.address || house?.full_address || context.address || context.property_address || 'Open house', 500)
  };
}

function displayDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'time to be confirmed';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  }).format(date);
}

function icsDate(value) {
  const date = new Date(value);
  return (Number.isFinite(date.getTime()) ? date : new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function icsEscape(value) {
  return clean(value, 3000).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function buildIcs({ event, house, loanOfficer, agent, dashboardUrl }) {
  const details = eventDetails(event, house);
  const loName = clean(loanOfficer.full_name || loanOfficer.name || loanOfficer.slug, 200) || 'Loan officer';
  const agentName = clean(agent.name || agent.full_name || eventContext(event).agent_name, 200) || 'Host agent';
  const description = `${loName} is assigned as financing coverage for ${agentName}. Coverage dashboard: ${dashboardUrl}`;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//REL8TION//Loan Officer Coverage//EN',
    'CALSCALE:GREGORIAN', 'METHOD:REQUEST', 'BEGIN:VEVENT',
    `UID:lo-coverage-${event.id}@rel8tion.me`, `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(details.start)}`, `DTEND:${icsDate(details.end)}`,
    `SUMMARY:${icsEscape(`Loan officer coverage - ${details.address}`)}`,
    `LOCATION:${icsEscape(details.address)}`, `DESCRIPTION:${icsEscape(description)}`,
    'STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
}

function googleCalendarUrl({ event, house, loanOfficer, agent, dashboardUrl }) {
  const details = eventDetails(event, house);
  const loName = clean(loanOfficer.full_name || loanOfficer.name || loanOfficer.slug, 200) || 'Loan officer';
  const agentName = clean(agent.name || agent.full_name, 200) || 'host agent';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Loan officer coverage - ${details.address}`,
    dates: `${icsDate(details.start)}/${icsDate(details.end)}`,
    location: details.address,
    details: `${loName} is assigned to support ${agentName}. ${dashboardUrl}`
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

async function sendSms({ to, message, eventId, recipientRole }) {
  const url = clean(process.env.SUPABASE_URL, 500).replace(/\/$/, '');
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 2000);
  if (!url || !key) throw new Error('Supabase SMS function is not configured.');
  const response = await fetch(`${url}/functions/v1/send-lead-sms`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_phone: to, buyer_phone: to, buyer_name: 'REL8TION event participant', message,
      category: 'event_transactional',
      metadata: { mode: 'loan_officer_assignment', event_id: eventId, recipient_role: recipientRole }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new Error(data?.error || `SMS send failed: ${response.status}`);
  return { status: 'sent', provider_id: data.sid || data.id || null };
}

async function sendEmail({ to, subject, html, text, ics, idempotencyKey }) {
  const apiKey = clean(process.env.RESEND_API_KEY, 500);
  if (!apiKey) return { status: 'not_configured', warning: 'RESEND_API_KEY is not configured.' };
  const from = clean(process.env.REL8TION_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'REL8TION <onboarding@resend.dev>', 320);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      from, to, subject, html, text,
      attachments: [{ filename: 'rel8tion-loan-officer-coverage.ics', content: Buffer.from(ics).toString('base64') }]
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || data?.error?.message || `Email send failed: ${response.status}`);
  return { status: 'sent', provider_id: data.id || null };
}

async function settle(label, operation) {
  try { return { channel: label, ...(await operation()) }; }
  catch (error) { return { channel: label, status: 'failed', error: error.message || String(error) }; }
}

async function notifyAssignment({ req, event, house = {}, loanOfficer, agent = {} }) {
  const details = eventDetails(event, house);
  const root = baseUrl(req);
  const loName = clean(loanOfficer.full_name || loanOfficer.name || loanOfficer.slug, 200) || 'Loan officer';
  const agentName = clean(agent.name || agent.full_name || eventContext(event).agent_name, 200) || 'Host agent';
  const dashboardUrl = `${root}/loan-officer-dashboard?uid=${encodeURIComponent(loanOfficer.uid)}`;
  const agentQuery = new URLSearchParams({ agent:event.host_agent_slug || '' });
  if (!event.is_scheduled_visit) agentQuery.set('event', event.id);
  const agentUrl = `${root}/agent-dashboard?${agentQuery.toString()}`;
  const calendarUrl = googleCalendarUrl({ event, house, loanOfficer, agent, dashboardUrl });
  const when = displayDate(details.start);
  const loContact = [normalizePhone(loanOfficer.phone), clean(loanOfficer.email, 320)].filter(Boolean).join(' / ');
  const agentContact = [normalizePhone(agent.phone), clean(agent.email, 320)].filter(Boolean).join(' / ');
  const loText = `REL8TION: ${loName}, you are confirmed as financing coverage for ${agentName}'s open house at ${details.address}, ${when}. Agent: ${agentContact || 'contact in dashboard'}. Open: ${dashboardUrl} Reply STOP to opt out.`;
  const agentText = `REL8TION: ${agentName}, ${loName} is confirmed as financing coverage for your open house at ${details.address}, ${when}. Loan officer: ${loContact || 'contact in dashboard'}. Open: ${agentUrl} Reply STOP to opt out.`;
  const ics = buildIcs({ event, house, loanOfficer, agent, dashboardUrl });
  const subject = `Confirmed: loan officer coverage at ${details.address}`;
  const html = `<h2>Open house coverage confirmed</h2><p><strong>${escapeHtml(loName)}</strong> is assigned to support <strong>${escapeHtml(agentName)}</strong>.</p><p>${escapeHtml(details.address)}<br>${escapeHtml(when)}</p><p>Loan officer: ${escapeHtml(loContact || 'See dashboard')}<br>Agent: ${escapeHtml(agentContact || 'See dashboard')}</p><p><a href="${escapeHtml(dashboardUrl)}">Loan officer dashboard</a> &middot; <a href="${escapeHtml(agentUrl)}">Agent dashboard</a> &middot; <a href="${escapeHtml(calendarUrl)}">Add to Google Calendar</a></p>`;
  const plain = `${subject}\n${loName} is assigned to support ${agentName}.\n${details.address}\n${when}\nLoan officer: ${loContact}\nAgent: ${agentContact}\n${dashboardUrl}\n${calendarUrl}`;

  const operations = [];
  if (normalizePhone(loanOfficer.phone)) operations.push(settle('loan_officer_sms', () => sendSms({ to: normalizePhone(loanOfficer.phone), message: loText, eventId: event.id, recipientRole: 'loan_officer' })));
  else operations.push(Promise.resolve({ channel: 'loan_officer_sms', status: 'skipped', warning: 'Loan officer phone is missing.' }));
  if (normalizePhone(agent.phone)) operations.push(settle('agent_sms', () => sendSms({ to: normalizePhone(agent.phone), message: agentText, eventId: event.id, recipientRole: 'agent' })));
  else operations.push(Promise.resolve({ channel: 'agent_sms', status: 'skipped', warning: 'Agent phone is missing.' }));
  if (clean(loanOfficer.email, 320)) operations.push(settle('loan_officer_email', () => sendEmail({ to: loanOfficer.email, subject, html, text: plain, ics, idempotencyKey: `lo-assignment-${event.id}-${loanOfficer.uid}` })));
  else operations.push(Promise.resolve({ channel: 'loan_officer_email', status: 'skipped', warning: 'Loan officer email is missing.' }));
  if (clean(agent.email, 320)) operations.push(settle('agent_email', () => sendEmail({ to: agent.email, subject, html, text: plain, ics, idempotencyKey: `agent-assignment-${event.id}-${loanOfficer.uid}` })));
  else operations.push(Promise.resolve({ channel: 'agent_email', status: 'skipped', warning: 'Agent email is missing.' }));
  return { attempted_at: new Date().toISOString(), calendar_url: calendarUrl, results: await Promise.all(operations) };
}

function eventContext(event) {
  return event?.setup_context && typeof event.setup_context === 'object' ? event.setup_context : {};
}

module.exports = { notifyAssignment };
