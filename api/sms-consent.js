const { sendJson, supabaseRest } = require('../lib/admin-auth');

const CONSENT_TEXT =
  'By checking this box, I agree to receive event-related SMS messages from Rel8tion about open house activation, buyer check-ins, disclosure confirmations, event support, and event recap notifications. Message frequency may vary. Message and data rates may apply. Reply STOP to opt out. Reply HELP for help. Consent is not a condition of purchase.';

const ALLOWED_ROLES = new Set([
  'Real Estate Agent',
  'Loan Officer',
  'Buyer / Open House Visitor',
  'Broker / Manager',
  'Other'
]);

function clean(value) {
  return String(value || '').trim();
}

function normalizePhone(value) {
  const digits = clean(value).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function readIp(req) {
  const forwarded = clean(req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']);
  if (forwarded) return forwarded.split(',')[0].trim();
  return clean(req.headers['x-real-ip'] || req.socket?.remoteAddress);
}

function validEmail(email) {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

async function findExistingByPhone(phoneNormalized) {
  if (!phoneNormalized) return null;
  const rows = await supabaseRest(
    `sms_consent_records?phone_normalized=eq.${encodeURIComponent(phoneNormalized)}&select=id&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    const body = readBody(req);
    const fullName = clean(body.full_name || body.fullName);
    const phone = clean(body.phone);
    const phoneNormalized = normalizePhone(phone);
    const email = clean(body.email).toLowerCase();
    const role = clean(body.role);
    const consent = body.consent === true || body.consent === 'true' || body.consent === 'on';

    if (fullName.length < 2) {
      sendJson(res, 400, { ok: false, error: 'Please enter your full name.' });
      return;
    }

    if (phoneNormalized.length !== 10) {
      sendJson(res, 400, { ok: false, error: 'Please enter a valid 10-digit mobile phone number.' });
      return;
    }

    if (email && !validEmail(email)) {
      sendJson(res, 400, { ok: false, error: 'Please enter a valid email address or leave it blank.' });
      return;
    }

    if (!ALLOWED_ROLES.has(role)) {
      sendJson(res, 400, { ok: false, error: 'Please select your role.' });
      return;
    }

    if (!consent) {
      sendJson(res, 400, { ok: false, error: 'Please check the consent box to opt in.' });
      return;
    }

    const payload = {
      full_name: fullName,
      phone,
      phone_normalized: phoneNormalized,
      email: email || null,
      role,
      consent_status: 'opted_in',
      consent_text: CONSENT_TEXT,
      consent_source: 'sms-consent-page',
      consent_url: 'https://rel8tion.me/sms-consent',
      user_agent: clean(req.headers['user-agent']),
      ip_address: readIp(req) || null
    };

    const existing = await findExistingByPhone(phoneNormalized);

    if (existing?.id) {
      await supabaseRest(`sms_consent_records?id=eq.${encodeURIComponent(existing.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(payload)
      });
      sendJson(res, 200, { ok: true, updated: true });
      return;
    }

    await supabaseRest('sms_consent_records', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(payload)
    });

    sendJson(res, 200, { ok: true, inserted: true });
  } catch (error) {
    console.error('[sms-consent] failed', error);
    const message = /relation .*sms_consent_records/i.test(error.message || '')
      ? 'SMS consent storage is not ready yet. Please try again shortly.'
      : 'We could not save your SMS consent right now. Please try again.';
    sendJson(res, error.status && error.status < 500 ? error.status : 500, {
      ok: false,
      error: message
    });
  }
};
