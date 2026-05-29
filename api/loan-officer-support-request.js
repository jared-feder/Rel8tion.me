const { sendJson, supabaseRest } = require('../lib/admin-auth');

const ALLOWED_ORIGINS = new Set([
  'https://app.rel8tion.me',
  'https://rel8tion.me',
  'https://www.rel8tion.me',
  'https://getrel8tion.com',
  'https://www.getrel8tion.com',
  'https://rel8tion-me.vercel.app'
]);

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}

function normalizePhone(value) {
  const digits = clean(value).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function validEmail(email) {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function readIp(req) {
  const forwarded = clean(req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']);
  if (forwarded) return forwarded.split(',')[0].trim();
  return clean(req.headers['x-real-ip'] || req.socket?.remoteAddress);
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  const contentType = clean(req.headers['content-type']).toLowerCase();
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(req.body));
  }
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function applyCors(req, res) {
  const origin = clean(req.headers.origin);
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    const body = readBody(req);
    const fullName = clean(body.full_name || body.fullName, 160);
    const companyName = clean(body.company_name || body.companyName, 180);
    const email = clean(body.email, 320).toLowerCase();
    const phone = clean(body.phone, 80);
    const phoneNormalized = normalizePhone(phone);
    const experience = clean(body.experience, 4000);
    const coverageAreas = clean(body.coverage_areas || body.coverageAreas, 1000);
    const availability = clean(body.availability, 1000);
    const notes = clean(body.notes, 1500);

    if (fullName.length < 2) {
      sendJson(res, 400, { ok: false, error: 'Please enter your name.' });
      return;
    }

    if (companyName.length < 2) {
      sendJson(res, 400, { ok: false, error: 'Please enter your company name.' });
      return;
    }

    if (phoneNormalized.length !== 10) {
      sendJson(res, 400, { ok: false, error: 'Please enter a valid 10-digit mobile phone number.' });
      return;
    }

    if (!email || !validEmail(email)) {
      sendJson(res, 400, { ok: false, error: 'Please enter a valid email address.' });
      return;
    }

    if (experience.length < 10) {
      sendJson(res, 400, { ok: false, error: 'Please add a short note about your experience.' });
      return;
    }

    const payload = {
      full_name: fullName,
      company_name: companyName,
      email,
      phone,
      phone_normalized: phoneNormalized,
      experience,
      coverage_areas: coverageAreas || null,
      availability: availability || null,
      notes: notes || null,
      status: 'new',
      source: 'loan-officer-support-page',
      source_url: 'https://app.rel8tion.me/loan-officer-support',
      user_agent: clean(req.headers['user-agent'], 500) || null,
      ip_address: readIp(req) || null,
      metadata: {
        path: clean(body.source_path, 300) || null,
        host: clean(body.source_host, 200) || null,
        submitted_at: new Date().toISOString()
      }
    };

    const rows = await supabaseRest('loan_officer_support_requests?select=id,created_at', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    });

    const inserted = Array.isArray(rows) ? rows[0] : null;
    sendJson(res, 200, {
      ok: true,
      id: inserted?.id || null,
      created_at: inserted?.created_at || null
    });
  } catch (error) {
    console.error('[loan-officer-support-request] failed', error);
    const message = /relation .*loan_officer_support_requests/i.test(error.message || '')
      ? 'Loan officer request storage is not ready yet. Please try again shortly.'
      : 'We could not save the request right now. Please try again.';
    sendJson(res, error.status && error.status < 500 ? error.status : 500, {
      ok: false,
      error: message
    });
  }
};
