const { createHash } = require('node:crypto');
const shared = require('./weekly-production-report-worker.cjs');
const { agentNameAnchor } = require('./lib/agent-name-identity');
const { usableAgentName } = require('./lib/agent-identity');
const { reportWindow, mondayNineAmNewYork, rest, allRows, emailConfiguration } = shared;
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const unique = (values) => new Set(values.filter(Boolean)).size;
const ratio = (a, b) => b ? a / b : null;
const phone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 10 ? `1${digits}` : digits.length >= 11 ? digits : '';
};
const contact = (row) => phone(row.agent_phone_normalized || row.phone_normalized || row.from_phone_normalized || row.agent_phone || row.phone || row.from_phone)
  || String(row.agent_email || row.email || '').trim().toLowerCase();
const stamp = (value) => {
  if (!value) return NaN;
  const text = String(value).replace(' ', 'T');
  return Date.parse(/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(text) ? text : `${text}Z`);
};
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const day = (value) => Number.isFinite(stamp(value)) ? dayFormatter.format(new Date(stamp(value))) : '';
const cohortCache = new Map();
function cohort(value) {
  if (cohortCache.has(value)) return cohortCache.get(value);
  if (!Number.isFinite(stamp(value))) return '';
  const date = new Date(`${day(value)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  const result = date.toISOString().slice(0, 10);
  if (cohortCache.size > 100000) cohortCache.clear();
  cohortCache.set(value, result);
  return result;
}

function summarize(data, window, previous = [], now = new Date()) {
  const asOf = now.getTime();
  const known = (row, field = 'created_at') => !row[field] || stamp(row[field]) <= asOf;
  const queue = data.queue.filter((row) => known(row));
  const names = new Map();
  for (const row of [...queue, ...data.agents]) {
    const key = contact(row), name = agentNameAnchor(usableAgentName(row.agent_name || row.name));
    if (!key || !name) continue;
    if (!names.has(key)) names.set(key, new Set());
    names.get(key).add(name);
  }
  const identity = (row, fallback) => {
    const key = contact(row);
    if (!key) return fallback;
    const name = agentNameAnchor(usableAgentName(row.agent_name || row.name));
    if (name) return `${key}|${name}`;
    const candidates = names.get(key);
    return candidates?.size === 1 ? `${key}|${[...candidates][0]}` : candidates?.size > 1 ? fallback : key;
  };
  const byId = new Map(queue.map((row) => [row.id, row]));
  const sent = queue.map((row) => ({ ...row, initial: row.initial_sent_at || row.manual_sms_sent_at || row.sent_at,
    person: identity(row, `queue:${row.id}`) })).filter((row) => Number.isFinite(stamp(row.initial)) && stamp(row.initial) <= asOf);
  const sentById = new Map(sent.map((row) => [row.id, row]));
  const people = new Map();
  for (const row of queue) {
    const id = identity(row, `queue:${row.id}`);
    if (!people.has(id)) people.set(id, { statuses: new Set(), brokerage: row.brokerage || 'Unknown', contact: contact(row) });
    people.get(id).statuses.add(String(row.review_status || '').toLowerCase());
  }
  const replies = data.replies.filter((row) => known(row, 'received_at'));
  const inbound = replies.filter((row) => row.direction === 'inbound');
  const replyTimes = new Map();
  const linkedReplyTimes = new Map();
  const suppressed = new Set(data.suppression.filter((row) => known(row)).map(contact).filter(Boolean));
  queue.filter((row) => /opt(?:ed)?[_ -]?out/i.test(row.review_status || '')).forEach((row) => { if (contact(row)) suppressed.add(contact(row)); });
  for (const row of inbound) {
    const linked = byId.get(row.queue_row_id);
    const id = linked ? identity(linked, `queue:${linked.id}`) : identity(row, '');
    if (!id) continue;
    if (!people.has(id)) people.set(id, { statuses: new Set(), brokerage: 'Unknown', contact: contact(row) });
    people.get(id).statuses.add('replied');
    if (row.opt_out) suppressed.add(contact(row) || contact(linked || {}));
    const key = linked ? row.queue_row_id : id;
    const target = linked ? linkedReplyTimes : replyTimes;
    if (!target.has(key)) target.set(key, []);
    target.get(key).push(stamp(row.received_at || row.created_at));
  }
  const hasReply = (row) => [...(linkedReplyTimes.get(row.id) || []), ...(replyTimes.get(row.person) || [])].some((time) => time >= stamp(row.initial));
  // Only proven confirmations enter the ledger. Later cancellations/suppression do not erase them.
  const ledger = new Map(previous.map((item) => [item.key, { ...item }]));
  const visits = data.visits.filter((row) => known(row) && !/test/i.test(row.source || '') && row.outreach_queue_id);
  const visitsByQueue = new Map();
  for (const visit of visits) {
    if (!visitsByQueue.has(visit.outreach_queue_id)) visitsByQueue.set(visit.outreach_queue_id, []);
    visitsByQueue.get(visit.outreach_queue_id).push(visit);
  }
  for (const row of queue) {
    const linked = visitsByQueue.get(row.id) || [];
    const confirmed = ['confirmed', 'accepted'].includes(row.review_status) || linked.length > 0;
    const key = hash(`${row.open_house_id || row.id}|${day(row.open_start || linked[0]?.scheduled_start)}`);
    if (!confirmed && !ledger.has(key)) continue;
    const person = identity(row, `queue:${row.id}`);
    const initial = sentById.get(row.id)?.initial || null;
    const prior = ledger.get(key);
    const earliest = prior?.initial && (!initial || stamp(prior.initial) < stamp(initial)) ? prior.initial : initial;
    ledger.set(key, { key, agent: prior?.agent || hash(person), initial: earliest, cohort: earliest ? cohort(earliest) : '',
      source: row.source || prior?.source || 'Unknown',
      cancelled: linked.length ? linked.every((visit) => ['cancelled', 'canceled'].includes(visit.status)) : Boolean(prior?.cancelled),
      optedOut: suppressed.has(contact(row)) || /opt(?:ed)?[_ -]?out/i.test(row.review_status || '') });
    people.get(person).statuses.add('confirmed');
  }
  const outcomes = [...ledger.values()];
  const activeBrokerages = new Map();
  const statuses = { replied: 0, confirmed: 0, interested: 0, opted_out: 0, not_now: 0 };
  for (const [id, person] of people) {
    const s = person.statuses;
    const status = suppressed.has(person.contact) || [...s].some((v) => /opt(?:ed)?[_ -]?out/i.test(v)) ? 'opted_out'
      : s.has('not_now') ? 'not_now' : s.has('confirmed') || s.has('accepted') ? 'confirmed'
        : s.has('interested') ? 'interested' : s.has('replied') ? 'replied' : null;
    if (!status) continue;
    statuses[status]++;
    if (['confirmed', 'interested', 'replied'].includes(status)) activeBrokerages.set(person.brokerage, (activeBrokerages.get(person.brokerage) || 0) + 1);
  }
  const initialMessages = new Map(sent.map((row) => [row.twilio_sid_initial || `initial:${row.id}`, row]));
  const followups = new Map(queue.filter((row) => Number.isFinite(stamp(row.followup_sent_at)) && stamp(row.followup_sent_at) <= asOf)
    .map((row) => [row.twilio_sid_followup || `followup:${row.id}`, row]));
  const queueSids = new Set(queue.flatMap((row) => [row.twilio_sid_initial, row.twilio_sid_followup]).filter(Boolean));
  const conversations = new Map(replies.filter((row) => row.direction === 'outbound' && !queueSids.has(row.message_sid))
    .map((row) => [row.message_sid || row.id, row]));
  const houses = data.houses.filter((row) => known(row) && !/qa_fixture|manual_test/i.test(row.source || ''));
  const agents = data.agents.filter((row) => known(row));
  const enriched = new Set(agents.map((row) => row.open_house_id).filter(Boolean));
  const priorKey = reportWindow(window.start).key;
  const firstWeek = [...houses.map((row) => cohort(row.created_at)), ...sent.map((row) => cohort(row.initial)), priorKey].filter(Boolean).sort()[0];
  const weeks = [];
  for (let cursor = firstWeek; cursor <= window.key;) {
    const q = [...initialMessages.values()].filter((row) => cohort(row.initial) === cursor);
    const h = houses.filter((row) => cohort(row.created_at) === cursor);
    const a = agents.filter((row) => cohort(row.created_at) === cursor);
    const wins = outcomes.filter((row) => row.cohort === cursor);
    const contacts = unique(q.map((row) => row.person));
    const repliers = unique(q.filter(hasReply).map((row) => row.person));
    const checkins = data.checkins.filter((row) => known(row) && row.visitor_type !== 'buyer_agent' && cohort(row.created_at) === cursor);
    const leads = data.leads.filter((row) => known(row) && cohort(row.created_at) === cursor);
    weeks.push({ week: cursor, initial: q.length, contacts, replied: repliers, replyRate: ratio(repliers, contacts), confirmed: wins.length,
      conversionRate: ratio(wins.length, q.length), cancelled: wins.filter((row) => row.cancelled).length,
      houses: h.length, enrichedHouses: unique(a.map((row) => row.open_house_id)), enrichedAgents: unique(a.map((row) => identity(row, `agent:${row.id}`))), enrichmentRows: a.length,
      buyerCheckins: checkins.length, producingEvents: unique(checkins.map((row) => row.open_house_event_id)), profileLeads: leads.length });
    const date = new Date(`${cursor}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 7); cursor = date.toISOString().slice(0, 10);
  }
  // Empty historical intake must still produce the selected and comparison weeks.
  const empty = (week) => ({ week, initial: 0, contacts: 0, replied: 0, replyRate: null, confirmed: 0, conversionRate: null, cancelled: 0, houses: 0, enrichedHouses: 0, enrichedAgents: 0, enrichmentRows: 0, buyerCheckins: 0, producingEvents: 0, profileLeads: 0 });
  const recent = weeks.slice(-8);
  const average = (rows, field) => rows.length ? rows.reduce((n, row) => n + row[field], 0) / rows.length : 0;
  const contacts = unique(sent.map((row) => row.person));
  const replied = unique(sent.filter(hasReply).map((row) => row.person));
  const mix = { initial: initialMessages.size, followup: followups.size, conversation: conversations.size };
  const warnings = [
    'Weekly activity uses completed Monday-Sunday periods in America/New_York. Lifetime and cohort outcomes reflect evidence available at generation time.',
    'Confirmed history includes confirmed/accepted queue rows or linked non-test field visits, including later cancellations and opt-outs. Source deletions before this archive began cannot be reconstructed.',
    'Replies use queue links first; unlinked replies use normalized contact identity after the initial send. Reply rate counts distinct contacted agents; confirmation conversion uses initial outreach messages.',
    'Initial sends use initial_sent_at, then recorded manual send time, then legacy sent_at. Conversation messages exclude queue initial/follow-up provider IDs. Recorded sends are not proof of delivery.',
    'Lead counts are records, not unique buyers or proof of outreach attribution. Buyer-agent-only check-ins are excluded. Contact identities use phone/email with compatible names; conflicting names stay separate.',
    'This is a saved reconstruction from current source records, not a revision of the original August PDFs. Saved snapshots are never overwritten.'
  ];
  return { version: 1, generatedAt: now.toISOString(), week: window.key, window: { start: window.start.toISOString(), end: window.end.toISOString() },
    lifetime: { outbound: mix.initial + mix.followup + mix.conversation, mix, contacts, replied, replyRate: ratio(replied, contacts),
      confirmed: outcomes.length, confirmedHosts: unique(outcomes.map((row) => row.agent)), cancelled: outcomes.filter((row) => row.cancelled).length,
      hostOptOuts: unique(outcomes.filter((row) => row.optedOut).map((row) => row.agent)),
      repeatHosts: [...outcomes.reduce((map, row) => map.set(row.agent, (map.get(row.agent) || 0) + 1), new Map()).values()].filter((n) => n > 1).length,
      buyerCheckins: data.checkins.filter((row) => known(row) && row.visitor_type !== 'buyer_agent').length,
      profileLeads: data.leads.filter((row) => known(row)).length },
    current: weeks.find((row) => row.week === window.key) || empty(window.key), prior: weeks.find((row) => row.week === priorKey) || empty(priorKey), cohorts: recent,
    relationships: { active: statuses.replied + statuses.confirmed + statuses.interested, universe: Object.values(statuses).reduce((a, b) => a + b, 0), statuses,
      brokerages: [...activeBrokerages].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count })) },
    engine: { houses: houses.length, completedWeeks: weeks.length, firstWeek, housesPerWeek: average(weeks, 'houses'), recentHousesPerWeek: average(recent, 'houses'),
      agentsPerWeek: average(weeks, 'enrichedAgents'), recentAgentsPerWeek: average(recent, 'enrichedAgents'),
      recordWithoutFlag: houses.filter((row) => enriched.has(row.id) && !row.agent_enriched).length,
      flagWithoutRecord: houses.filter((row) => row.agent_enriched && !enriched.has(row.id)).length,
      sources: [...houses.reduce((map, row) => map.set(row.source || 'Unknown', (map.get(row.source || 'Unknown') || 0) + 1), new Map())].map(([name, count]) => ({ name, count })) },
    quality: { missingContactIdentity: sent.filter((row) => row.person.startsWith('queue:')).length, unmatchedInbound: inbound.filter((row) => !byId.has(row.queue_row_id)).length },
    confirmationLedger: outcomes, notes: warnings };
}

async function buildReport(window) {
  const now = new Date();
  const queries = {
    queue: 'agent_outreach_queue?select=id,open_house_id,agent_name,agent_phone_normalized,agent_phone,agent_email,brokerage,source,open_start,review_status,initial_sent_at,manual_sms_sent_at,sent_at,followup_sent_at,twilio_sid_initial,twilio_sid_followup,created_at',
    replies: 'agent_outreach_replies?select=id,queue_row_id,from_phone_normalized,from_phone,direction,opt_out,message_sid,received_at,created_at',
    visits: 'field_demo_visits?select=id,outreach_queue_id,status,source,scheduled_start,created_at',
    houses: 'open_houses?select=id,created_at,source,agent_enriched',
    agents: 'listing_agents?select=id,open_house_id,name,phone_normalized,phone,email,source,created_at',
    checkins: 'event_checkins?select=id,open_house_event_id,visitor_type,created_at',
    leads: 'leads?select=id,created_at',
    suppression: 'sms_suppression_list?select=id,phone,created_at'
  };
  const entries = await Promise.all(Object.entries(queries).map(async ([name, path]) => [name, await allRows(`${path}&created_at=lte.${encodeURIComponent(now.toISOString())}&order=id.asc`)]));
  const previous = await allRows('outreach_performance_reports?generation_status=eq.ready&select=summary&order=generated_at.asc,week_start.asc');
  return summarize(Object.fromEntries(entries), window, previous.flatMap((row) => row.summary?.confirmationLedger || []), now);
}

async function sendReport(summary, window) {
  const { renderPdf, emailHtml } = require('./lib/outreach-report-pdf');
  const delivery = emailConfiguration();
  const recipients = String(process.env.PRODUCTION_REPORT_EMAILS || process.env.PRODUCTION_REPORT_EMAIL || process.env.REL8TION_OWNER_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!delivery.provider || !recipients.length) return { status: 'not_configured' };
  const pdf = Buffer.from(await renderPdf(summary));
  const filename = `rel8tion-outreach-performance-brief-${window.key}.pdf`;
  const subject = `REL8TION Outreach Performance Brief - week of ${window.key}`;
  const text = `Your six-section outreach brief for the week of ${window.key} is attached. View the saved archive at https://app.rel8tion.me/command?area=reports`;
  if (delivery.provider === 'smtp') {
    const port = Number(process.env.SMTP_PORT || 465);
    const transport = require('nodemailer').createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 });
    try {
      const result = await transport.sendMail({ from: process.env.REL8TION_FROM_EMAIL || process.env.LEAD_FROM_EMAIL || process.env.SMTP_USER,
        to: recipients, messageId: `<outreach-performance-${window.key}@rel8tion.me>`, subject, text, html: emailHtml(summary),
        attachments: [{ filename, content: pdf, contentType: 'application/pdf' }] });
      if (result.rejected?.length || !result.accepted?.length) throw new Error('Recipients were not all accepted.');
      return { status: 'sent', id: result.messageId || '' };
    } catch (error) {
      const failure = new Error('SMTP submission failed. Verify provider activity before retrying.');
      failure.definiteRejection = ['EAUTH', 'ECONNECTION'].includes(error.code); throw failure;
    } finally { transport.close(); }
  }
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `rel8tion-outreach-performance-${window.key}` },
    body: JSON.stringify({ from: process.env.REL8TION_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'REL8TION <onboarding@resend.dev>',
      to: recipients, subject, text, html: emailHtml(summary), attachments: [{ filename, content: pdf.toString('base64') }] }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(`Email provider rejected the report (${response.status}).`); error.definiteRejection = response.status >= 400 && response.status < 500; throw error; }
  return { status: 'sent', id: result.id || '' };
}

async function run({ now = new Date(), force = false, dryRun = false } = {}) {
  if (!force && !mondayNineAmNewYork(now)) return { skipped: true, reason: 'outside_monday_9am_new_york' };
  const window = reportWindow(now);
  if (dryRun) return { dryRun: true, summary: await buildReport(window) };
  return require('./lib/outreach-report-archive').processReport({ window, scheduled: true, now });
}
module.exports = { summarize, cohort, stamp, buildReport, sendReport, run, reportWindow, mondayNineAmNewYork, rest, emailConfiguration };
