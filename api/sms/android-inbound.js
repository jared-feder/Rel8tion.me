const crypto = require('crypto');
const { sendJson, supabaseRest } = require('../../lib/admin-auth');

const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const PRESERVED_REVIEW_STATUSES = new Set(['interested', 'confirmed_open_house', 'accepted_open_house']);

function clean(value) {
  return String(value ?? '').trim();
}

function firstPresent(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return '';
}

function readHeader(req, name) {
  return req.headers?.[name] || req.headers?.[name.toLowerCase()] || req.headers?.[name.toUpperCase()] || '';
}

function queryParam(req, name) {
  if (req.query && req.query[name]) {
    return Array.isArray(req.query[name]) ? req.query[name][0] : req.query[name];
  }
  try {
    return new URL(req.url || '', 'https://app.rel8tion.me').searchParams.get(name) || '';
  } catch {
    return '';
  }
}

function phoneDigits(phone) {
  const digits = clean(phone).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function toE164(phone) {
  const raw = clean(phone);
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+') && digits.length >= 10) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

function isStop(body) {
  const text = clean(body).toUpperCase();
  if (STOP_WORDS.has(text)) return true;
  return text.split(/\r?\n+/).some((line) => STOP_WORDS.has(line.trim().replace(/[.!?]+$/g, '')));
}

function safeIsoTimestamp(value) {
  const dt = new Date(clean(value));
  return Number.isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString();
}

async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function parsePayload(rawBody, req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const contentType = clean(readHeader(req, 'content-type')).toLowerCase();
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(rawBody));
  }
  try {
    return rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return {};
  }
}

function signatureHeader(req) {
  return firstPresent(
    readHeader(req, 'x-sms-gateway-signature'),
    readHeader(req, 'x-android-signature'),
    readHeader(req, 'x-signature-sha256'),
    readHeader(req, 'x-hub-signature-256'),
    readHeader(req, 'x-signature'),
    readHeader(req, 'signature')
  );
}

function safeEqual(a, b) {
  const left = Buffer.from(clean(a));
  const right = Buffer.from(clean(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function validSignature(rawBody, signature, signingKey) {
  const cleanSignature = clean(signature);
  if (!cleanSignature || !signingKey) return false;
  const hmac = crypto.createHmac('sha256', signingKey).update(rawBody);
  const hex = hmac.digest('hex');
  const base64 = crypto.createHmac('sha256', signingKey).update(rawBody).digest('base64');
  return [
    hex,
    `sha256=${hex}`,
    base64,
    `sha256=${base64}`
  ].some((candidate) => safeEqual(cleanSignature, candidate));
}

function authorizeWebhook(req, rawBody) {
  const signingKey = clean(process.env.ANDROID_INBOUND_SIGNING_KEY);
  const webhookSecret = clean(process.env.ANDROID_INBOUND_WEBHOOK_SECRET);
  const providedSignature = signatureHeader(req);
  const providedSecret = firstPresent(
    queryParam(req, 'secret'),
    readHeader(req, 'x-rel8tion-webhook-secret')
  );

  if (webhookSecret && safeEqual(providedSecret, webhookSecret)) {
    return { ok: true, method: 'secret' };
  }

  if (providedSignature) {
    if (!signingKey) return { ok: false, error: 'Webhook signature was sent but no signing key is configured.' };
    if (!validSignature(rawBody, providedSignature, signingKey)) {
      return { ok: false, error: 'Invalid webhook signature.' };
    }
    return { ok: true, method: 'signature' };
  }

  if (webhookSecret) {
    return { ok: false, error: 'Invalid webhook secret.' };
  }

  return { ok: true, method: signingKey ? 'unsigned-testing' : 'unsigned' };
}

async function findRecentOutreachRow(fromPhone) {
  const digits = phoneDigits(fromPhone);
  if (!digits) return null;
  const exactRows = await supabaseRest(
    `agent_outreach_queue?agent_phone_normalized=eq.${encodeURIComponent(digits)}&select=id,open_house_id,agent_name,agent_phone,agent_phone_normalized,address,send_mode,review_status&order=last_outreach_at.desc.nullslast,updated_at.desc&limit=1`
  ).catch(() => []);
  if (Array.isArray(exactRows) && exactRows[0]) return exactRows[0];

  // Older generated rows may have a formatted phone but no normalized value.
  const recentRows = await supabaseRest(
    'agent_outreach_queue?select=id,open_house_id,agent_name,agent_phone,agent_phone_normalized,address,send_mode,review_status&order=last_outreach_at.desc.nullslast,updated_at.desc,created_at.desc&limit=1000'
  ).catch(() => []);
  return (Array.isArray(recentRows) ? recentRows : [])
    .find((row) => phoneDigits(row.agent_phone_normalized || row.agent_phone) === digits) || null;
}

async function insertSuppression(phone, payload) {
  const existing = await supabaseRest(
    `sms_suppression_list?phone=eq.${encodeURIComponent(phone)}&provider=eq.android_gateway&select=id&limit=1`
  ).catch(() => []);
  const body = {
    phone,
    reason: 'STOP keyword',
    provider: 'android_gateway',
    source: 'android-inbound-webhook',
    raw_payload: payload
  };
  if (Array.isArray(existing) && existing[0]?.id) {
    await supabaseRest(`sms_suppression_list?id=eq.${encodeURIComponent(existing[0].id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(body)
    });
    return;
  }
  await supabaseRest('sms_suppression_list', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(body)
  });
}

async function insertOutreachReply({ queueRow, fromPhone, toPhone, body, externalId, payload, stop, receivedAt }) {
  if (externalId && await outreachReplyExists(externalId)) return;

  const replyPayload = {
    queue_row_id: queueRow?.id || null,
    open_house_id: queueRow?.open_house_id || null,
    from_phone: fromPhone,
    from_phone_normalized: phoneDigits(fromPhone),
    to_phone: toPhone || null,
    body,
    message_sid: externalId,
    account_sid: 'android_gateway',
    direction: 'inbound',
    opt_out: stop,
    raw_payload: payload,
    received_at: receivedAt || new Date().toISOString()
  };

  await supabaseRest('agent_outreach_replies', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(replyPayload)
  }).catch((error) => {
    if (!/duplicate|unique/i.test(error.message || '')) throw error;
  });
}

async function outreachReplyExists(externalId) {
  if (!externalId) return false;
  const existing = await supabaseRest(
    `agent_outreach_replies?message_sid=eq.${encodeURIComponent(externalId)}&select=id&limit=1`
  ).catch(() => []);
  return Boolean(Array.isArray(existing) && existing[0]?.id);
}

async function updateOutreachQueue(queueRow, stop) {
  if (!queueRow?.id) return;
  const nextReviewStatus = stop
    ? 'android_opted_out'
    : PRESERVED_REVIEW_STATUSES.has(queueRow.review_status)
      ? queueRow.review_status
      : 'replied';
  await supabaseRest(`agent_outreach_queue?id=eq.${encodeURIComponent(queueRow.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      approved_for_send: false,
      review_status: nextReviewStatus,
      send_mode: queueRow.send_mode,
      followup_block_reason: stop ? 'android_opted_out' : null,
      followup_send_status: stop ? queueRow.followup_send_status : 'blocked_replied',
      updated_at: new Date().toISOString()
    })
  });
}

async function markPhoneAndroidOptedOut(fromPhone) {
  const digits = phoneDigits(fromPhone);
  if (!digits) return;

  let rows = await supabaseRest(
    `agent_outreach_queue?agent_phone_normalized=eq.${encodeURIComponent(digits)}&select=id,initial_send_status,followup_send_status,send_mode&limit=1000`
  ).catch(() => []);

  if (!Array.isArray(rows) || rows.length === 0) {
    const recentRows = await supabaseRest(
      'agent_outreach_queue?select=id,agent_phone,agent_phone_normalized,initial_send_status,followup_send_status,send_mode&order=last_outreach_at.desc.nullslast,updated_at.desc,created_at.desc&limit=1000'
    ).catch(() => []);
    rows = (Array.isArray(recentRows) ? recentRows : [])
      .filter((row) => phoneDigits(row.agent_phone_normalized || row.agent_phone) === digits);
  }

  if (!Array.isArray(rows) || rows.length === 0) return;

  const updatedAt = new Date().toISOString();
  await Promise.all(rows.map((row) => {
    const patch = {
      review_status: 'android_opted_out',
      followup_block_reason: 'android_opted_out',
      updated_at: updatedAt
    };

    return supabaseRest(`agent_outreach_queue?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch)
    });
  }));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  const rawBody = await readRawBody(req);
  const auth = authorizeWebhook(req, rawBody);
  if (!auth.ok) {
    sendJson(res, 401, { ok: false, error: auth.error });
    return;
  }

  try {
    const payload = parsePayload(rawBody, req);
    const nested = payload.payload && typeof payload.payload === 'object' ? payload.payload : {};
    const event = firstPresent(payload.event, nested.event);
    const fromRaw = firstPresent(
      payload.from,
      payload.phone,
      payload.phoneNumber,
      payload.sender,
      nested.from,
      nested.phone,
      nested.phoneNumber,
      nested.sender
    );
    const body = firstPresent(payload.message, payload.body, payload.text, nested.message, nested.body, nested.text);
    const deviceId = firstPresent(payload.deviceId, payload.device_id, nested.deviceId, nested.device_id);
    const toPhone = firstPresent(payload.to, payload.recipient, payload.phoneTo, nested.to, nested.recipient, nested.phoneTo);
    const receivedAtRaw = firstPresent(
      payload.receivedAt,
      payload.timestamp,
      payload.createdAt,
      nested.receivedAt,
      nested.timestamp,
      nested.createdAt
    ) || new Date().toISOString();
    const receivedAt = safeIsoTimestamp(receivedAtRaw);
    const fromPhone = toE164(fromRaw);
    const stop = isStop(body);
    const externalId = firstPresent(
      nested.messageId,
      nested.message_id,
      payload.messageId,
      payload.message_id,
      nested.uuid,
      nested.requestId,
      nested.id,
      payload.id,
      payload.uuid,
      payload.requestId,
      `android-${deviceId || 'device'}-${fromPhone || 'unknown'}-${receivedAt}`
    );

    if (event && !['sms:received', 'mms:received', 'sms:data-received'].includes(event)) {
      sendJson(res, 200, { ok: true, ignored: true, event });
      return;
    }

    if (!fromPhone || !body) {
      sendJson(res, 400, { ok: false, error: 'Missing inbound phone or message body.' });
      return;
    }

    const duplicateReply = await outreachReplyExists(externalId);

    if (!duplicateReply) {
      await supabaseRest('sms_inbound_messages', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          provider: 'android_gateway',
          device_id: deviceId || null,
          from_phone: fromPhone,
          body,
          raw_payload: payload,
          is_stop: stop,
          created_at: receivedAt
        })
      });
    }

    if (stop) await insertSuppression(fromPhone, payload);

    const queueRow = await findRecentOutreachRow(fromPhone);
    await insertOutreachReply({ queueRow, fromPhone, toPhone: toE164(toPhone), body, externalId, payload, stop, receivedAt });
    if (stop) {
      await markPhoneAndroidOptedOut(fromPhone);
    } else {
      await updateOutreachQueue(queueRow, stop);
    }

    sendJson(res, 200, {
      ok: true,
      provider: 'android_gateway',
      auth: auth.method,
      from_phone: fromPhone,
      is_stop: stop,
      queue_row_id: queueRow?.id || null
    });
  } catch (error) {
    console.error('[android-inbound] failed', error);
    sendJson(res, 500, {
      ok: false,
      error: error.message || 'Unable to process Android SMS inbound webhook.'
    });
  }
};
