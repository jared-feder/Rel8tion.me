const { supabaseRest } = require('../../lib/admin-auth');
const { __test: propertyExperience } = require('../open-house-link');

const DEFAULT_BATCH_SIZE = 12;
const MAX_BATCH_SIZE = 24;
const LOOKAHEAD_DAYS = 14;

function readQuery(req, name) {
  const value = req.query?.[name];
  if (Array.isArray(value)) return value[0] || '';
  if (value !== undefined && value !== null) return String(value);
  try {
    return new URL(req.url || '', 'https://rel8tion.local').searchParams.get(name) || '';
  } catch {
    return '';
  }
}

function cronAuthorized(req) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  return Boolean(secret && String(req.headers?.authorization || '').trim() === `Bearer ${secret}`);
}

function profileTimestamp(profile) {
  const value = new Date(profile?.images_checked_at || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function selectPropertyCandidates(houses, profiles, limit) {
  const profileById = new Map((Array.isArray(profiles) ? profiles : []).map((profile) => [String(profile.open_house_id), profile]));
  return (Array.isArray(houses) ? houses : [])
    .map((house) => ({ house, profile: profileById.get(String(house.id)) || null }))
    .sort((left, right) => {
      const leftImages = Array.isArray(left.profile?.images) ? left.profile.images.length : 0;
      const rightImages = Array.isArray(right.profile?.images) ? right.profile.images.length : 0;
      if (leftImages <= 1 && rightImages > 1) return -1;
      if (rightImages <= 1 && leftImages > 1) return 1;
      return profileTimestamp(left.profile) - profileTimestamp(right.profile);
    })
    .slice(0, limit);
}

async function loadCandidates(req) {
  const requestedId = readQuery(req, 'id').trim().slice(0, 160);
  if (requestedId) {
    const rows = await supabaseRest(`open_houses?id=eq.${encodeURIComponent(requestedId)}&select=*&limit=1`);
    return selectPropertyCandidates(rows, [], 1);
  }

  const now = new Date();
  const lookahead = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  const [events, visits] = await Promise.all([
    supabaseRest('open_house_events?status=eq.active&open_house_source_id=not.is.null&select=open_house_source_id&limit=100'),
    supabaseRest(
      `field_demo_visits?status=in.(scheduled,confirmed,live)`
        + `&scheduled_end=gte.${encodeURIComponent(now.toISOString())}`
        + `&scheduled_start=lte.${encodeURIComponent(lookahead.toISOString())}`
        + '&open_house_id=not.is.null&select=open_house_id&limit=100'
    )
  ]);
  const ids = [...new Set([
    ...(Array.isArray(events) ? events.map((row) => row.open_house_source_id) : []),
    ...(Array.isArray(visits) ? visits.map((row) => row.open_house_id) : [])
  ].map((value) => String(value || '').trim()).filter(Boolean))];
  if (!ids.length) return [];

  const houses = await supabaseRest(
    `open_houses?id=in.(${ids.map(encodeURIComponent).join(',')})&select=*&order=open_start.asc&limit=100`
  );
  const profiles = await supabaseRest(
    'open_house_property_profiles?select=open_house_id,images,images_checked_at&limit=1000'
  ).catch(() => []);
  const requestedLimit = Number.parseInt(readQuery(req, 'limit'), 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, MAX_BATCH_SIZE))
    : DEFAULT_BATCH_SIZE;
  return selectPropertyCandidates(houses, profiles, limit);
}

async function enrichCandidate(candidate) {
  const before = Array.isArray(candidate.profile?.images) ? candidate.profile.images.length : 0;
  try {
    const profile = await propertyExperience.loadPropertyProfile({
      house: candidate.house,
      event: null,
      targetUrl: candidate.house?.link || '',
      forceRefresh: true
    });
    return {
      id: candidate.house.id,
      address: candidate.house.address || profile?.address || '',
      before_images: before,
      after_images: Array.isArray(profile?.images) ? profile.images.length : 0,
      status: 'enriched'
    };
  } catch (error) {
    return {
      id: candidate.house.id,
      address: candidate.house.address || '',
      before_images: before,
      after_images: before,
      status: 'failed',
      error: error.message || 'Property enrichment failed'
    };
  }
}

async function runBounded(candidates, concurrency = 3) {
  const results = new Array(candidates.length);
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await enrichCandidate(candidates[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker()));
  return results;
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method || 'GET')) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  if (!process.env.CRON_SECRET) {
    return res.status(503).json({ ok: false, error: 'Missing CRON_SECRET.' });
  }
  if (!cronAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized.' });
  }

  try {
    const candidates = await loadCandidates(req);
    const results = await runBounded(candidates);
    const failed = results.filter((result) => result.status === 'failed').length;
    const imagesAdded = results.reduce(
      (total, result) => total + Math.max(0, Number(result.after_images || 0) - Number(result.before_images || 0)),
      0
    );
    return res.status(failed === results.length && results.length ? 500 : 200).json({
      ok: failed === 0,
      selected: candidates.length,
      enriched: results.length - failed,
      failed,
      images_added: imagesAdded,
      results
    });
  } catch (error) {
    console.error('[property-profile-enrichment] cron failed:', error.message || error);
    return res.status(500).json({ ok: false, error: error.message || 'Property profile enrichment failed.' });
  }
};

module.exports.__test = {
  cronAuthorized,
  selectPropertyCandidates
};
