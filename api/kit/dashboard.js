const kit = require('../../lib/open-house-kit');

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function clean(value, max = 500) {
  return kit.clean(value, max);
}

function requireOrderAndToken(body) {
  const orderId = clean(body.order_id || body.orderId || body.order, 160);
  const token = clean(body.token, 500);
  if (!orderId || !token) {
    const error = new Error('Missing dashboard order or token.');
    error.status = 400;
    throw error;
  }
  return { orderId, token };
}

async function loadDashboard(body) {
  const { orderId, token } = requireOrderAndToken(body);
  const { order } = await kit.verifyDashboardAccess(orderId, token);
  const logoChoices = await kit.loadLogoChoices(order.brokerage);
  return {
    order: kit.publicOrder(order),
    logo_choices: logoChoices,
    amount_label: order.amount_total ? `$${(Number(order.amount_total) / 100).toFixed(2)}` : '',
    loaded_at: new Date().toISOString()
  };
}

async function updateLogo(body) {
  const { orderId, token } = requireOrderAndToken(body);
  await kit.verifyDashboardAccess(orderId, token);
  const order = await kit.selectLogo({
    orderId,
    logoId: clean(body.logo_id || body.logoId, 160),
    customLogoUrl: clean(body.custom_logo_url || body.customLogoUrl, 1200),
    customLogoStoragePath: clean(body.custom_logo_storage_path || body.customLogoStoragePath, 500),
    logoNotes: clean(body.logo_notes || body.logoNotes, 1000)
  });
  return {
    order: kit.publicOrder(order),
    logo_choices: await kit.loadLogoChoices(order.brokerage)
  };
}

async function uploadLogo(body) {
  const { orderId, token } = requireOrderAndToken(body);
  await kit.verifyDashboardAccess(orderId, token);
  const parsed = kit.parseDataUrl(body.data_url || body.dataUrl || '');
  const contentType = clean(body.content_type || body.contentType || parsed?.contentType, 80).toLowerCase();
  const dataBase64 = clean(body.data_base64 || body.dataBase64 || parsed?.base64, 8 * 1024 * 1024);
  const upload = await kit.uploadLogoObject({
    orderId,
    fileName: clean(body.file_name || body.fileName || 'logo.png', 160),
    contentType,
    dataBase64
  });
  const order = await kit.selectLogo({
    orderId,
    customLogoUrl: upload.public_url,
    customLogoStoragePath: upload.storage_path,
    logoNotes: clean(body.logo_notes || body.logoNotes, 1000)
  });
  return {
    order: kit.publicOrder(order),
    upload,
    logo_choices: await kit.loadLogoChoices(order.brokerage)
  };
}

async function setPassword(body) {
  const { orderId, token } = requireOrderAndToken(body);
  await kit.verifyDashboardAccess(orderId, token);
  const order = await kit.setDashboardPassword(orderId, String(body.password || ''));
  return { order: kit.publicOrder(order) };
}

async function login(body, req) {
  const order = await kit.loginWithPassword({
    orderId: clean(body.order_id || body.orderId || body.order, 160),
    email: clean(body.email, 320),
    password: String(body.password || '')
  });
  const access = await kit.createDashboardAccess(order.id, 'password_login');
  return {
    order: kit.publicOrder(order),
    token: access.token,
    dashboard_url: kit.dashboardUrl({
      baseUrl: kit.baseUrlFromReq(req),
      orderId: order.id,
      token: access.token
    })
  };
}

async function registerDeviceLock(body) {
  const { orderId, token } = requireOrderAndToken(body);
  await kit.verifyDashboardAccess(orderId, token);
  const now = new Date().toISOString();
  const order = await require('../../lib/admin-auth').supabaseRest(`open_house_kit_orders?id=eq.${encodeURIComponent(orderId)}&select=*`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      dashboard_device_lock_set_at: now,
      dashboard_device_lock_label: clean(body.label || body.device_label || body.deviceLabel || 'Device lock', 160),
      dashboard_secured_at: now
    })
  }).then((rows) => Array.isArray(rows) ? rows[0] || null : null);
  return { order: kit.publicOrder(order) };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    const body = await readBody(req);
    const action = clean(body.action || 'load', 80);
    let payload;
    if (action === 'load') payload = await loadDashboard(body);
    else if (action === 'update_logo') payload = await updateLogo(body);
    else if (action === 'upload_logo') payload = await uploadLogo(body);
    else if (action === 'set_password') payload = await setPassword(body);
    else if (action === 'login') payload = await login(body, req);
    else if (action === 'register_device_lock') payload = await registerDeviceLock(body);
    else return sendJson(res, 400, { ok: false, error: 'Unsupported dashboard action.' });

    return sendJson(res, 200, { ok: true, ...payload });
  } catch (error) {
    console.error('[kit/dashboard] failed', error);
    return sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Open House Kit dashboard request failed.'
    });
  }
};
