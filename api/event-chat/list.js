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

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function safeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function tokenMatches(conversation, token) {
  return Boolean(clean(token) && clean(token) === clean(safeMetadata(conversation?.metadata).buyer_access_token));
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
    const viewer = clean(body.viewer || '');
    const accessToken = clean(body.access_token || body.token || '');

    if (!eventId && !conversationId && !checkinId) {
      throw new Error('Missing open house event, conversation, or check-in id.');
    }

    let conversations = [];
    if (conversationId) {
      conversations = arrayOrEmpty(await supabaseRest(
        `event_conversations?id=eq.${enc(conversationId)}&select=*&limit=1`
      ).catch(() => []));
      if (viewer === 'buyer' && !tokenMatches(conversations[0], accessToken)) {
        const error = new Error('This chat link is no longer valid. Ask event support to send a fresh link.');
        error.status = 403;
        throw error;
      }
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
    send(res, error.status || 500, { ok: false, error: error.message || 'Failed to load event chat.' });
  }
};
