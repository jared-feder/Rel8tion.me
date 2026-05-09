import { KEY, SUPABASE_URL } from '../core/config.js';
import { debug, jsonHeaders } from '../core/utils.js';

export async function sendActivationSMS(phone, slug, name) {
  if (!phone) return;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-lead-sms`, {
      method: 'POST',
      headers: jsonHeaders(KEY),
      body: JSON.stringify({
        agent_phone: phone,
        buyer_phone: phone,
        buyer_name: name || 'Agent',
        message: `Your Rel8tionChip is live 💯\n\n${location.origin}/a?agent=${slug}`
      })
    });
  } catch (e) {
    debug('SMS SEND FAILED', { message: e?.message || String(e) });
  }
}
