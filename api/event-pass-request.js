const { sendJson, supabaseRest } = require('../lib/admin-auth');

const ALLOWED_ORIGINS = new Set([
  'https://rel8tion.me',
  'https://www.rel8tion.me',
  'https://app.rel8tion.me'
]);

const clean = (value, max = 2000) => String(value || '').trim().slice(0, max);
const yes = (value) => ['1', 'true', 'yes', 'on'].includes(clean(value).toLowerCase());
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function normalizePhone(value) {
  const digits = clean(value).replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function bodyOf(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return Object.fromEntries(new URLSearchParams(req.body)); }
}

function cors(req, res) {
  const origin = clean(req.headers.origin, 300);
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });

  try {
    const body = bodyOf(req);
    const agentName = clean(body.agent_name, 160);
    const agentEmail = clean(body.agent_email, 320).toLowerCase();
    const agentPhone = clean(body.agent_phone, 80);
    const agentPhoneNormalized = normalizePhone(agentPhone);
    const hasLoanSpecialist = yes(body.has_current_loan_specialist);
    const wantsTheirCoverage = hasLoanSpecialist && yes(body.wants_current_loan_specialist_coverage);
    const loanOfficer = {
      name: clean(body.loan_officer_name, 160),
      company: clean(body.loan_officer_company, 180),
      phone: clean(body.loan_officer_phone, 80),
      email: clean(body.loan_officer_email, 320).toLowerCase()
    };
    const loanPhoneNormalized = normalizePhone(loanOfficer.phone);

    if (agentName.length < 2) return sendJson(res, 400, { ok: false, error: 'Please enter your name.' });
    if (agentPhoneNormalized.length !== 10) return sendJson(res, 400, { ok: false, error: 'Please enter a valid agent mobile number.' });
    if (!validEmail(agentEmail)) return sendJson(res, 400, { ok: false, error: 'Please enter a valid agent email.' });
    if (wantsTheirCoverage && (loanOfficer.name.length < 2 || loanOfficer.company.length < 2 || loanPhoneNormalized.length !== 10 || !validEmail(loanOfficer.email))) {
      return sendJson(res, 400, { ok: false, error: 'Please complete the loan specialist’s name, company, phone, and email.' });
    }

    const useAgentLoanOfficer = wantsTheirCoverage;
    const payload = {
      agent_name: agentName,
      agent_brokerage: clean(body.agent_brokerage, 180) || null,
      agent_phone: agentPhone,
      agent_phone_normalized: agentPhoneNormalized,
      agent_email: agentEmail,
      open_house_address: clean(body.open_house_address, 300) || null,
      open_house_date: clean(body.open_house_date, 80) || null,
      market: clean(body.market, 180) || null,
      has_current_loan_specialist: hasLoanSpecialist,
      wants_current_loan_specialist_coverage: wantsTheirCoverage,
      loan_officer_name: useAgentLoanOfficer ? loanOfficer.name : null,
      loan_officer_company: useAgentLoanOfficer ? loanOfficer.company : null,
      loan_officer_phone: useAgentLoanOfficer ? loanOfficer.phone : null,
      loan_officer_phone_normalized: useAgentLoanOfficer ? loanPhoneNormalized : null,
      loan_officer_email: useAgentLoanOfficer ? loanOfficer.email : null,
      sponsorship_route: useAgentLoanOfficer ? 'agent_loan_officer' : 'nmb_default',
      status: 'new',
      source: clean(body.source, 100) || 'wordpress-home',
      source_url: clean(body.source_url, 500) || null,
      notes: clean(body.notes, 1500) || null,
      user_agent: clean(req.headers['user-agent'], 500) || null,
      ip_address: clean(req.headers['x-forwarded-for'] || req.socket?.remoteAddress, 100).split(',')[0] || null,
      metadata: { submitted_at: new Date().toISOString() }
    };

    const rows = await supabaseRest('event_pass_requests?select=id,created_at,sponsorship_route', {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload)
    });
    const request = Array.isArray(rows) ? rows[0] : null;
    return sendJson(res, 200, { ok: true, request });
  } catch (error) {
    console.error('[event-pass-request] failed', error);
    return sendJson(res, 500, { ok: false, error: 'We could not save the Event Pass request. Please try again.' });
  }
};
