const {
  assertMethod,
  enc,
  one,
  readJsonBody,
  send,
  supabaseRest
} = require('../../lib/field-demo-shared');

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d+]/g, '').trim();
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
    metadata: input.metadata || {}
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
      body: clean(body.body || body.message || '')
    };

    if (!input.open_house_event_id && !body.conversation_id) throw new Error('Missing open house event id.');
    if (!input.body) throw new Error('Message body is required.');

    let conversation = await findConversation(input);
    if (!conversation) {
      if (!input.open_house_event_id) throw new Error('Missing open house event id for new conversation.');
      conversation = await createConversation(input);
    }
    if (!conversation?.id) throw new Error('Conversation could not be created.');

    const now = new Date().toISOString();
    const message = one(await supabaseRest('event_conversation_messages', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        conversation_id: conversation.id,
        open_house_event_id: conversation.open_house_event_id || input.open_house_event_id,
        sender_role: clean(body.sender_role || 'system'),
        sender_name: clean(body.sender_name || ''),
        sender_phone: normalizePhone(body.sender_phone || ''),
        sender_uid: clean(body.sender_uid || ''),
        sender_slug: clean(body.sender_slug || ''),
        body: input.body,
        delivery_channel: clean(body.delivery_channel || 'in_app'),
        metadata: body.message_metadata || {}
      })
    }));

    conversation = one(await supabaseRest(`event_conversations?id=eq.${enc(conversation.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        updated_at: now,
        loan_officer_slug: input.loan_officer_slug || conversation.loan_officer_slug,
        loan_officer_name: input.loan_officer_name || conversation.loan_officer_name,
        loan_officer_phone: input.loan_officer_phone || conversation.loan_officer_phone,
        agent_slug: input.agent_slug || conversation.agent_slug,
        agent_name: input.agent_name || conversation.agent_name,
        agent_phone: input.agent_phone || conversation.agent_phone
      })
    })) || conversation;

    send(res, 200, { ok: true, conversation, message });
  } catch (error) {
    console.error('[event-chat/send] failed', error);
    send(res, 500, { ok: false, error: error.message || 'Failed to send event chat message.' });
  }
};
