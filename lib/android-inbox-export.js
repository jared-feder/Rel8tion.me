function clean(value) {
  return String(value ?? '').trim();
}

function clampHours(value, fallback = 3, max = 24) {
  const parsed = Number.parseInt(clean(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, parsed));
}

function parseRoutes(value, fallback = 'outreach') {
  const raw = clean(value || fallback).toLowerCase();
  if (raw === 'both') return ['outreach', 'events'];
  return raw
    .split(/[\s,;]+/)
    .map((route) => route.trim())
    .filter(Boolean);
}

function gatewayConfig(route) {
  const prefix = route === 'events' ? 'ANDROID_EVENTS' : 'ANDROID_OUTREACH';
  return {
    route,
    url: clean(process.env[`${prefix}_GATEWAY_URL`] || 'https://api.sms-gate.app'),
    username: clean(process.env[`${prefix}_GATEWAY_USERNAME`]),
    password: clean(process.env[`${prefix}_GATEWAY_PASSWORD`]),
    deviceId: clean(process.env[`${prefix}_GATEWAY_DEVICE_ID`])
  };
}

function maskDevice(deviceId) {
  if (!deviceId) return '';
  return deviceId.length <= 8 ? 'configured' : `${deviceId.slice(0, 4)}...${deviceId.slice(-4)}`;
}

async function requestInboxExport(config, since, until) {
  const missing = ['username', 'password', 'deviceId'].filter((key) => !config[key]);
  if (missing.length) {
    return {
      ok: false,
      route: config.route,
      status: 'missing_config',
      missing
    };
  }

  const endpoint = `${config.url.replace(/\/$/, '')}/3rdparty/v1/messages/inbox/export`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      deviceId: config.deviceId,
      since,
      until
    })
  });

  const text = await response.text().catch(() => '');
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  return {
    ok: response.ok,
    route: config.route,
    status: response.status,
    device: maskDevice(config.deviceId),
    payload: response.ok ? payload : null,
    error: response.ok ? null : payload || text || `Gateway returned ${response.status}`
  };
}

async function requestViaSupabaseFunction({ routes, hours }) {
  const supabaseUrl = clean(process.env.SUPABASE_URL);
  const serviceRoleKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl || !serviceRoleKey) return null;

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/android-inbox-replay`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      routes: routes.join(','),
      hours
    })
  });

  const text = await response.text().catch(() => '');
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(payload?.error || payload?.message || text || `Supabase replay failed: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function requestAndroidInboxReplay({ routes = ['outreach'], hours = 3, until = new Date().toISOString() } = {}) {
  const uniqueRoutes = [...new Set(routes)];

  if (!uniqueRoutes.every((route) => ['outreach', 'events'].includes(route))) {
    throw new Error('Route must be outreach, events, or both.');
  }

  if (process.env.ANDROID_INBOX_REPLAY_DIRECT !== 'true') {
    const supabaseResult = await requestViaSupabaseFunction({ routes: uniqueRoutes, hours });
    if (supabaseResult) return supabaseResult;
  }

  const since = new Date(Date.parse(until) - hours * 60 * 60 * 1000).toISOString();
  const results = await Promise.all(uniqueRoutes.map((route) => requestInboxExport(gatewayConfig(route), since, until)));
  return {
    ok: results.some((item) => item.ok),
    message: 'Android inbox replay requested. Matching inbound SMS webhooks should arrive shortly.',
    since,
    until,
    hours,
    routes: uniqueRoutes,
    results
  };
}

module.exports = {
  clampHours,
  parseRoutes,
  requestAndroidInboxReplay
};
