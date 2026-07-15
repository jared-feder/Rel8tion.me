const { supabaseRest } = require('./admin-auth');
const { callSupabaseFunction } = require('./outreach-cron-shared');
const { httpError } = require('./rel8tionos-auth');

const HANDLED_STATUSES = new Set(['interested', 'confirmed_open_house', 'accepted_open_house', 'drip_scheduled']);
const OPT_OUT_STATUSES = new Set(['opted_out', 'android_opted_out']);
const THREAD_FILTERS = new Set(['all', 'inbound', 'needs_reply', 'interested', 'opt_out']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;
const QUEUE_SELECT = [
  'id',
  'open_house_id',
  'agent_name',
  'agent_phone',
  'agent_phone_normalized',
  'agent_email',
  'brokerage',
  'address',
  'city',
  'state',
  'zip',
  'price',
  'beds',
  'baths',
  'open_start',
  'open_end',
  'review_status',
  'send_mode',
  'initial_send_status',
  'initial_sent_at',
  'initial_delivery_status',
  'followup_send_status',
  'followup_sent_at',
  'followup_delivery_status',
  'last_delivery_status',
  'last_delivery_status_updated_at',
  'last_outreach_at',
  'created_at'
].join(',');

function enc(value) {
  return encodeURIComponent(String(value || '').trim());
}

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function clampLimit(value, fallback = 40) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.trunc(parsed), 100));
}

function validateThreadId(value) {
  const id = String(value || '').trim();
  if (!UUID_PATTERN.test(id)) throw httpError(400, 'A valid thread_id is required.', 'invalid_thread_id');
  return id;
}

function validateIdempotencyKey(value) {
  const key = String(value || '').trim();
  if (!IDEMPOTENCY_PATTERN.test(key)) {
    throw httpError(400, 'idempotency_key must be 8-120 letters, numbers, dots, colons, underscores, or hyphens.', 'invalid_idempotency_key');
  }
  return key;
}

function rowTime(row) {
  const date = new Date(row?.last_reply_at || row?.created_at || 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function mergeInboxRows(...groups) {
  const merged = new Map();
  for (const group of groups) {
    for (const row of Array.isArray(group) ? group : []) {
      if (!row?.queue_row_id) continue;
      const existing = merged.get(row.queue_row_id);
      if (!existing || rowTime(row) >= rowTime(existing)) merged.set(row.queue_row_id, row);
    }
  }
  return [...merged.values()].sort((left, right) => rowTime(right) - rowTime(left));
}

function isOptedOut(row) {
  return row?.any_opt_out === true || row?.latest_reply_opt_out === true || OPT_OUT_STATUSES.has(row?.review_status);
}

function matchesFilter(row, filter) {
  const optedOut = isOptedOut(row);
  const handled = HANDLED_STATUSES.has(row?.review_status);
  if (filter === 'inbound') return row?.direction !== 'outbound';
  if (filter === 'needs_reply') return row?.direction !== 'outbound' && !optedOut && !handled;
  if (filter === 'interested') return handled;
  if (filter === 'opt_out') return optedOut;
  return true;
}

function inFilter(ids) {
  return `in.(${ids.map(enc).join(',')})`;
}

async function loadQueueRows(ids) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  const rows = await supabaseRest(
    `agent_outreach_queue?id=${inFilter(uniqueIds)}&select=${QUEUE_SELECT}&limit=${uniqueIds.length}`
  );
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [row.id, row]));
}

async function loadQueueRow(threadId) {
  const id = validateThreadId(threadId);
  const row = one(await supabaseRest(`agent_outreach_queue?id=eq.${enc(id)}&select=${QUEUE_SELECT}&limit=1`));
  if (!row) throw httpError(404, 'Outreach thread not found.', 'thread_not_found');
  return row;
}

function serializeMessage(row) {
  return {
    id: row.id,
    direction: row.direction || 'inbound',
    body: row.body || '',
    from_phone: row.from_phone || '',
    to_phone: row.to_phone || '',
    opt_out: row.opt_out === true,
    message_sid: row.message_sid || '',
    received_at: row.received_at || row.created_at || null
  };
}

function comparableOutboundBody(value) {
  return String(value || '')
    .replace(/\s*Reply\s+STOP\s+to\s+opt\s+out\.?\s*$/i, '')
    .trim();
}

function serializeThread(row) {
  const optedOut = isOptedOut(row);
  return {
    id: row.queue_row_id || row.id,
    agent: {
      name: row.agent_name || '',
      phone: row.agent_phone || '',
      email: row.agent_email || '',
      brokerage: row.brokerage || ''
    },
    property: {
      open_house_id: row.open_house_id || null,
      address: row.address || '',
      city: row.city || '',
      state: row.state || '',
      zip: row.zip || '',
      price: row.price || null,
      beds: row.beds || null,
      baths: row.baths || null,
      open_start: row.open_start || null,
      open_end: row.open_end || null
    },
    review_status: row.review_status || 'pending',
    message_count: Number(row.reply_count || 0),
    latest_message: {
      direction: row.direction || null,
      body: row.latest_reply_body || '',
      at: row.last_reply_at || null,
      opt_out: row.latest_reply_opt_out === true
    },
    delivery: {
      initial: row.initial_delivery_status || null,
      followup: row.followup_delivery_status || null,
      latest: row.last_delivery_status || null,
      updated_at: row.last_delivery_status_updated_at || null
    },
    can_reply: Boolean((row.queue_row_id || row.id) && !optedOut),
    opted_out: optedOut
  };
}

async function listThreads(options = {}) {
  const limit = clampLimit(options.limit);
  const filter = String(options.filter || 'all').trim().toLowerCase();
  if (!THREAD_FILTERS.has(filter)) {
    throw httpError(400, 'filter must be all, inbound, needs_reply, interested, or opt_out.', 'invalid_filter');
  }
  const cursorDate = options.cursor ? new Date(options.cursor) : null;
  if (options.cursor && !Number.isFinite(cursorDate.getTime())) {
    throw httpError(400, 'cursor must be an ISO date/time.', 'invalid_cursor');
  }

  const fetchLimit = Math.min(450, Math.max(150, limit * 4));
  const [inboundRows, recentRows] = await Promise.all([
    supabaseRest(
      `agent_outreach_inbox?queue_row_id=not.is.null&direction=neq.outbound&select=*&order=last_reply_at.desc&limit=${fetchLimit}`
    ),
    supabaseRest(
      `agent_outreach_inbox?queue_row_id=not.is.null&select=*&order=last_reply_at.desc&limit=${fetchLimit}`
    )
  ]);

  const merged = mergeInboxRows(inboundRows, recentRows)
    .filter((row) => !cursorDate || rowTime(row) < cursorDate.getTime())
    .filter((row) => matchesFilter(row, filter));
  const pageRows = merged.slice(0, limit);
  const queueMap = await loadQueueRows(pageRows.map((row) => row.queue_row_id));
  const threads = pageRows.map((row) => serializeThread({ ...(queueMap.get(row.queue_row_id) || {}), ...row }));
  const nextCursor = merged.length > limit && pageRows.length
    ? pageRows[pageRows.length - 1].last_reply_at || null
    : null;

  return {
    threads,
    meta: {
      filter,
      limit,
      returned: threads.length,
      next_cursor: nextCursor
    }
  };
}

async function getThread(threadId) {
  const queue = await loadQueueRow(threadId);
  const [messages, visits] = await Promise.all([
    supabaseRest(
      `agent_outreach_replies?queue_row_id=eq.${enc(queue.id)}&select=id,queue_row_id,from_phone,to_phone,body,direction,opt_out,message_sid,received_at,created_at&order=received_at.asc&limit=500`
    ),
    supabaseRest(
      `field_demo_visits?outreach_queue_id=eq.${enc(queue.id)}&status=neq.cancelled&select=*&order=created_at.desc&limit=1`
    ).catch(() => [])
  ]);
  const visit = one(visits);
  const participants = visit?.id
    ? await supabaseRest(
      `field_demo_visit_participants?field_demo_visit_id=eq.${enc(visit.id)}&select=id,participant_uid,participant_profile_id,participant_name,participant_phone,participant_email,participant_company,role,responsibility,status,is_primary&order=is_primary.desc,created_at.asc&limit=25`
    ).catch(() => [])
    : [];
  const messageRows = Array.isArray(messages) ? messages : [];
  const latest = messageRows[messageRows.length - 1] || null;
  const thread = serializeThread({
    ...queue,
    queue_row_id: queue.id,
    reply_count: messageRows.length,
    latest_reply_body: latest?.body || '',
    latest_reply_opt_out: latest?.opt_out === true,
    direction: latest?.direction || null,
    last_reply_at: latest?.received_at || latest?.created_at || queue.last_outreach_at || null
  });

  return {
    thread,
    messages: messageRows.map(serializeMessage),
    open_house: visit ? {
      field_visit_id: visit.id,
      event_id: visit.open_house_event_id || null,
      status: visit.status || null,
      scheduled_start: visit.scheduled_start || null,
      scheduled_end: visit.scheduled_end || null,
      participants: Array.isArray(participants) ? participants : []
    } : null
  };
}

async function findExistingReply(campaign) {
  const rows = await supabaseRest(
    `sms_message_log?category=eq.manual_outreach&status=in.(queued,sent)&metadata->>campaign=eq.${enc(campaign)}&select=id,external_id,status,body,metadata,created_at&order=created_at.desc&limit=1`
  );
  return one(rows);
}

async function sendReply(input = {}) {
  const threadId = validateThreadId(input.thread_id);
  const body = String(input.body || '').trim();
  if (!body) throw httpError(400, 'Message body is required.', 'message_required');
  if (body.length > 1600) throw httpError(400, 'Message body must be 1,600 characters or fewer.', 'message_too_long');
  if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(body.toUpperCase())) {
    throw httpError(400, 'An outbound reply cannot be an opt-out keyword.', 'reserved_opt_out_keyword');
  }
  const idempotencyKey = validateIdempotencyKey(input.idempotency_key);
  const campaign = `rel8tionos:${idempotencyKey}`;
  const queue = await loadQueueRow(threadId);
  if (OPT_OUT_STATUSES.has(queue.review_status)) {
    throw httpError(409, 'This contact is opted out and cannot receive a reply.', 'contact_opted_out');
  }

  const existing = await findExistingReply(campaign);
  if (existing) {
    if (comparableOutboundBody(existing.body) !== comparableOutboundBody(body) || existing.metadata?.queue_row_id !== threadId) {
      throw httpError(409, 'This idempotency_key was already used for a different reply.', 'idempotency_conflict');
    }
    return {
      duplicate: true,
      thread_id: threadId,
      message_sid: existing.external_id || null,
      provider_status: existing.status || null,
      created_at: existing.created_at || null
    };
  }

  let payload;
  try {
    payload = await callSupabaseFunction('send-agent-manual-reply', {
      id: threadId,
      body,
      campaign
    });
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('sms_quiet_hours')) {
      throw httpError(409, 'This reply is blocked by outreach quiet hours.', 'quiet_hours');
    }
    if (message.includes('sms_suppressed') || message.includes('opted-out') || message.includes('opted out')) {
      throw httpError(409, 'This contact is opted out and cannot receive a reply.', 'contact_opted_out');
    }
    throw error;
  }

  return {
    duplicate: false,
    thread_id: threadId,
    message_sid: payload?.sid || null,
    provider: payload?.provider || null,
    sent_at: payload?.sent_at || null
  };
}

async function listLoanOfficers() {
  const rows = await supabaseRest(
    'verified_profiles?is_active=eq.true&select=uid,slug,full_name,title,company_name,phone,email,photo_url,calendar_url&order=full_name.asc.nullslast,created_at.asc&limit=100'
  );
  return Array.isArray(rows) ? rows : [];
}

async function acceptOpenHouse(input = {}) {
  const threadId = validateThreadId(input.thread_id);
  const loanOfficerUid = input.loan_officer_uid ? validateThreadId(input.loan_officer_uid) : '';
  const detail = await getThread(threadId);
  if (detail.thread.opted_out) {
    throw httpError(409, 'This contact is opted out and cannot be accepted.', 'contact_opted_out');
  }
  const primaryLoanOfficer = detail.open_house?.participants?.find((row) => row.is_primary && row.responsibility === 'financing_support');
  if (
    detail.thread.review_status === 'accepted_open_house'
    && (!loanOfficerUid || primaryLoanOfficer?.participant_uid === loanOfficerUid || primaryLoanOfficer?.participant_profile_id === loanOfficerUid)
  ) {
    return { duplicate: true, ...detail };
  }

  const outreachAction = require('../api/admin/outreach-action');
  const result = await outreachAction.acceptOpenHouse({
    queue_row_id: threadId,
    loan_officer_uid: loanOfficerUid || undefined
  });
  return {
    duplicate: false,
    thread_id: threadId,
    review_status: result.queue?.review_status || 'accepted_open_house',
    field_visit_id: result.visit?.id || null,
    event_id: result.visit?.open_house_event_id || null,
    loan_officer: result.loan_officer ? {
      uid: result.loan_officer.uid,
      name: result.loan_officer.full_name || result.loan_officer.slug || ''
    } : null
  };
}

async function assignLoanOfficer(input = {}) {
  const eventId = validateThreadId(input.event_id);
  const loanOfficerUid = validateThreadId(input.loan_officer_uid);
  const current = one(await supabaseRest(
    `event_loan_officer_sessions?open_house_event_id=eq.${enc(eventId)}&status=eq.live&select=id,loan_officer_uid,verified_profile_uid,loan_officer_name,signed_in_at&order=signed_in_at.desc&limit=1`
  ));
  if (current && (current.loan_officer_uid === loanOfficerUid || current.verified_profile_uid === loanOfficerUid)) {
    return {
      duplicate: true,
      event_id: eventId,
      loan_officer_uid: loanOfficerUid,
      session_id: current.id,
      signed_in_at: current.signed_in_at || null
    };
  }

  const assignment = require('../api/admin/loan-officer-assignment');
  const result = await assignment.assignLiveCoverage(eventId, loanOfficerUid);
  return {
    duplicate: false,
    event_id: eventId,
    loan_officer_uid: loanOfficerUid,
    session_id: result.assigned?.id || null,
    field_visit_id: result.field_assignment?.visit?.id || null,
    participant_id: result.field_assignment?.participant?.id || null
  };
}

module.exports = {
  acceptOpenHouse,
  assignLoanOfficer,
  getThread,
  listLoanOfficers,
  listThreads,
  sendReply,
  comparableOutboundBody,
  serializeMessage,
  serializeThread,
  validateIdempotencyKey,
  validateThreadId
};
