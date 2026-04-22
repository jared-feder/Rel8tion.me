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
        message: `Your Rel8tionChip is live.\n\nhttps://rel8tion.me/a?agent=${slug}`
      })
    });
  } catch (e) {
    debug('SMS SEND FAILED', { message: e?.message || String(e) });
  }
}

export async function sendFinancingLeadAlert({
  agentPhone,
  buyerPhone,
  buyerName,
  address,
  price,
  preapproved = 'no'
}) {
  if (!buyerPhone && !agentPhone) return;

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-lead-sms`, {
      method: 'POST',
      headers: jsonHeaders(KEY),
      body: JSON.stringify({
        agent_phone: agentPhone || buyerPhone || '',
        buyer_phone: buyerPhone || '',
        buyer_name: buyerName || 'Buyer',
        areas: address || 'Open House Visitor',
        price: price || '',
        preapproved
      })
    });

    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      throw new Error(raw || 'Financing lead SMS failed');
    }
  } catch (e) {
    debug('FINANCING LEAD SMS FAILED', { message: e?.message || String(e) });
  }
}
