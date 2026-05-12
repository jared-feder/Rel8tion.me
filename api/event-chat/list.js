const {
  assertMethod,
  enc,
  one,
  readJsonBody,
  send,
  supabaseRest
} = require('../../lib/field-demo-shared');

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

async function loadMessages(conversationIds) {
  const result = {};
  for (const id of conversationIds) {
    result[id] = arrayOrEmpty(await supabaseRest(
      `event_conversation_messages?conversation_id=eq.${enc(id)}&select=*&order=created_at.asc&limit=100`
    ).catch(() => []));
  }
  return result;
}

module.exports = async function handler(req, res) {
  try {
    if (!assertMethod(req, res)) return;

    const body = await readJsonBody(req);
    const eventId = body.open_house_event_id || body.event_id;
    const conversationId = body.conversation_id;
    const checkinId = body.buyer_checkin_id || body.checkin_id;

    if (!eventId && !conversationId && !checkinId) {
      throw new Error('Missing open house event, conversation, or check-in id.');
    }

    let conversations = [];
    if (conversationId) {
      conversations = arrayOrEmpty(await supabaseRest(
        `event_conversations?id=eq.${enc(conversationId)}&select=*&limit=1`
      ).catch(() => []));
    } else if (checkinId) {
      conversations = arrayOrEmpty(await supabaseRest(
        `event_conversations?buyer_checkin_id=eq.${enc(checkinId)}&select=*&order=updated_at.desc&limit=20`
      ).catch(() => []));
    } else {
      conversations = arrayOrEmpty(await supabaseRest(
        `event_conversations?open_house_event_id=eq.${enc(eventId)}&status=neq.closed&select=*&order=updated_at.desc&limit=100`
      ).catch(() => []));
    }

    const messagesByConversation = await loadMessages(conversations.map((row) => row.id).filter(Boolean));
    send(res, 200, { ok: true, conversations, messagesByConversation });
  } catch (error) {
    console.error('[event-chat/list] failed', error);
    send(res, 500, { ok: false, error: error.message || 'Failed to load event chat.' });
  }
};
