const { supabaseRest } = require('../../lib/admin-auth');
const kit = require('../../lib/open-house-kit');

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
  res.end(JSON.stringify(payload));
}

function readQuery(req, name) {
  const value = req.query?.[name];
  if (Array.isArray(value)) return value[0] || '';
  if (value) return value;
  try {
    return new URL(req.url || '', 'https://rel8tion.local').searchParams.get(name) || '';
  } catch (_) {
    return '';
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    const uid = kit.clean(readQuery(req, 'uid'), 160);
    if (!uid) return sendJson(res, 400, { ok: false, error: 'Missing chip UID.' });

    const rows = await supabaseRest(
      `open_house_kit_orders?uid=eq.${encodeURIComponent(uid)}&status=in.(paid,no_payment_required)&select=*&order=created_at.desc&limit=1`
    );
    const order = Array.isArray(rows) ? rows[0] || null : null;
    if (!order?.id) return sendJson(res, 404, { ok: false, error: 'No paid Open House Kit dashboard is linked to this chip yet.' });

    const access = await kit.createDashboardAccess(order.id, 'chip_scan', { uid });
    return sendJson(res, 200, {
      ok: true,
      order: kit.publicOrder(order),
      dashboard_url: kit.dashboardUrl({
        baseUrl: kit.baseUrlFromReq(req),
        orderId: order.id,
        token: access.token
      })
    });
  } catch (error) {
    console.error('[kit/resolve-chip] failed', error);
    return sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to resolve this kit chip.'
    });
  }
};
