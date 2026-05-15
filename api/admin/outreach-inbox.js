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

  return {
    thread,
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
    const inbox = Array.isArray(rows) ? rows : [];

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
