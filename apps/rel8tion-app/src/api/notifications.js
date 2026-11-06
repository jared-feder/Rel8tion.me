import { KEY, SUPABASE_URL } from '../core/config.js';
import { debug, jsonHeaders } from '../core/utils.js';

const JARED_FINANCING_ALERT_PHONE = '13477758059';

// Provider acceptance is not proof of handset delivery. Keep failures visible to
// the check-in caller without throwing after its database write has succeeded.
async function smsAcceptance(response, fallbackError) {
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch (_) {
    throw new Error(fallbackError);
  }
  const results = Array.isArray(payload?.results) ? payload.results : [payload?.sms];
  if (!response.ok || payload?.error || payload?.success !== true || !results.length ||
      results.some((result) => !result || result.ok !== true || ['failed', 'blocked', 'undelivered', 'canceled', 'cancelled', 'rejected'].includes(String(result.status || '').trim().toLowerCase()))) {
    throw new Error(payload?.error || fallbackError);
  }
  return { ok: true, status: 'accepted' };
}

function smsFailure(error) {
  return { ok: false, status: 'failed', error: error?.message || String(error) };
}

function smsSkipped() {
  return { ok: false, status: 'skipped', error: 'Missing SMS recipient phone.' };
}

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
  if (!buyerPhone && !agentPhone) return smsSkipped();

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

    return await smsAcceptance(response, 'Financing lead SMS failed');
  } catch (e) {
    debug('FINANCING LEAD SMS FAILED', { message: e?.message || String(e) });
    return smsFailure(e);
  }
}

export async function sendAgentCheckinSMS({
  agentPhone,
  buyerName,
  buyerPhone,
  buyerEmail,
  propertyAddress,
  preapproved,
  buyerAgentName,
  buyerAgentPhone
}) {
  if (!agentPhone) return smsSkipped();

  const message = [
    `New Rel8tion check-in${propertyAddress ? ` at ${propertyAddress}` : ''}.`,
    buyerName ? `Buyer: ${buyerName}` : '',
    buyerPhone ? `Phone: ${buyerPhone}` : '',
    buyerEmail ? `Email: ${buyerEmail}` : '',
    preapproved === true ? 'Pre-approved: Yes' : (preapproved === false ? 'Pre-approved: No' : 'Pre-approved: Not shared'),
    buyerAgentName ? `Buyer agent: ${buyerAgentName}` : '',
    buyerAgentPhone ? `Buyer agent phone: ${buyerAgentPhone}` : ''
  ].filter(Boolean).join('\n');

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-lead-sms`, {
      method: 'POST',
      headers: jsonHeaders(KEY),
      body: JSON.stringify({
        agent_phone: agentPhone,
        buyer_phone: buyerPhone || agentPhone,
        buyer_name: buyerName || 'Buyer',
        message
      })
    });

    return await smsAcceptance(response, 'Agent check-in SMS failed');
  } catch (e) {
    debug('AGENT CHECKIN SMS FAILED', { message: e?.message || String(e) });
    return smsFailure(e);
  }
}

export async function sendJaredFinancingAlert({
  buyerPhone,
  buyerName,
  address,
  price,
  preapproved = 'no'
}) {
  return sendFinancingLeadAlert({
    agentPhone: JARED_FINANCING_ALERT_PHONE,
    buyerPhone,
    buyerName,
    address,
    price,
    preapproved
  });
}

export async function sendLiveLoanOfficerFinancingAlert({
  loanOfficer,
  agentName,
  buyerPhone,
  buyerName,
  buyerEmail,
  address,
  price,
  preapproved = 'no'
}) {
  const loanOfficerPhone = loanOfficer?.loan_officer_phone || loanOfficer?.phone || '';
  if (!loanOfficerPhone) return smsSkipped();

  const message = [
    `Live Rel8tion financing request${address ? ` at ${address}` : ''}.`,
    agentName ? `Host: ${agentName}` : '',
    buyerName ? `Buyer: ${buyerName}` : 'Buyer: Open house visitor',
    buyerPhone ? `Buyer phone: ${buyerPhone}` : '',
    buyerEmail ? `Buyer email: ${buyerEmail}` : '',
    price ? `Property price: ${price}` : '',
    preapproved === 'yes' ? 'Pre-approved: Yes' : 'Pre-approved: No',
    'Please call or text the buyer now if available.'
  ].filter(Boolean).join('\n');

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-lead-sms`, {
      method: 'POST',
      headers: jsonHeaders(KEY),
      body: JSON.stringify({
        agent_phone: loanOfficerPhone,
        buyer_phone: buyerPhone || loanOfficerPhone,
        buyer_name: buyerName || 'Buyer',
        message
      })
    });

    return await smsAcceptance(response, 'Loan officer financing SMS failed');
  } catch (e) {
    debug('LOAN OFFICER FINANCING SMS FAILED', { message: e?.message || String(e) });
    return smsFailure(e);
  }
}

export async function sendBuyerLoanOfficerIntroSMS({
  buyerPhone,
  buyerName,
  loanOfficer,
  propertyAddress
}) {
  if (!buyerPhone || !loanOfficer?.loan_officer_phone) return smsSkipped();

  const name = loanOfficer.loan_officer_name || 'your financing specialist';
  const company = loanOfficer.loan_officer_company || 'NMB';
  const phone = loanOfficer.loan_officer_phone || '';
  const message = [
    `Thanks${buyerName ? ` ${buyerName}` : ''}. Financing support is live for this open house.`,
    propertyAddress ? `Property: ${propertyAddress}` : '',
    `${name} from ${company} can help with pre-approval questions now.`,
    phone ? `Call/Text: ${phone}` : ''
  ].filter(Boolean).join('\n');

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-lead-sms`, {
      method: 'POST',
      headers: jsonHeaders(KEY),
      body: JSON.stringify({
        agent_phone: buyerPhone,
        buyer_phone: buyerPhone,
        buyer_name: buyerName || 'Buyer',
        message
      })
    });

    return await smsAcceptance(response, 'Buyer loan officer intro SMS failed');
  } catch (e) {
    debug('BUYER LOAN OFFICER INTRO SMS FAILED', { message: e?.message || String(e) });
    return smsFailure(e);
  }
}

export async function sendBuyerConfirmationSMS({
  buyerPhone,
  buyerName,
  agentName,
  agentBrokerage,
  agentPhone,
  propertyAddress,
  listingUrl,
  listingLabel = 'Property page'
}) {
  if (!buyerPhone) return smsSkipped();

  const message = [
    `Thanks${buyerName ? ` ${buyerName}` : ''}, your open house request was received.`,
    propertyAddress ? `Property: ${propertyAddress}` : '',
    listingUrl ? `${listingLabel}: ${listingUrl}` : '',
    agentName ? `Hosted by: ${agentName}` : '',
    agentBrokerage ? `Brokerage: ${agentBrokerage}` : '',
    agentPhone ? `Agent phone: ${agentPhone}` : '',
    'Reply or call the agent directly for next steps.'
  ].filter(Boolean).join('\n');

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-lead-sms`, {
      method: 'POST',
      headers: jsonHeaders(KEY),
      body: JSON.stringify({
        agent_phone: buyerPhone,
        buyer_phone: buyerPhone,
        buyer_name: buyerName || 'Buyer',
        message
      })
    });

    return await smsAcceptance(response, 'Buyer confirmation SMS failed');
  } catch (e) {
    debug('BUYER CONFIRMATION SMS FAILED', { message: e?.message || String(e) });
    return smsFailure(e);
  }
}

