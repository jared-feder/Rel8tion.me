const BASE_URL = (process.env.BASE_URL || 'https://app.rel8tion.me').replace(/\/$/, '');

const checks = [
  { path: '/get-open-house-kit', statuses: [200], label: 'Open House Kit landing page' },
  { path: '/kit-intake?flow=manual', statuses: [200], label: 'Open House Kit intake page' },
  { path: '/kit-confirm', statuses: [200], label: 'Open House Kit confirmation page' },
  {
    path: '/o/test',
    statuses: [404],
    includes: 'No outreach preview was found',
    label: 'outreach preview short link'
  },
  {
    path: '/api/outreach-preview?id=test',
    statuses: [404],
    includes: 'No outreach preview was found',
    label: 'outreach preview API'
  },
  { path: '/agent-home', statuses: [200], label: 'agent owner dashboard' },
  { path: '/event-chat', statuses: [200], label: 'buyer event chat page' },
  { path: '/loan-officer-dashboard', statuses: [200], label: 'loan officer dashboard' },
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
  { path: '/api/admin/outreach-search?q=test', statuses: [401], label: 'admin outreach search API' },
  {
    path: '/api/admin/outreach-search?q=118%20s%2031st%20st%20wyandanch&limit=5',
    method: 'OPTIONS',
    statuses: [204],
    headers: {
      Origin: BASE_URL,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'x-admin-token,x-admin-uid,content-type'
    },
    responseHeaders: {
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'X-Admin-Token'
    },
    label: 'admin outreach search browser preflight'
  },
  { path: '/api/admin/outreach-health', statuses: [401], label: 'admin outreach health API' },
  { path: '/api/rel8tionos/health', statuses: [401], label: 'Rel8tionOS authenticated health API' },
  { path: '/api/rel8tionos/threads', statuses: [401], label: 'Rel8tionOS authenticated thread API' },
  { path: '/api/rel8tionos/reply', statuses: [405], label: 'Rel8tionOS reply method guard' },
  { path: '/api/admin/android-inbox-replay', statuses: [405], label: 'admin Android replay API' },
  { path: '/api/cron/replay-android-inbox', statuses: [401, 500], label: 'Android replay cron API' }
];

function isVercelNotFound(status, body) {
  return status === 404
    && /NOT_FOUND/i.test(body || '')
    && /The page could not be found/i.test(body || '');
}

async function fetchWithTimeout(url, check = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: check.method || 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
        ...(check.headers || {})
      },
      signal: controller.signal
    });
    const body = await response.text();
    return { status: response.status, body, headers: response.headers };
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
      const result = await fetchWithTimeout(url, check);
      const sample = result.body.slice(0, 120).replace(/\s+/g, ' ').trim();
      const vercelMissing = isVercelNotFound(result.status, result.body);
      const badStatus = check.statuses && !check.statuses.includes(result.status);
      const missingText = check.includes && !result.body.includes(check.includes);
      const missingHeaders = Object.entries(check.responseHeaders || {})
        .filter(([name, expected]) => !String(result.headers.get(name) || '').includes(expected))
        .map(([name, expected]) => `${name}: ${expected}`);
      rows.push({
        method: check.method || 'GET',
        path: check.path,
        status: result.status,
        label: check.label,
        sample
      });

      if (vercelMissing) {
        failures.push(`${check.path} returned Vercel NOT_FOUND, meaning the route/file is not deployed.`);
      } else if (badStatus) {
        failures.push(`${check.path} returned ${result.status}; expected one of ${check.statuses.join(', ')}.`);
      } else if (missingText) {
        failures.push(`${check.path} did not include expected text: ${check.includes}`);
      } else if (missingHeaders.length) {
        failures.push(`${check.path} missing expected response header values: ${missingHeaders.join('; ')}.`);
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
