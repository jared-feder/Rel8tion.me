const BASE_URL = (process.env.BASE_URL || 'https://app.rel8tion.me').replace(/\/$/, '');

const checks = [
  { path: '/agent-home', statuses: [200], label: 'agent owner dashboard' },
  { path: '/lo-affordability-guidance', statuses: [200], label: 'LO affordability guidance page' },
  { path: '/loan-officer-support', statuses: [200], label: 'LO support request page' },
  { path: '/services/nmb/activate', statuses: [200], label: 'legacy NMB activation link' },
  { path: '/services/nmb/verified', statuses: [200], label: 'legacy NMB verified link' },
  {
    path: '/api/chip-qr?code=test&format=json',
    statuses: [404],
    includes: 'Rel8tionChip QR code not found',
    label: 'Rel8tionChip QR API'
  },
  { path: '/api/buyer-affordability?mode=event_fit_data', label: 'buyer affordability API' },
  { path: '/api/loan-officer-support-request', statuses: [405], label: 'LO support request API' },
  { path: '/api/sms/android-inbound', statuses: [405], label: 'Android inbound webhook API' },
  { path: '/api/admin/outreach-search?q=test', statuses: [401, 500], label: 'admin outreach search API' },
  { path: '/api/admin/outreach-health', statuses: [401, 500], label: 'admin outreach health API' },
  { path: '/api/admin/android-inbox-replay', statuses: [405], label: 'admin Android replay API' },
  { path: '/api/cron/replay-android-inbox', statuses: [401, 500], label: 'Android replay cron API' }
];

function isVercelNotFound(status, body) {
  return status === 404
    && /NOT_FOUND/i.test(body || '')
    && /The page could not be found/i.test(body || '');
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { Accept: 'application/json,text/html;q=0.9,*/*;q=0.8' },
      signal: controller.signal
    });
    const body = await response.text();
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const failures = [];
  const rows = [];

  for (const check of checks) {
    const url = `${BASE_URL}${check.path}`;
    try {
      const result = await fetchWithTimeout(url);
      const sample = result.body.slice(0, 120).replace(/\s+/g, ' ').trim();
      const vercelMissing = isVercelNotFound(result.status, result.body);
      const badStatus = check.statuses && !check.statuses.includes(result.status);
      const missingText = check.includes && !result.body.includes(check.includes);
      rows.push({ path: check.path, status: result.status, label: check.label, sample });

      if (vercelMissing) {
        failures.push(`${check.path} returned Vercel NOT_FOUND, meaning the route/file is not deployed.`);
      } else if (badStatus) {
        failures.push(`${check.path} returned ${result.status}; expected one of ${check.statuses.join(', ')}.`);
      } else if (missingText) {
        failures.push(`${check.path} did not include expected text: ${check.includes}`);
      }
    } catch (error) {
      failures.push(`${check.path} request failed: ${error.message || error}`);
    }
  }

  console.table(rows);

  if (failures.length) {
    console.error(`Production route verification failed for ${BASE_URL}:`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(`Production route verification passed for ${BASE_URL}.`);
}

main();
