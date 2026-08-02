const {
  callTypeDetails,
  corsHeaders,
  generateSlots,
  readBookingConfig,
  supabaseRequest
} = require('../../lib/booking-calendar');

module.exports = async function handler(req, res) {
  const origin = String(req.headers?.origin || '');
  for (const [name, value] of Object.entries(corsHeaders(origin))) res.setHeader(name, value);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed.' });

  try {
    const config = readBookingConfig();
    const callType = callTypeDetails(req.query?.type || 'loan_officer', config);
    if (!callType) return res.status(400).json({ ok: false, error: 'Choose a valid call type.' });

    const generated = generateSlots(new Date(), config);
    const first = generated[0]?.start;
    const last = generated.at(-1)?.end;
    if (!first || !last) return res.status(200).json({ ok: true, call_type: callType, timezone: config.timezone, slots: [] });

    const rows = await supabaseRequest(
      `rel8tion_call_bookings?select=starts_at&status=eq.confirmed&starts_at=gte.${encodeURIComponent(first)}&starts_at=lt.${encodeURIComponent(last)}`
    );
    const unavailable = new Set((rows || []).map((row) => new Date(row.starts_at).toISOString()));
    return res.status(200).json({
      ok: true,
      version: config.version,
      timezone: config.timezone,
      duration_minutes: config.duration_minutes,
      minimum_notice_hours: config.minimum_notice_hours,
      call_type: callType,
      slots: generated.filter((slot) => !unavailable.has(slot.start))
    });
  } catch (error) {
    console.error('[bookings/availability]', error.message || error);
    return res.status(503).json({ ok: false, error: 'Scheduling is temporarily unavailable. Please try again shortly.' });
  }
};
