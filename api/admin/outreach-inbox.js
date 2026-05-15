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

function sortCounts(rows) {
  const counts = {
    all: rows.length,
    inbound: 0,
    needs_reply: 0,
    opt_out: 0
  };

  for (const row of rows) {
    if (row.direction !== 'outbound') counts.inbound += 1;
    if (row.any_opt_out || row.latest_reply_opt_out || row.review_status === 'opted_out') counts.opt_out += 1;
    if (row.direction !== 'outbound' && !row.any_opt_out && row.review_status !== 'opted_out') counts.needs_reply += 1;
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
  'review_status',
  'initial_send_status',
  'followup_send_status',
  'send_mode',
  'last_outreach_at',
  'created_at'
].join(',');

function inFilter(ids) {
  return `in.(${ids.map((id) => encodeURIComponent(id)).join(',')})`;
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

async function enrichInboxRows(rows) {
  const inbox = Array.isArray(rows) ? rows : [];
  const ids = inbox.map((row) => row.queue_row_id).filter(Boolean);
  const [queueMap, messageMap] = await Promise.all([
    loadQueueRows(ids),
    loadMessagesForQueueRows(ids)
  ]);

  return inbox.map((row) => {
    const queue = row.queue_row_id ? queueMap.get(row.queue_row_id) || null : null;
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
      queue,
      messages: row.queue_row_id ? messageMap.get(row.queue_row_id) || [] : []
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

  return {
    thread: {
      ...thread,
      ...(queue || {}),
      thread_key: thread.thread_key,
      queue_row_id: thread.queue_row_id,
      queue
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
    const rows = await supabaseRest(
      `agent_outreach_inbox?select=*&order=last_reply_at.desc&limit=${limit}`
    );
    const inbox = await enrichInboxRows(rows);

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
