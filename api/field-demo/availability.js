const { readJsonBody, send, supabaseRest } = require('../../lib/outreach-cron-shared');

const ALLOWED_ROLES = new Set(['loan_officer', 'field_sales_rep', 'demo_presenter', 'onboarding_specialist', 'dispatcher', 'admin']);
const ALLOWED_RESPONSIBILITIES = new Set(['financing_support', 'product_demo', 'agent_onboarding', 'sign_setup', 'follow_up_owner']);
const ALLOWED_STATUSES = new Set(['open', 'held', 'booked', 'unavailable', 'cancelled']);

function enc(value) {
  return encodeURIComponent(String(value || ''));
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function one(rows) {
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function loadProfile(input = {}) {
  const uid = String(input.uid || input.participant_uid || '').trim();
  const slug = String(input.slug || '').trim();
  if (!uid && !slug) throw new Error('Missing verified profile uid or slug.');
  const filter = uid ? `uid=eq.${enc(uid)}` : `slug=eq.${enc(slug)}`;
  const profile = one(await supabaseRest(`verified_profiles?${filter}&is_active=eq.true&select=*&limit=1`).catch(() => []));
  if (!profile?.uid) throw new Error('Verified field profile not found.');
  return profile;
}

function normalizeSlot(input, profile) {
  const role = String(input.role || 'loan_officer').trim();
  const responsibility = String(input.responsibility || 'financing_support').trim();
  const status = String(input.status || 'open').trim();
  const serviceZip = onlyDigits(input.service_zip || input.zip).slice(0, 5);
  const availableStart = input.available_start;
  const availableEnd = input.available_end;
  const radius = Math.max(1, Math.min(Number(input.service_radius_miles || 15), 250));

  if (!ALLOWED_ROLES.has(role)) throw new Error(`Invalid role: ${role}`);
  if (!ALLOWED_RESPONSIBILITIES.has(responsibility)) throw new Error(`Invalid responsibility: ${responsibility}`);
  if (!ALLOWED_STATUSES.has(status)) throw new Error(`Invalid status: ${status}`);
  if (serviceZip.length !== 5) throw new Error('Service ZIP is required.');
  if (!availableStart || !availableEnd) throw new Error('Availability start and end are required.');
  if (new Date(availableEnd) <= new Date(availableStart)) throw new Error('Availability end must be after start.');

  return {
    participant_profile_id: profile.uid,
    participant_uid: profile.uid,
    participant_slug: profile.slug || null,
    participant_name: profile.full_name || null,
    participant_phone: profile.phone || null,
    participant_email: profile.email || null,
    participant_company: profile.company_name || null,
    role,
    responsibility,
    available_start: availableStart,
    available_end: availableEnd,
    service_zip: serviceZip,
    service_radius_miles: radius,
    status,
    notes: input.notes || null,
    updated_at: new Date().toISOString()
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      send(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    const body = readJsonBody(req);
    const action = String(body.action || 'list').trim();
    const profile = await loadProfile(body);

    if (action === 'list') {
      const from = body.from || new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const toDate = new Date();
      toDate.setDate(toDate.getDate() + Math.max(1, Math.min(Number(body.days || 14), 60)));
      const rows = await supabaseRest(
        `field_coverage_availability?participant_profile_id=eq.${enc(profile.uid)}&available_end=gte.${enc(from)}&available_start=lt.${enc(toDate.toISOString())}&select=*&order=available_start.asc&limit=100`
      ).catch(() => []);
      send(res, 200, { ok: true, profile, availability: rows || [] });
      return;
    }

    if (action === 'upsert') {
      const slot = normalizeSlot(body, profile);
      const id = String(body.id || '').trim();
      const row = id
        ? one(await supabaseRest(`field_coverage_availability?id=eq.${enc(id)}&participant_profile_id=eq.${enc(profile.uid)}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(slot)
          }))
        : one(await supabaseRest('field_coverage_availability', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ ...slot, created_at: new Date().toISOString() })
          }));
      send(res, 200, { ok: true, availability: row });
      return;
    }

    if (action === 'cancel') {
      const id = String(body.id || '').trim();
      if (!id) throw new Error('Missing availability id.');
      const row = one(await supabaseRest(`field_coverage_availability?id=eq.${enc(id)}&participant_profile_id=eq.${enc(profile.uid)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'cancelled', updated_at: new Date().toISOString() })
      }));
      send(res, 200, { ok: true, availability: row });
      return;
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    console.error('[field-demo/availability] failed', error);
    send(res, 500, { ok: false, error: error.message || 'Failed to update field availability.' });
  }
};
