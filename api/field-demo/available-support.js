const { readJsonBody, send, supabaseRest } = require('../../lib/outreach-cron-shared');

function enc(value) {
  return encodeURIComponent(String(value || ''));
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function extractZip(...values) {
  for (const value of values) {
    const match = String(value || '').match(/\b(\d{5})(?:-\d{4})?\b/);
    if (match) return match[1];
  }
  return '';
}

function one(rows) {
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function haversineMiles(aLat, aLng, bLat, bLng) {
  const nums = [aLat, aLng, bLat, bLng].map(Number);
  if (nums.some((value) => !Number.isFinite(value))) return null;
  const [lat1, lng1, lat2, lng2] = nums.map((value) => value * Math.PI / 180);
  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

function zipScore(targetZip, serviceZip) {
  const target = digits(targetZip).slice(0, 5);
  const service = digits(serviceZip).slice(0, 5);
  if (!target || !service) return 999;
  if (target === service) return 0;
  if (target.slice(0, 3) === service.slice(0, 3)) return 10;
  if (target.slice(0, 2) === service.slice(0, 2)) return 35;
  const diff = Math.abs(Number(target) - Number(service));
  return Number.isFinite(diff) ? 60 + Math.min(diff / 10, 300) : 999;
}

function candidateScore(row, targetZip, targetLat, targetLng) {
  const distance = haversineMiles(targetLat, targetLng, row.base_lat, row.base_lng);
  const zipFallback = zipScore(targetZip, row.service_zip);
  const distanceScore = distance === null ? zipFallback : distance;
  const inRadius = distance === null ? zipFallback <= 35 : distance <= Number(row.service_radius_miles || 15);
  const roleBoost = row.responsibility === 'financing_support' ? 0 : 8;
  return {
    distance_miles: distance,
    approximate_zip_score: zipFallback,
    in_service_radius: inRadius,
    assignment_score: Math.round((distanceScore + roleBoost) * 100) / 100,
    assignment_reason: distance === null
      ? `ZIP proximity match ${targetZip || 'unknown'} -> ${row.service_zip}`
      : `${Math.round(distance * 10) / 10} miles from coverage center`
  };
}

async function loadOpenHouseContext(input) {
  if (!input.open_house_id) return {};
  const row = one(await supabaseRest(`open_houses?id=eq.${enc(input.open_house_id)}&select=id,address,zip,lat,lng&limit=1`).catch(() => []));
  return row || {};
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      send(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    const body = readJsonBody(req);
    const start = body.scheduled_start || body.open_start || body.available_start;
    const end = body.scheduled_end || body.open_end || body.available_end;
    if (!start || !end) throw new Error('scheduled_start and scheduled_end are required.');

    const context = await loadOpenHouseContext(body);
    const targetZip = extractZip(body.property_zip, body.zip, context.zip, body.address, context.address);
    const targetLat = body.lat ?? context.lat ?? null;
    const targetLng = body.lng ?? context.lng ?? null;
    const responsibility = String(body.responsibility || 'financing_support').trim();
    const limit = Math.max(1, Math.min(Number(body.limit || 10), 50));

    const rows = await supabaseRest(
      `field_coverage_availability?status=eq.open&responsibility=eq.${enc(responsibility)}&available_start=lte.${enc(start)}&available_end=gte.${enc(end)}&select=*&limit=200`
    ).catch(() => []);

    const candidates = (Array.isArray(rows) ? rows : [])
      .map((row) => ({ ...row, ...candidateScore(row, targetZip, targetLat, targetLng) }))
      .filter((row) => row.in_service_radius || row.approximate_zip_score <= 35)
      .sort((a, b) => a.assignment_score - b.assignment_score || new Date(a.available_start) - new Date(b.available_start))
      .slice(0, limit);

    send(res, 200, {
      ok: true,
      target: {
        zip: targetZip || null,
        lat: targetLat,
        lng: targetLng,
        start,
        end,
        responsibility
      },
      candidates
    });
  } catch (error) {
    console.error('[field-demo/available-support] failed', error);
    send(res, 500, { ok: false, error: error.message || 'Failed to find available support.' });
  }
};
