const { sendJson, supabaseRest } = require('../lib/admin-auth');

const DISCLAIMER =
  'This is a property scenario based on loan-officer-entered guidance and assumptions. Rel8tion does not collect financial documents, Social Security numbers, credit data, income records, or loan application information. This is not a loan approval, underwriting decision, Loan Estimate, or commitment to lend. Final approval remains subject to the lender’s review, loan program, property, documentation, and all applicable guidelines.';

const FORBIDDEN_KEYS = [
  'ssn',
  'social_security',
  'socialSecurityNumber',
  'income',
  'paystub',
  'paystubs',
  'bank_statement',
  'bankStatements',
  'assets',
  'employment',
  'employer',
  'debts',
  'liabilities',
  'credit_score',
  'creditScore',
  'credit_report',
  'creditReport',
  'aus',
  'preapproval_letter',
  'preapprovalLetter',
  'borrower_documents'
];

const FORBIDDEN_TEXT_PATTERNS = [
  { label: 'Social Security number', pattern: /\b\d{3}-?\d{2}-?\d{4}\b|\bsocial security\b|\bssn\b/i },
  { label: 'income records', pattern: /\b(paystub|paystubs|payroll|w-?2|1099|income record|income records|salary|salaried)\b/i },
  { label: 'bank or asset documents', pattern: /\b(bank statement|bank statements|asset statement|assets statement|asset statements)\b/i },
  { label: 'employment data', pattern: /\b(employment|employer)\b/i },
  { label: 'debt or liability data', pattern: /\b(debt|debts|liability|liabilities|dti|debt-to-income)\b/i },
  { label: 'credit data', pattern: /\b(credit score|credit report|credit pull|fico|tri-merge)\b/i },
  { label: 'AUS findings', pattern: /\b(aus|du findings|lp findings|desktop underwriter|loan prospector)\b/i },
  { label: 'formal preapproval documents', pattern: /\b(preapproval letter|pre-approval letter|approval letter|commitment letter)\b/i }
];

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

function enc(value) {
  return encodeURIComponent(String(value || '').trim());
}

function clean(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function phoneDigits(phone) {
  const digits = clean(phone).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function cleanEmail(email) {
  return clean(email, 320).toLowerCase();
}

function num(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || '';
}

function containsForbiddenData(value) {
  if (!value || typeof value !== 'object') return null;
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    for (const [key, child] of Object.entries(current)) {
      if (FORBIDDEN_KEYS.some((blocked) => blocked.toLowerCase() === String(key).toLowerCase())) {
        return key;
      }
      if (typeof child === 'string') {
        const textMatch = FORBIDDEN_TEXT_PATTERNS.find((entry) => entry.pattern.test(child));
        if (textMatch) return `${key}: ${textMatch.label}`;
      }
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return null;
}

async function loadOne(path) {
  const rows = await supabaseRest(`${path}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function patchOne(table, id, payload) {
  const rows = await supabaseRest(`${table}?id=eq.${enc(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() })
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function insertOne(table, payload) {
  const rows = await supabaseRest(table, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function ensureBuyer({ full_name, phone, email, source, metadata = {} }) {
  const normalizedPhone = phoneDigits(phone);
  const normalizedEmail = cleanEmail(email);
  let existing = null;

  if (normalizedPhone) {
    existing = await loadOne(`buyers?phone_normalized=eq.${enc(normalizedPhone)}&select=*`);
  }
  if (!existing && normalizedEmail) {
    existing = await loadOne(`buyers?email=eq.${enc(normalizedEmail)}&select=*`);
  }

  const payload = {
    full_name: clean(full_name, 180) || null,
    phone: clean(phone, 40) || null,
    phone_normalized: normalizedPhone || null,
    email: normalizedEmail || null,
    source: clean(source, 80) || null,
    last_seen_at: new Date().toISOString(),
    metadata
  };

  if (existing?.id) {
    return patchOne('buyers', existing.id, {
      full_name: payload.full_name || existing.full_name,
      phone: payload.phone || existing.phone,
      phone_normalized: payload.phone_normalized || existing.phone_normalized,
      email: payload.email || existing.email,
      source: payload.source || existing.source,
      last_seen_at: payload.last_seen_at,
      metadata: { ...(existing.metadata || {}), ...(metadata || {}) }
    });
  }

  try {
    return await insertOne('buyers', payload);
  } catch (error) {
    if (!/duplicate|unique/i.test(error.message || '')) throw error;
    if (normalizedPhone) {
      const byPhone = await loadOne(`buyers?phone_normalized=eq.${enc(normalizedPhone)}&select=*`);
      if (byPhone) return byPhone;
    }
    if (normalizedEmail) {
      const byEmail = await loadOne(`buyers?email=eq.${enc(normalizedEmail)}&select=*`);
      if (byEmail) return byEmail;
    }
    throw error;
  }
}

async function upsertRelationship(table, match, payload) {
  const query = Object.entries(match)
    .map(([key, value]) => `${key}=eq.${enc(value)}`)
    .join('&');
  const existing = await loadOne(`${table}?${query}&select=*`);
  if (existing?.id) {
    return patchOne(table, existing.id, {
      ...payload,
      last_seen_at: new Date().toISOString()
    });
  }
  return insertOne(table, {
    ...match,
    ...payload,
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString()
  });
}

async function loadEvent(eventId) {
  if (!eventId) return null;
  return loadOne(`open_house_events?id=eq.${enc(eventId)}&select=*`);
}

async function loadCheckin(checkinId) {
  if (!checkinId) return null;
  return loadOne(`event_checkins?id=eq.${enc(checkinId)}&select=*`);
}

async function loadLead(leadId) {
  if (!leadId) return null;
  return loadOne(`leads?id=eq.${enc(leadId)}&select=*`);
}

async function loadLoanOfficer(uid) {
  if (!uid) return null;
  return loadOne(`verified_profiles?uid=eq.${enc(uid)}&is_active=eq.true&select=*`);
}

function eventAgentSlug(event) {
  return clean(firstPresent(event?.host_agent_slug, event?.agent_slug, event?.setup_context?.agent_slug), 180);
}

async function syncLoanOfficerContext({ event, buyer, agentSlug }) {
  if (!event?.id || !buyer?.id) return null;
  const session = await loadOne(
    `event_loan_officer_sessions?open_house_event_id=eq.${enc(event.id)}&status=eq.live&select=*&order=signed_in_at.desc`
  );
  const loId = session?.verified_profile_uid || session?.loan_officer_uid || '';
  if (!loId) return null;
  await upsertRelationship(
    'buyer_loan_officer_relationships',
    { buyer_id: buyer.id, loan_officer_profile_id: loId },
    { source: 'event_loan_officer_session', status: 'active', metadata: { event_id: event.id } }
  ).catch(() => null);
  if (agentSlug) {
    await upsertRelationship(
      'agent_loan_officer_relationships',
      { agent_slug: agentSlug, loan_officer_profile_id: loId },
      { source: 'event_loan_officer_session', status: 'active', metadata: { event_id: event.id } }
    ).catch(() => null);
  }
  return session;
}

async function syncCheckinBuyer(checkinId) {
  const checkin = await loadCheckin(checkinId);
  if (!checkin?.id) {
    const error = new Error('Check-in not found.');
    error.status = 404;
    throw error;
  }
  const event = await loadEvent(checkin.open_house_event_id);
  const agentSlug = eventAgentSlug(event);
  const buyer = await ensureBuyer({
    full_name: checkin.visitor_name,
    phone: checkin.visitor_phone,
    email: checkin.visitor_email,
    source: 'event_checkin',
    metadata: { checkin_id: checkin.id, event_id: checkin.open_house_event_id }
  });

  if (buyer?.id && checkin.buyer_id !== buyer.id) {
    await supabaseRest(`event_checkins?id=eq.${enc(checkin.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ buyer_id: buyer.id })
    });
  }
  if (buyer?.id && agentSlug) {
    await upsertRelationship(
      'buyer_agent_relationships',
      { buyer_id: buyer.id, agent_slug: agentSlug },
      { source: 'event_checkin', status: 'active', metadata: { checkin_id: checkin.id, event_id: checkin.open_house_event_id } }
    ).catch(() => null);
  }
  const loanOfficerSession = await syncLoanOfficerContext({ event, buyer, agentSlug });
  return { buyer, checkin: { ...checkin, buyer_id: buyer?.id || checkin.buyer_id }, event, agent_slug: agentSlug, loan_officer_session: loanOfficerSession };
}

async function syncLeadBuyer(leadId) {
  const lead = await loadLead(leadId);
  if (!lead?.id) {
    const error = new Error('Lead not found.');
    error.status = 404;
    throw error;
  }
  const buyer = await ensureBuyer({
    full_name: lead.name,
    phone: lead.phone,
    email: lead.email,
    source: 'lead',
    metadata: { lead_id: lead.id, agent_slug: lead.agent_slug || lead.agent || null }
  });
  if (buyer?.id && lead.buyer_id !== buyer.id) {
    await supabaseRest(`leads?id=eq.${enc(lead.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ buyer_id: buyer.id })
    });
  }
  const agentSlug = clean(lead.agent_slug || lead.agent, 180);
  if (buyer?.id && agentSlug) {
    await upsertRelationship(
      'buyer_agent_relationships',
      { buyer_id: buyer.id, agent_slug: agentSlug },
      { source: 'lead', status: 'active', metadata: { lead_id: lead.id } }
    ).catch(() => null);
  }
  return { buyer, lead: { ...lead, buyer_id: buyer?.id || lead.buyer_id }, agent_slug: agentSlug };
}

async function loadActiveGuidance(buyerId, agentSlug) {
  if (!buyerId || !agentSlug) return null;
  return loadOne(
    `buyer_affordability_guidance?buyer_id=eq.${enc(buyerId)}&agent_slug=eq.${enc(agentSlug)}&status=eq.active&select=*&order=updated_at.desc`
  );
}

function monthlyPrincipalInterest(loanAmount, ratePercent, termYears) {
  const principal = Number(loanAmount || 0);
  const termMonths = Number(termYears || 0) * 12;
  const monthlyRate = Number(ratePercent || 0) / 100 / 12;
  if (!principal || !termMonths) return null;
  if (!monthlyRate) return principal / termMonths;
  const factor = Math.pow(1 + monthlyRate, termMonths);
  return principal * ((monthlyRate * factor) / (factor - 1));
}

function fitResult({ netPayment, guidance, loanAmount, purchasePrice }) {
  const cap = num(guidance.max_monthly_housing_payment, null);
  const maxPurchase = num(guidance.max_purchase_price_guidance, null);
  const maxLoan = num(guidance.max_loan_amount_guidance, null);
  if (!cap || netPayment === null || netPayment === undefined) {
    return { status: 'lo_review_required', label: 'LO Review Required' };
  }
  if ((maxPurchase && purchasePrice > maxPurchase) || (maxLoan && loanAmount > maxLoan)) {
    return { status: 'outside_guidance', label: 'Outside Current LO Guidance' };
  }
  if (netPayment <= cap) return { status: 'within_guidance', label: 'Looks Within LO Guidance' };
  if (netPayment <= Math.max(cap * 1.05, cap + 250)) {
    return { status: 'close_review_recommended', label: 'Close — LO Review Recommended' };
  }
  return { status: 'outside_guidance', label: 'Outside Current LO Guidance' };
}

function buildScenario(body, guidance) {
  const purchasePrice = num(body.purchase_price, 0);
  const annualTaxes = Math.max(0, num(body.annual_taxes, 0));
  const annualInsurance = Math.max(0, num(body.annual_insurance, 0));
  const monthlyHoa = Math.max(0, num(body.monthly_hoa, 0));
  const apartmentPresent = bool(body.apartment_present);
  const estimatedRent = Math.max(0, num(body.estimated_monthly_rent, 0));
  const downPaymentPercent = Math.max(0, num(guidance.down_payment_percent, 0));
  const ratePercent = num(guidance.rate_assumption_percent, null);
  const termYears = num(guidance.loan_term_years, null);
  const mortgageInsurance = Math.max(0, num(guidance.mortgage_insurance_monthly, 0));
  const loanAmount = Math.max(0, purchasePrice * (1 - downPaymentPercent / 100));
  const principalInterest = ratePercent !== null && termYears
    ? monthlyPrincipalInterest(loanAmount, ratePercent, termYears)
    : null;
  const rentCredit = guidance.rent_income_allowed && apartmentPresent
    ? estimatedRent * (num(guidance.rent_income_percentage, 0) / 100)
    : 0;
  const gross = principalInterest === null
    ? null
    : principalInterest + annualTaxes / 12 + annualInsurance / 12 + monthlyHoa + mortgageInsurance;
  const netPayment = gross === null ? null : Math.max(0, gross - rentCredit);
  const result = fitResult({ netPayment, guidance, loanAmount, purchasePrice });

  return {
    purchase_price: purchasePrice,
    annual_taxes: annualTaxes,
    annual_insurance: annualInsurance,
    monthly_hoa: monthlyHoa,
    apartment_present: apartmentPresent,
    estimated_monthly_rent: estimatedRent,
    estimated_principal_interest: principalInterest === null ? null : Number(principalInterest.toFixed(2)),
    estimated_gross_monthly_payment: gross === null ? null : Number(gross.toFixed(2)),
    rent_credit_monthly: Number(rentCredit.toFixed(2)),
    estimated_net_monthly_payment: netPayment === null ? null : Number(netPayment.toFixed(2)),
    monthly_cap: num(guidance.max_monthly_housing_payment, null),
    result_status: result.status,
    result_label: result.label,
    assumptions_snapshot: {
      down_payment_percent: guidance.down_payment_percent,
      rate_assumption_percent: guidance.rate_assumption_percent,
      loan_term_years: guidance.loan_term_years,
      mortgage_insurance_monthly: guidance.mortgage_insurance_monthly,
      rent_income_allowed: guidance.rent_income_allowed,
      rent_income_percentage: guidance.rent_income_percentage,
      rent_income_notes: guidance.rent_income_notes,
      max_monthly_housing_payment: guidance.max_monthly_housing_payment,
      max_purchase_price_guidance: guidance.max_purchase_price_guidance,
      max_loan_amount_guidance: guidance.max_loan_amount_guidance,
      disclaimer: DISCLAIMER
    }
  };
}

async function loadEventFitData(query) {
  const eventId = clean(query.event_id || query.event, 80);
  const requestedAgent = clean(query.agent_slug || query.agent, 180);
  const event = await loadEvent(eventId);
  if (!event?.id) {
    const error = new Error('Open house event not found.');
    error.status = 404;
    throw error;
  }
  const agentSlug = eventAgentSlug(event);
  if (requestedAgent && agentSlug && requestedAgent !== agentSlug) {
    const error = new Error('Agent does not match this event.');
    error.status = 403;
    throw error;
  }

  const checkins = await supabaseRest(
    `event_checkins?open_house_event_id=eq.${enc(event.id)}&select=id,buyer_id,visitor_name,visitor_phone,visitor_email&order=created_at.desc&limit=100`
  );
  const buyerIds = [...new Set((Array.isArray(checkins) ? checkins : []).map((row) => row.buyer_id).filter(Boolean))];
  if (!buyerIds.length) return { event, agent_slug: agentSlug, guidance: [], scenarios: [], disclaimer: DISCLAIMER };
  const buyerList = buyerIds.map(enc).join(',');
  const [guidance, scenarios] = await Promise.all([
    supabaseRest(`buyer_affordability_guidance?buyer_id=in.(${buyerList})&agent_slug=eq.${enc(agentSlug)}&status=eq.active&select=*`),
    supabaseRest(`buyer_property_fit_scenarios?buyer_id=in.(${buyerList})&agent_slug=eq.${enc(agentSlug)}&select=*&order=created_at.desc&limit=100`)
  ]);
  return {
    event,
    agent_slug: agentSlug,
    guidance: Array.isArray(guidance) ? guidance : [],
    scenarios: Array.isArray(scenarios) ? scenarios : [],
    disclaimer: DISCLAIMER
  };
}

async function upsertGuidance(body) {
  const loanOfficerUid = clean(body.loan_officer_uid || body.loan_officer_profile_id || body.uid, 80);
  const profile = await loadLoanOfficer(loanOfficerUid);
  if (!profile?.uid) {
    const error = new Error('Active loan officer profile not found.');
    error.status = 403;
    throw error;
  }
  if (!bool(body.lo_attestation_completed_preapproval_outside_rel8tion)) {
    const error = new Error('Loan officer must confirm preapproval work was completed outside Rel8tion.');
    error.status = 400;
    throw error;
  }

  let buyerId = clean(body.buyer_id, 80);
  let checkin = null;
  let event = null;
  if (body.event_id || body.open_house_event_id) {
    event = await loadEvent(body.event_id || body.open_house_event_id);
  }
  if (!buyerId && body.checkin_id) {
    const synced = await syncCheckinBuyer(body.checkin_id);
    buyerId = synced.buyer?.id || '';
    checkin = synced.checkin;
    event = synced.event || event;
  }
  if (!buyerId) {
    const error = new Error('Missing buyer.');
    error.status = 400;
    throw error;
  }

  const agentSlug = clean(body.agent_slug || body.agent || eventAgentSlug(event), 180);
  if (!agentSlug) {
    const error = new Error('Missing agent context.');
    error.status = 400;
    throw error;
  }

  const paymentCap = num(body.max_monthly_housing_payment, null);
  if (!paymentCap || paymentCap <= 0) {
    const error = new Error('Max monthly housing payment guidance is required.');
    error.status = 400;
    throw error;
  }

  const existing = await loadActiveGuidance(buyerId, agentSlug);
  const payload = {
    buyer_id: buyerId,
    agent_slug: agentSlug,
    loan_officer_profile_id: profile.uid,
    source_event_id: clean(body.event_id || body.open_house_event_id || event?.id, 80) || null,
    source_checkin_id: clean(body.checkin_id || checkin?.id, 80) || null,
    max_monthly_housing_payment: paymentCap,
    max_purchase_price_guidance: num(body.max_purchase_price_guidance, null),
    max_loan_amount_guidance: num(body.max_loan_amount_guidance, null),
    down_payment_percent: num(body.down_payment_percent, null),
    rate_assumption_percent: num(body.rate_assumption_percent, null),
    loan_term_years: num(body.loan_term_years, null),
    mortgage_insurance_monthly: num(body.mortgage_insurance_monthly, 0),
    rent_income_allowed: bool(body.rent_income_allowed),
    rent_income_percentage: bool(body.rent_income_allowed) ? num(body.rent_income_percentage, 0) : 0,
    rent_income_notes: clean(body.rent_income_notes, 1000) || null,
    guidance_notes: clean(body.guidance_notes, 1500) || null,
    lo_attestation_completed_preapproval_outside_rel8tion: true,
    lo_attestation_text: DISCLAIMER,
    status: 'active'
  };
  const guidance = existing?.id
    ? await patchOne('buyer_affordability_guidance', existing.id, payload)
    : await insertOne('buyer_affordability_guidance', payload);

  await upsertRelationship(
    'buyer_loan_officer_relationships',
    { buyer_id: buyerId, loan_officer_profile_id: profile.uid },
    { source: 'affordability_guidance', status: 'active', metadata: { guidance_id: guidance?.id || null } }
  ).catch(() => null);
  await upsertRelationship(
    'agent_loan_officer_relationships',
    { agent_slug: agentSlug, loan_officer_profile_id: profile.uid },
    { source: 'affordability_guidance', status: 'active', metadata: { guidance_id: guidance?.id || null } }
  ).catch(() => null);

  return { profile, guidance, disclaimer: DISCLAIMER };
}

async function createScenario(body) {
  let buyerId = clean(body.buyer_id, 80);
  let synced = null;
  if (!buyerId && body.checkin_id) {
    synced = await syncCheckinBuyer(body.checkin_id);
    buyerId = synced.buyer?.id || '';
  }
  const event = synced?.event || await loadEvent(body.event_id || body.open_house_event_id);
  const agentSlug = clean(body.agent_slug || body.agent || eventAgentSlug(event), 180);
  if (!buyerId || !agentSlug) {
    const error = new Error('Missing buyer or agent context.');
    error.status = 400;
    throw error;
  }
  if (event?.id && eventAgentSlug(event) && eventAgentSlug(event) !== agentSlug) {
    const error = new Error('Agent does not match this event.');
    error.status = 403;
    throw error;
  }
  const guidance = await loadActiveGuidance(buyerId, agentSlug);
  if (!guidance?.id) {
    const error = new Error('LO guidance is required before creating a property scenario.');
    error.status = 409;
    throw error;
  }
  const scenarioValues = buildScenario(body, guidance);
  if (!scenarioValues.purchase_price) {
    const error = new Error('Purchase price is required.');
    error.status = 400;
    throw error;
  }
  const scenario = await insertOne('buyer_property_fit_scenarios', {
    ...scenarioValues,
    guidance_id: guidance.id,
    buyer_id: buyerId,
    checkin_id: clean(body.checkin_id, 80) || null,
    open_house_event_id: clean(body.event_id || body.open_house_event_id || event?.id, 80) || null,
    agent_slug: agentSlug,
    loan_officer_profile_id: guidance.loan_officer_profile_id || null,
    agent_notes: clean(body.agent_notes, 1500) || null,
    review_status: scenarioValues.result_status === 'lo_review_required' ? 'lo_review_required' : 'not_reviewed'
  });
  return { guidance, scenario, disclaimer: DISCLAIMER };
}

async function reviewScenario(body) {
  const profile = await loadLoanOfficer(clean(body.loan_officer_uid || body.loan_officer_profile_id || body.uid, 80));
  if (!profile?.uid) {
    const error = new Error('Active loan officer profile not found.');
    error.status = 403;
    throw error;
  }
  const scenario = await loadOne(`buyer_property_fit_scenarios?id=eq.${enc(body.scenario_id)}&select=*`);
  if (!scenario?.id) {
    const error = new Error('Scenario not found.');
    error.status = 404;
    throw error;
  }
  if (scenario.loan_officer_profile_id && scenario.loan_officer_profile_id !== profile.uid) {
    const error = new Error('This scenario belongs to another loan officer.');
    error.status = 403;
    throw error;
  }
  const allowed = new Set(['reviewed', 'lo_review_required', 'needs_guidance_update']);
  const reviewStatus = clean(body.review_status || 'reviewed', 80);
  if (!allowed.has(reviewStatus)) {
    const error = new Error('Invalid review status.');
    error.status = 400;
    throw error;
  }
  const updated = await patchOne('buyer_property_fit_scenarios', scenario.id, {
    review_status: reviewStatus,
    review_notes: clean(body.review_notes, 1500) || null,
    reviewed_by_loan_officer_profile_id: profile.uid,
    reviewed_at: new Date().toISOString()
  });
  return { scenario: updated, disclaimer: DISCLAIMER };
}

async function loadLoForm(query) {
  const profile = await loadLoanOfficer(clean(query.uid || query.loan_officer_uid || query.loan_officer_profile_id, 80));
  if (!profile?.uid) {
    const error = new Error('Active loan officer profile not found.');
    error.status = 403;
    throw error;
  }
  let buyer = null;
  let checkin = null;
  let event = null;
  let agentSlug = clean(query.agent_slug || query.agent, 180);
  if (query.checkin_id && !query.buyer_id) {
    const synced = await syncCheckinBuyer(query.checkin_id);
    buyer = synced.buyer;
    checkin = synced.checkin;
    event = synced.event;
    agentSlug = agentSlug || synced.agent_slug;
  } else if (query.buyer_id) {
    buyer = await loadOne(`buyers?id=eq.${enc(query.buyer_id)}&select=*`);
    event = await loadEvent(query.event_id || query.event);
    agentSlug = agentSlug || eventAgentSlug(event);
  }
  if (!buyer?.id) {
    const error = new Error('Buyer not found.');
    error.status = 404;
    throw error;
  }
  const guidance = agentSlug ? await loadActiveGuidance(buyer.id, agentSlug) : null;
  const scenarios = agentSlug
    ? await supabaseRest(`buyer_property_fit_scenarios?buyer_id=eq.${enc(buyer.id)}&agent_slug=eq.${enc(agentSlug)}&select=*&order=created_at.desc&limit=50`)
    : [];
  return { profile, buyer, checkin, event, agent_slug: agentSlug, guidance, scenarios: Array.isArray(scenarios) ? scenarios : [], disclaimer: DISCLAIMER };
}

module.exports = async function handler(req, res) {
  try {
    const body = req.method === 'GET' ? {} : parseBody(req);
    const forbiddenKey = containsForbiddenData(body);
    if (forbiddenKey) {
      sendJson(res, 400, { ok: false, error: `Rel8tion cannot collect or store borrower financial/application data (${forbiddenKey}).` });
      return;
    }

    if (req.method === 'GET') {
      const mode = clean(req.query?.mode || 'event_fit_data', 80);
      const data = mode === 'lo_form'
        ? await loadLoForm(req.query || {})
        : await loadEventFitData(req.query || {});
      sendJson(res, 200, { ok: true, mode, ...data });
      return;
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    const action = clean(body.action, 80);
    if (action === 'sync_checkin_buyer') {
      const result = await syncCheckinBuyer(body.checkin_id);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }
    if (action === 'sync_lead_buyer') {
      const result = await syncLeadBuyer(body.lead_id);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }
    if (action === 'upsert_guidance') {
      const result = await upsertGuidance(body);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }
    if (action === 'create_scenario') {
      const result = await createScenario(body);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }
    if (action === 'review_scenario') {
      const result = await reviewScenario(body);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }

    sendJson(res, 400, { ok: false, error: 'Unknown affordability action.' });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to update affordability guidance.',
      details: error.payload || null
    });
  }
};
