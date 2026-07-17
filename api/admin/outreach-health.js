const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');

const HANDLED_STATUSES = new Set(['interested', 'not_now', 'confirmed_open_house', 'accepted_open_house', 'drip_scheduled']);
const OPT_OUT_STATUSES = new Set(['opted_out', 'android_opted_out']);

function clampHours(value) {
  const parsed = Number(value || 96);
  if (!Number.isFinite(parsed)) return 96;
  return Math.max(1, Math.min(parsed, 336));
}

function readQuery(req, name) {
  const value = req.query?.[name];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function enc(value) {
  return encodeURIComponent(String(value || ''));
}

function phoneDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

async function safeRest(path, fallback, warnings, label) {
  try {
    const rows = await supabaseRest(path);
    return Array.isArray(rows) ? rows : fallback;
  } catch (error) {
    warnings.push({ label, error: error.message || String(error) });
    return fallback;
  }
}

function rowTime(row) {
  const date = new Date(row?.last_reply_at || row?.received_at || row?.created_at || 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function linkedThread(row) {
  return Boolean(row?.queue_row_id || row?.agent_name || row?.agent_phone || row?.agent_phone_normalized);
}

function needsReply(row) {
  return linkedThread(row)
    && row?.direction !== 'outbound'
    && !row?.any_opt_out
    && !row?.latest_reply_opt_out
    && !row?.opt_out
    && !HANDLED_STATUSES.has(row?.review_status)
    && !OPT_OUT_STATUSES.has(row?.review_status);
}

function check(id, status, label, message, details = {}) {
  return { id, status, label, message, details };
}

function overallStatus(checks) {
  if (checks.some((item) => item.status === 'bad')) return 'bad';
  if (checks.some((item) => item.status === 'warn')) return 'warn';
  return 'ok';
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

    const hours = clampHours(readQuery(req, 'hours'));
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const warnings = [];

    const [
      androidInbound,
      outreachReplies,
      inboxRows,
      smsAttempts
    ] = await Promise.all([
      safeRest(
        `sms_inbound_messages?created_at=gte.${enc(since)}&select=id,from_phone,body,is_stop,created_at&order=created_at.desc&limit=200`,
        [],
        warnings,
        'sms_inbound_messages'
      ),
      safeRest(
        `agent_outreach_replies?direction=eq.inbound&received_at=gte.${enc(since)}&select=id,queue_row_id,from_phone,body,opt_out,received_at&order=received_at.desc&limit=200`,
        [],
        warnings,
        'agent_outreach_replies'
      ),
      safeRest(
        `agent_outreach_inbox?select=thread_key,queue_row_id,last_reply_at,latest_reply_body,latest_reply_opt_out,any_opt_out,direction,agent_name,agent_phone,agent_phone_normalized,brokerage,address,review_status&direction=neq.outbound&last_reply_at=gte.${enc(since)}&order=last_reply_at.desc&limit=200`,
        [],
        warnings,
        'agent_outreach_inbox'
      ),
      safeRest(
        `sms_message_log?created_at=gte.${enc(since)}&select=id,provider,route,category,status,error,created_at&order=created_at.desc&limit=200`,
        [],
        warnings,
        'sms_message_log'
      )
    ]);

    const linkedReplies = outreachReplies.filter((row) => row.queue_row_id);
    const stopReplies = outreachReplies.filter((row) => row.opt_out);
    const replyKeys = new Set(outreachReplies.map((row) => `${phoneDigits(row.from_phone)}|${String(row.body || '').trim()}`));
    const unlinkedAndroidInbound = androidInbound.filter((row) => !replyKeys.has(`${phoneDigits(row.from_phone)}|${String(row.body || '').trim()}`));
    const linkedInbox = inboxRows.filter(linkedThread).sort((a, b) => rowTime(b) - rowTime(a));
    const needsReplyRows = linkedInbox.filter(needsReply);
    const outboundAttempts = smsAttempts.filter((row) => row.status === 'sent' || row.status === 'queued');
    const hasInboundSignal = androidInbound.length || outreachReplies.length || inboxRows.length;

    const checks = [
      check(
        'admin_api',
        'ok',
        'Admin API',
        'Protected admin API responded.'
      ),
      check(
        'sms_attempts',
        outboundAttempts.length ? 'ok' : 'warn',
        'Outbound activity',
        outboundAttempts.length
          ? `${outboundAttempts.length} SMS attempts found in the last ${hours} hours.`
          : `No recent SMS attempts found in the last ${hours} hours.`,
        { count: outboundAttempts.length }
      ),
      check(
        'android_inbound',
        'ok',
        'Inbound webhook storage',
        androidInbound.length
          ? `${androidInbound.length} Android inbound messages stored in the last ${hours} hours.`
          : `No Android inbound webhook rows stored in the last ${hours} hours. That is normal when no Android replies arrived.`,
        { count: androidInbound.length }
      ),
      check(
        'reply_linking',
        linkedReplies.length ? 'ok' : hasInboundSignal ? 'warn' : 'ok',
        'Reply linking',
        linkedReplies.length
          ? `${linkedReplies.length} inbound replies are linked to outreach rows.`
          : hasInboundSignal
            ? 'Inbound activity exists, but no linked outreach replies were found in this window.'
            : `No inbound replies found in the last ${hours} hours.`,
        { linked: linkedReplies.length, total_replies: outreachReplies.length }
      ),
      check(
        'raw_android_fallback',
        unlinkedAndroidInbound.length ? 'warn' : 'ok',
        'Raw Android fallback',
        unlinkedAndroidInbound.length
          ? `${unlinkedAndroidInbound.length} raw Android inbound rows have not matched a reply thread yet; COMMAND will show them as raw rows.`
          : 'No raw Android inbound rows are waiting outside reply threads.',
        { count: unlinkedAndroidInbound.length }
      ),
      check(
        'inbox_view',
        linkedInbox.length || !linkedReplies.length ? 'ok' : 'bad',
        'Admin inbox view',
        linkedInbox.length
          ? `${linkedInbox.length} linked inbound threads are visible to the admin inbox.`
          : linkedReplies.length
            ? 'Linked replies exist, but the admin inbox view returned no linked inbound threads.'
            : `No linked inbound threads found in the last ${hours} hours.`,
        { linked_inbox: linkedInbox.length }
      ),
      check(
        'needs_reply',
        needsReplyRows.length ? 'ok' : linkedInbox.length ? 'warn' : 'ok',
        'Needs reply queue',
        needsReplyRows.length
          ? `${needsReplyRows.length} linked threads need a reply.`
          : linkedInbox.length
            ? 'Inbound threads are visible, but none currently need reply.'
            : `No linked inbound threads are visible in the last ${hours} hours.`,
        { count: needsReplyRows.length }
      )
    ];

    sendJson(res, 200, {
      ok: true,
      status: overallStatus(checks),
      window_hours: hours,
      counts: {
        android_inbound: androidInbound.length,
        outreach_replies: outreachReplies.length,
        linked_replies: linkedReplies.length,
        stop_replies: stopReplies.length,
        unlinked_android_inbound: unlinkedAndroidInbound.length,
        inbox_inbound: inboxRows.length,
        linked_inbox: linkedInbox.length,
        needs_reply: needsReplyRows.length,
        sms_attempts: smsAttempts.length
      },
      checks,
      latest_linked_inbound: linkedInbox.slice(0, 10),
      latest_unlinked_android_inbound: unlinkedAndroidInbound.slice(0, 10),
      warnings,
      loaded_at: new Date().toISOString()
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      status: 'bad',
      error: error.message || 'Unable to load outreach health.',
      details: error.payload || null
    });
  }
};
