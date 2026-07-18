const { sendJson, supabaseRest } = require('../../lib/admin-auth');

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function enc(value) {
  return encodeURIComponent(String(value || '').trim());
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

function sponsoredEvent(event) {
  const context = event?.setup_context || {};
  return /sponsored/i.test([context.flow, context.source, context.qr_source].filter(Boolean).join(' '));
}

function sessionPayload(eventId, participant, profile) {
  const now = new Date().toISOString();
  return {
    open_house_event_id: eventId,
    verified_profile_uid: profile?.uid || participant.participant_profile_id || null,
    loan_officer_uid: participant.participant_uid || profile?.uid || participant.participant_profile_id || null,
    loan_officer_slug: profile?.slug || '',
    loan_officer_name: participant.participant_name || profile?.full_name || '',
    loan_officer_title: profile?.title || '',
    loan_officer_company: participant.participant_company || profile?.company_name || '',
    loan_officer_phone: participant.participant_phone || profile?.phone || '',
    loan_officer_email: participant.participant_email || profile?.email || '',
    loan_officer_photo_url: profile?.photo_url || profile?.image_url || profile?.avatar_url || '',
    loan_officer_cta_url: profile?.cta_url || profile?.website || '',
    loan_officer_calendar_url: profile?.calendar_url || '',
    status: 'live',
    signed_out_at: null,
    last_seen_at: now,
    updated_at: now
  };
}

async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    const { event_id: eventId } = parseBody(req);
    if (!eventId) {
      sendJson(res, 400, { ok: false, error: 'Missing event_id.' });
      return;
    }

    const event = one(await supabaseRest(
      `open_house_events?id=eq.${enc(eventId)}&status=eq.active&ended_at=is.null&select=*&limit=1`
    ));
    if (!event) {
      sendJson(res, 404, { ok: false, error: 'Active open house event not found.' });
      return;
    }

    // Sponsored Event Pass coverage is handled only by its consent workflow.
    if (sponsoredEvent(event)) {
      sendJson(res, 200, { ok: true, linked: false, reason: 'sponsored_consent_required' });
      return;
    }

    if (!event.open_house_source_id) {
      sendJson(res, 200, { ok: true, linked: false, reason: 'missing_open_house_source' });
      return;
    }

    const visit = one(await supabaseRest(
      `field_demo_visits?open_house_id=eq.${enc(event.open_house_source_id)}&status=neq.cancelled&select=*&order=created_at.desc&limit=1`
    ));
    if (!visit) {
      sendJson(res, 200, { ok: true, linked: false, reason: 'no_assigned_visit' });
      return;
    }

    const participant = one(await supabaseRest(
      `field_demo_visit_participants?field_demo_visit_id=eq.${enc(visit.id)}&role=eq.loan_officer&responsibility=eq.financing_support&is_primary=eq.true&status=in.(assigned,confirmed,en_route,on_site,live)&select=*&order=created_at.desc&limit=1`
    ));
    if (!participant) {
      sendJson(res, 200, { ok: true, linked: false, reason: 'no_assigned_loan_officer' });
      return;
    }

    const profileUid = participant.participant_profile_id || participant.participant_uid;
    const profile = profileUid
      ? one(await supabaseRest(`verified_profiles?uid=eq.${enc(profileUid)}&is_active=eq.true&select=*&limit=1`).catch(() => []))
      : null;
    const payload = sessionPayload(event.id, participant, profile);
    const existing = one(await supabaseRest(
      `event_loan_officer_sessions?open_house_event_id=eq.${enc(event.id)}&status=eq.live&select=*&limit=1`
    ).catch(() => []));

    const session = existing?.id
      ? one(await supabaseRest(`event_loan_officer_sessions?id=eq.${enc(existing.id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(payload)
        }))
      : one(await supabaseRest('event_loan_officer_sessions', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ ...payload, signed_in_at: new Date().toISOString() })
        }));

    await supabaseRest(`field_demo_visits?id=eq.${enc(visit.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ open_house_event_id: event.id })
    });

    sendJson(res, 200, { ok: true, linked: true, session, visit_id: visit.id });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to link assigned loan officer coverage.'
    });
  }
}

module.exports = handler;

