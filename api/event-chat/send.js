const {
  assertMethod,
  enc,
  one,
  readJsonBody,
  send,
  supabaseRest
} = require('../../lib/field-demo-shared');
const { randomBytes } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d+]/g, '').trim();
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function safeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buyerAccessToken() {
  return randomBytes(18).toString('base64url');
}

function appOrigin(req) {
  const forwardedHost = req.headers?.['x-forwarded-host'];
  const forwardedProto = req.headers?.['x-forwarded-proto'];
  const host = Array.isArray(forwardedHost) ? forwardedHost[0] : (forwardedHost || req.headers?.host || 'app.rel8tion.me');
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : (forwardedProto || 'https');
  return `${proto}://${host}`;
}

function chatUrl(req, conversationId, token) {
  return `${appOrigin(req).replace(/\/$/, '')}/event-chat?cid=${encodeURIComponent(conversationId)}&token=${encodeURIComponent(token)}`;
}

async function sendDirectSms({ to, buyerName, category, message, metadata }) {
  if (!to || !message || !SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/send-lead-sms`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      agent_phone: to,
      buyer_phone: to,
      buyer_name: buyerName || 'Buyer',
      category,
      message,
      metadata
    })
  });
  const raw = await response.text().catch(() => '');
  if (!response.ok) throw new Error(raw || `SMS notification failed: ${response.status}`);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return { raw };
  }
}

async function ensureBuyerChatToken(conversation) {
  const metadata = safeMetadata(conversation?.metadata);
  if (metadata.buyer_access_token) {
    return { conversation, token: metadata.buyer_access_token };
  }

  const token = buyerAccessToken();
  const nextMetadata = {
    ...metadata,
    buyer_access_token: token,
    buyer_access_created_at: new Date().toISOString()
  };
  const updated = one(await supabaseRest(`event_conversations?id=eq.${enc(conversation.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ metadata: nextMetadata })
  })) || { ...conversation, metadata: nextMetadata };

  return { conversation: updated, token };
}

function tokenMatches(conversation, token) {
  return Boolean(clean(token) && clean(token) === clean(safeMetadata(conversation?.metadata).buyer_access_token));
}

async function authenticatedLoanOfficer(req, input) {
  const bearer = clean(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  if (!bearer) return null;
  const url = clean(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  const response = await fetch(`${url}/auth/v1/user`, { headers:{ apikey:key, Authorization:`Bearer ${bearer}` } });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  if (!user?.email) return null;
  const filter = input.sender_uid
    ? `uid=eq.${enc(input.sender_uid)}`
    : `slug=eq.${enc(input.sender_slug || input.loan_officer_slug)}`;
  const profile = one(await supabaseRest(`verified_profiles?${filter}&is_active=eq.true&select=uid,slug,email&limit=1`).catch(() => []));
  return profile && clean(profile.email).toLowerCase() === clean(user.email).toLowerCase() ? profile : null;
}

async function findConversation(input) {
  if (input.conversation_id) {
    return one(await supabaseRest(`event_conversations?id=eq.${enc(input.conversation_id)}&select=*&limit=1`).catch(() => []));
  }
  if (input.buyer_checkin_id) {
    const byCheckin = one(await supabaseRest(
      `event_conversations?buyer_checkin_id=eq.${enc(input.buyer_checkin_id)}&status=neq.closed&select=*&order=updated_at.desc&limit=1`
    ).catch(() => []));
    if (byCheckin) return byCheckin;
  }
  if (input.open_house_event_id && input.buyer_phone) {
    return one(await supabaseRest(
      `event_conversations?open_house_event_id=eq.${enc(input.open_house_event_id)}&buyer_phone=eq.${enc(input.buyer_phone)}&status=neq.closed&select=*&order=updated_at.desc&limit=1`
    ).catch(() => []));
  }
  return null;
}

async function createConversation(input) {
  const payload = {
    open_house_event_id: input.open_house_event_id,
    field_demo_visit_id: input.field_demo_visit_id || null,
    buyer_checkin_id: input.buyer_checkin_id || null,
    buyer_name: input.buyer_name || null,
    buyer_phone: input.buyer_phone || null,
    agent_slug: input.agent_slug || null,
    agent_name: input.agent_name || null,
    agent_phone: input.agent_phone || null,
    loan_officer_slug: input.loan_officer_slug || null,
    loan_officer_name: input.loan_officer_name || null,
    loan_officer_phone: input.loan_officer_phone || null,
    status: 'open',
    source: input.source || 'event_checkin',
    metadata: {
      ...safeMetadata(input.metadata),
      buyer_access_token: buyerAccessToken(),
      buyer_access_created_at: new Date().toISOString()
    }
  };
  return one(await supabaseRest('event_conversations', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  }));
}

module.exports = async function handler(req, res) {
  try {
    if (!assertMethod(req, res)) return;

    const body = await readJsonBody(req);
    const input = {
      ...body,
      open_house_event_id: body.open_house_event_id || body.event_id || '',
      buyer_checkin_id: body.buyer_checkin_id || body.checkin_id || '',
      buyer_name: clean(body.buyer_name || body.visitor_name || ''),
      buyer_phone: normalizePhone(body.buyer_phone || body.visitor_phone || ''),
      agent_slug: clean(body.agent_slug || ''),
      agent_name: clean(body.agent_name || ''),
      agent_phone: normalizePhone(body.agent_phone || ''),
      loan_officer_slug: clean(body.loan_officer_slug || ''),
      loan_officer_name: clean(body.loan_officer_name || ''),
      loan_officer_phone: normalizePhone(body.loan_officer_phone || ''),
      body: clean(body.body || body.message || ''),
      access_token: clean(body.access_token || body.token || '')
    };
    const senderRole = clean(body.sender_role || 'system') || 'system';

    if (senderRole === 'loan_officer' && !(await authenticatedLoanOfficer(req, input))) {
      throw httpError(401, 'Loan officer sign-in is required to send this message.');
    }

    if (!input.open_house_event_id && !body.conversation_id) throw new Error('Missing open house event id.');
    if (!input.body) throw new Error('Message body is required.');

    let conversation = await findConversation(input);
    if (!conversation) {
      if (!input.open_house_event_id) throw new Error('Missing open house event id for new conversation.');
      conversation = await createConversation(input);
    }
    if (!conversation?.id) throw new Error('Conversation could not be created.');

    if (senderRole === 'buyer' && !tokenMatches(conversation, input.access_token)) {
      throw httpError(403, 'This chat link is no longer valid. Ask event support to send a fresh link.');
    }

    let buyerToken = safeMetadata(conversation.metadata).buyer_access_token || '';
    if (['loan_officer', 'field_specialist'].includes(senderRole) && (conversation.buyer_phone || input.buyer_phone)) {
      const tokenResult = await ensureBuyerChatToken(conversation);
      conversation = tokenResult.conversation;
      buyerToken = tokenResult.token;
    }

    const now = new Date().toISOString();
    const message = one(await supabaseRest('event_conversation_messages', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        conversation_id: conversation.id,
        open_house_event_id: conversation.open_house_event_id || input.open_house_event_id,
        sender_role: senderRole,
        sender_name: clean(body.sender_name || ''),
        sender_phone: normalizePhone(body.sender_phone || ''),
        sender_uid: clean(body.sender_uid || ''),
        sender_slug: clean(body.sender_slug || ''),
        body: input.body,
        delivery_channel: clean(body.delivery_channel || 'in_app'),
        metadata: body.message_metadata || {}
      })
    }));

    const extraConversationMetadata = safeMetadata(body.metadata);
    const conversationPatch = {
      updated_at: now,
      buyer_name: input.buyer_name || conversation.buyer_name,
      buyer_phone: input.buyer_phone || conversation.buyer_phone,
      loan_officer_slug: input.loan_officer_slug || conversation.loan_officer_slug,
      loan_officer_name: input.loan_officer_name || conversation.loan_officer_name,
      loan_officer_phone: input.loan_officer_phone || conversation.loan_officer_phone,
      agent_slug: input.agent_slug || conversation.agent_slug,
      agent_name: input.agent_name || conversation.agent_name,
      agent_phone: input.agent_phone || conversation.agent_phone
    };
    if (Object.keys(extraConversationMetadata).length) {
      conversationPatch.metadata = {
        ...safeMetadata(conversation.metadata),
        ...extraConversationMetadata
      };
    }

    conversation = one(await supabaseRest(`event_conversations?id=eq.${enc(conversation.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(conversationPatch)
    })) || conversation;

    let notification = null;
    if (['loan_officer', 'field_specialist'].includes(senderRole) && (conversation.buyer_phone || input.buyer_phone)) {
      const link = chatUrl(req, conversation.id, buyerToken);
      notification = await sendDirectSms({
        to: conversation.buyer_phone || input.buyer_phone,
        buyerName: conversation.buyer_name || input.buyer_name || 'Buyer',
        category: 'event_chat_buyer_alert',
        message: [
          `${message.sender_name || conversation.loan_officer_name || 'Rel8tion event support'} sent you a Rel8tion event message.`,
          input.body.length > 220 ? `${input.body.slice(0, 217)}...` : input.body,
          `Open chat: ${link}`,
          'Reply STOP to opt out.'
        ].filter(Boolean).join('\n'),
        metadata: {
          mode: 'event_chat_buyer_alert',
          conversation_id: conversation.id,
          open_house_event_id: conversation.open_house_event_id || input.open_house_event_id
        }
      }).catch((error) => ({ warning: error.message || String(error) }));
    } else if (senderRole === 'buyer' && conversation.loan_officer_phone) {
      notification = await sendDirectSms({
        to: conversation.loan_officer_phone,
        buyerName: conversation.buyer_name || input.buyer_name || 'Buyer',
        category: 'event_chat_loan_officer_alert',
        message: [
          `${conversation.buyer_name || input.buyer_name || 'A buyer'} replied in Rel8tion event chat.`,
          input.body.length > 220 ? `${input.body.slice(0, 217)}...` : input.body,
          conversation.buyer_phone ? `Buyer phone: ${conversation.buyer_phone}` : ''
        ].filter(Boolean).join('\n'),
        metadata: {
          mode: 'event_chat_loan_officer_alert',
          conversation_id: conversation.id,
          open_house_event_id: conversation.open_house_event_id || input.open_house_event_id
        }
      }).catch((error) => ({ warning: error.message || String(error) }));
    }

    send(res, 200, {
      ok: true,
      conversation,
      message,
      buyer_chat_url: buyerToken ? chatUrl(req, conversation.id, buyerToken) : null,
      notification
    });
  } catch (error) {
    console.error('[event-chat/send] failed', error);
    send(res, error.status || 500, { ok: false, error: error.message || 'Failed to send event chat message.' });
  }
};
