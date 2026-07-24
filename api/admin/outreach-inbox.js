const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');

function clampLimit(value) {
  const parsed = Number(value || 60);
  if (!Number.isFinite(parsed)) return 60;
  return Math.max(1, Math.min(parsed, 150));
}

function readQuery(req, name) {
  const value = req.query?.[name];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

const HANDLED_STATUSES = new Set(['interested', 'not_now', 'confirmed_open_house', 'accepted_open_house', 'drip_scheduled']);
const OPT_OUT_STATUSES = new Set(['opted_out', 'android_opted_out']);

function phoneDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function isAndroidInboxRow(row) {
  return row?.raw_inbound === true ||
    row?.account_sid === 'android_gateway' ||
    String(row?.latest_message_sid || '').startsWith('raw-android:');
}

function hasAgentAssociation(row) {
  return Boolean(
    row?.queue_row_id &&
    (row?.agent_name || row?.agent_phone || row?.agent_phone_normalized)
  );
}

function shouldShowInboxRow(row) {
  return !isAndroidInboxRow(row) || hasAgentAssociation(row);
}

function sortCounts(rows) {
  const counts = {
    all: rows.length,
    inbound: 0,
    needs_reply: 0,
    interested: 0,
    opt_out: 0,
    raw_android_inbound: 0,
    raw_android_unlinked: 0
  };

  for (const row of rows) {
    const handled = HANDLED_STATUSES.has(row.review_status);
    const optedOut = row.any_opt_out || row.latest_reply_opt_out || OPT_OUT_STATUSES.has(row.review_status);
    const linkedThread = Boolean(row.queue_row_id || row.agent_name || row.agent_phone || row.agent_phone_normalized);
    if (row.direction !== 'outbound') counts.inbound += 1;
    if (optedOut) counts.opt_out += 1;
    if (handled) counts.interested += 1;
    if (row.raw_inbound) counts.raw_android_inbound += 1;
    if (row.raw_inbound_only) counts.raw_android_unlinked += 1;
    if (linkedThread && row.direction !== 'outbound' && !optedOut && !handled) counts.needs_reply += 1;
  }

  return counts;
}

const QUEUE_SELECT = [
  'id',
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
  'template_key',
  'listing_photo_url',
  'agent_photo_url',
  'mockup_image_url',
  'selected_sms',
  'followup_sms',
  'report_note',
  'report_note_updated_at',
  'review_status',
  'initial_send_status',
  'initial_sent_at',
  'initial_delivery_status',
  'initial_delivery_status_updated_at',
  'initial_delivery_error_code',
  'initial_delivery_error_message',
  'followup_send_status',
  'followup_send_at',
  'followup_sent_at',
  'followup_delivery_status',
  'followup_delivery_status_updated_at',
  'followup_delivery_error_code',
  'followup_delivery_error_message',
  'last_delivery_status',
  'last_delivery_status_updated_at',
  'last_delivery_error_code',
  'last_delivery_error_message',
  'send_mode',
  'last_outreach_at',
  'created_at'
].join(',');

function inFilter(ids) {
  return `in.(${ids.map((id) => encodeURIComponent(id)).join(',')})`;
}

function rowTime(row) {
  const date = new Date(row?.last_reply_at || row?.created_at || 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function mergeRows(...groups) {
  const merged = new Map();
  for (const group of groups) {
    for (const row of Array.isArray(group) ? group : []) {
      const key = row.thread_key || row.queue_row_id || row.from_phone_normalized || row.from_phone || row.id;
      if (!key) continue;
      const existing = merged.get(key);
      if (!existing || rowTime(row) >= rowTime(existing)) merged.set(key, row);
    }
  }
  return [...merged.values()].sort((a, b) => rowTime(b) - rowTime(a));
}

function queueSortTime(row) {
  const date = new Date(row?.last_outreach_at || row?.updated_at || row?.created_at || 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function mapRowsByPhone(rows, phones) {
  const phoneSet = new Set(phones);
  const mapped = new Map();
  for (const row of [...(Array.isArray(rows) ? rows : [])].sort((a, b) => queueSortTime(b) - queueSortTime(a))) {
    const rowPhone = phoneDigits(row.agent_phone_normalized || row.agent_phone);
    if (!rowPhone || !phoneSet.has(rowPhone) || mapped.has(rowPhone)) continue;
    mapped.set(rowPhone, row);
  }
  return mapped;
}

async function loadQueueRowsByPhone(phones) {
  const uniquePhones = [...new Set((phones || []).map(phoneDigits).filter(Boolean))];
  if (!uniquePhones.length) return new Map();

  const exactRows = await supabaseRest(
    `agent_outreach_queue?agent_phone_normalized=${inFilter(uniquePhones)}&select=*&order=last_outreach_at.desc.nullslast,updated_at.desc,created_at.desc&limit=1000`
  ).catch(() => []);
  const mapped = mapRowsByPhone(exactRows, uniquePhones);
  const missing = uniquePhones.filter((phone) => !mapped.has(phone));

  if (missing.length) {
    // Some older outreach rows were created before normalized phone coverage was reliable.
    const recentRows = await supabaseRest(
      'agent_outreach_queue?select=*&order=last_outreach_at.desc.nullslast,updated_at.desc,created_at.desc&limit=1000'
    ).catch(() => []);
    for (const [phone, row] of mapRowsByPhone(recentRows, missing)) mapped.set(phone, row);
  }

  return mapped;
}

async function loadRawAndroidInboundRows(limit) {
  return supabaseRest(
    `sms_inbound_messages?provider=eq.android_gateway&select=id,provider,device_id,from_phone,body,is_stop,raw_payload,created_at&order=created_at.desc&limit=${limit}`
  ).catch(() => []);
}

async function rawInboundToInboxRows(rawRows) {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  const queueByPhone = await loadQueueRowsByPhone(rows.map((row) => row.from_phone));

  return rows.flatMap((row) => {
    const fromPhoneNormalized = phoneDigits(row.from_phone);
    const queue = fromPhoneNormalized ? queueByPhone.get(fromPhoneNormalized) || null : null;
    if (!queue?.id || !(queue.agent_name || queue.agent_phone || queue.agent_phone_normalized)) return [];
    return [{
      thread_key: queue.id,
      queue_row_id: queue.id,
      latest_reply_id: null,
      latest_raw_inbound_id: row.id,
      last_reply_at: row.created_at,
      reply_count: 1,
      latest_reply_body: row.body || '',
      latest_reply_opt_out: row.is_stop === true,
      any_opt_out: row.is_stop === true,
      from_phone: row.from_phone || '',
      from_phone_normalized: fromPhoneNormalized,
      to_phone: '',
      latest_message_sid: `raw-android:${row.id}`,
      account_sid: 'android_gateway',
      direction: 'inbound',
      open_house_id: queue?.open_house_id || null,
      raw_inbound: true,
      raw_inbound_only: false,
      raw_inbound_warning: 'Android webhook row was visible before the reply thread caught up.',
      ...queue
    }];
  });
}

async function loadInboxRows(limit) {
  const fetchLimit = Math.max(limit, 150);
  const [inboundRows, recentRows, rawAndroidRows] = await Promise.all([
    supabaseRest(`agent_outreach_inbox?select=*&direction=neq.outbound&order=last_reply_at.desc&limit=${fetchLimit}`)
      .catch(() => []),
    supabaseRest(`agent_outreach_inbox?select=*&order=last_reply_at.desc&limit=${fetchLimit}`)
      .catch(() => []),
    loadRawAndroidInboundRows(fetchLimit)
  ]);
  const rawInboxRows = await rawInboundToInboxRows(rawAndroidRows);

  // Load inbound rows separately so a burst of outbound sends cannot push real replies out of REL8TION COMMAND.
  // Include raw Android webhook rows only when their phone resolves to an actual outreach agent.
  return mergeRows(rawInboxRows, inboundRows, recentRows)
    .filter(shouldShowInboxRow)
    .slice(0, Math.max(fetchLimit, limit * 2));
}

async function loadQueueRows(ids) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (!uniqueIds.length) return new Map();

  let rows;
  try {
    rows = await supabaseRest(
      `agent_outreach_queue?id=${inFilter(uniqueIds)}&select=${QUEUE_SELECT}&limit=${uniqueIds.length}`
    );
  } catch (error) {
    rows = await supabaseRest(
      `agent_outreach_queue?id=${inFilter(uniqueIds)}&select=*&limit=${uniqueIds.length}`
    );
  }

  return new Map((Array.isArray(rows) ? rows : []).map((row) => [row.id, row]));
}

async function loadMessagesForQueueRows(ids) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (!uniqueIds.length) return new Map();

  const rows = await supabaseRest(
    `agent_outreach_replies?queue_row_id=${inFilter(uniqueIds)}&select=id,queue_row_id,from_phone,to_phone,body,direction,opt_out,message_sid,received_at,created_at&order=received_at.asc&limit=1000`
  );
  const grouped = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!grouped.has(row.queue_row_id)) grouped.set(row.queue_row_id, []);
    grouped.get(row.queue_row_id).push(row);
  }

  return grouped;
}

function rawMessageForRow(row) {
  if (!row?.raw_inbound || !row.latest_raw_inbound_id) return null;
  return {
    id: `raw-android:${row.latest_raw_inbound_id}`,
    queue_row_id: row.queue_row_id || null,
    from_phone: row.from_phone || '',
    to_phone: row.to_phone || null,
    body: row.latest_reply_body || '',
    direction: 'inbound',
    opt_out: row.latest_reply_opt_out === true,
    message_sid: row.latest_message_sid || `raw-android:${row.latest_raw_inbound_id}`,
    received_at: row.last_reply_at || row.created_at,
    created_at: row.last_reply_at || row.created_at,
    raw_inbound: true
  };
}

function appendRawMessage(messages, row) {
  const rawMessage = rawMessageForRow(row);
  if (!rawMessage) return messages;
  const existing = messages.some((message) =>
    message.message_sid === rawMessage.message_sid ||
    (
      message.direction !== 'outbound' &&
      message.body === rawMessage.body &&
      phoneDigits(message.from_phone) === phoneDigits(rawMessage.from_phone) &&
      new Date(message.received_at || message.created_at || 0).getTime() === new Date(rawMessage.received_at || 0).getTime()
    )
  );
  return (existing ? messages : [...messages, rawMessage])
    .sort((a, b) => new Date(a.received_at || a.created_at || 0) - new Date(b.received_at || b.created_at || 0));
}

async function enrichInboxRows(rows) {
  const inbox = Array.isArray(rows) ? rows : [];
  const ids = inbox.map((row) => row.queue_row_id).filter(Boolean);
  const [queueMap, messageMap] = await Promise.all([
    loadQueueRows(ids),
    loadMessagesForQueueRows(ids)
  ]);

  return inbox.map((row) => {
    const queue = row.queue_row_id ? queueMap.get(row.queue_row_id) || null : null;
    const messages = appendRawMessage(row.queue_row_id ? messageMap.get(row.queue_row_id) || [] : [], row);
    return {
      ...row,
      ...(queue || {}),
      thread_key: row.thread_key,
      queue_row_id: row.queue_row_id,
      latest_reply_body: row.latest_reply_body,
      latest_reply_opt_out: row.latest_reply_opt_out,
      any_opt_out: row.any_opt_out,
      direction: row.direction,
      last_reply_at: row.last_reply_at,
      reply_count: row.reply_count,
      raw_inbound: row.raw_inbound === true,
      raw_inbound_only: row.raw_inbound_only === true,
      raw_inbound_warning: row.raw_inbound_warning || '',
      queue,
      messages
    };
  });
}

async function loadThread(threadKey) {
  const rows = await supabaseRest(
    `agent_outreach_inbox?thread_key=eq.${encodeURIComponent(threadKey)}&select=*&limit=1`
  );
  const thread = Array.isArray(rows) ? rows[0] || null : null;
  if (!thread) return { thread: null, messages: [] };

  let messages = [];
  if (thread.queue_row_id) {
    messages = await supabaseRest(
      `agent_outreach_replies?queue_row_id=eq.${encodeURIComponent(thread.queue_row_id)}&select=id,queue_row_id,from_phone,to_phone,body,direction,opt_out,message_sid,received_at,created_at&order=received_at.asc&limit=200`
    );
  } else if (thread.from_phone_normalized) {
    messages = await supabaseRest(
      `agent_outreach_replies?from_phone_normalized=eq.${encodeURIComponent(thread.from_phone_normalized)}&select=id,queue_row_id,from_phone,to_phone,body,direction,opt_out,message_sid,received_at,created_at&order=received_at.asc&limit=200`
    );
  }

  const queueMap = await loadQueueRows(thread.queue_row_id ? [thread.queue_row_id] : []);
  const queue = thread.queue_row_id ? queueMap.get(thread.queue_row_id) || null : null;

  const enrichedThread = {
    ...thread,
    ...(queue || {}),
    thread_key: thread.thread_key,
    queue_row_id: thread.queue_row_id,
    queue
  };
  if (!shouldShowInboxRow(enrichedThread)) return { thread: null, messages: [] };

  return {
    thread: {
      ...enrichedThread
    },
    messages: Array.isArray(messages) ? messages : []
  };
}

module.exports = async function handler(req, res) {
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

    const threadKey = String(readQuery(req, 'thread_key') || '').trim();
    if (threadKey) {
      const detail = await loadThread(threadKey);
      sendJson(res, 200, { ok: true, ...detail });
      return;
    }

    const limit = clampLimit(readQuery(req, 'limit'));
    const rows = await loadInboxRows(limit);
    const inbox = (await enrichInboxRows(rows)).filter(shouldShowInboxRow);

    sendJson(res, 200, {
      ok: true,
      inbox,
      counts: sortCounts(inbox),
      loaded_at: new Date().toISOString()
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to load outreach inbox.',
      details: error.payload || null
    });
  }
};
