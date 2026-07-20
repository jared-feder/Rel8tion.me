const { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } = require('crypto');
const { supabaseRest } = require('./admin-auth');

const TOKEN_BYTES = 32;
const TOKEN_TTL_DAYS = Number(process.env.OPEN_HOUSE_KIT_DASHBOARD_TOKEN_TTL_DAYS || 90);
const PASSWORD_ITERATIONS = Number(process.env.OPEN_HOUSE_KIT_PASSWORD_ITERATIONS || 120000);
const LOGO_BUCKET = 'open-house-kit-logos';
const WELCOME_TEMPLATE_KEY = 'welcome_paid';
const DEFAULT_WEBSITE_BUILDER_URL = 'https://my.rel8tion.me/get-started';

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function websitePromoCodeForSession(sessionId) {
  const prefix = clean(process.env.REL8TION_WEBSITE_PROMO_PREFIX || 'R8WEB', 18)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '') || 'R8WEB';
  const digest = createHash('sha256')
    .update(`${clean(sessionId, 160)}:${process.env.REL8TION_WEBSITE_PROMO_SALT || 'rel8tion-open-house-kit'}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  return `${prefix}-${digest}`;
}

function websiteBuilderUrlWithCode(code) {
  const base = clean(process.env.REL8TION_WEBSITE_BUILDER_URL || DEFAULT_WEBSITE_BUILDER_URL);
  const url = new URL(base);
  url.searchParams.set('promo', clean(code, 80));
  url.searchParams.set('source', 'open_house_kit');
  return url.toString();
}

function enc(value) {
  return encodeURIComponent(clean(value, 2000));
}

function normalizePhone(value) {
  const digits = clean(value, 80).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function timestampFromSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function compactAddress(address = {}) {
  return [
    address.line1,
    address.line2,
    [address.city, address.state, address.postal_code].filter(Boolean).join(' '),
    address.country
  ].map((part) => clean(part, 180)).filter(Boolean).join(', ');
}

function isEligibleOpenHouseKitSession(session) {
  const metadata = session?.metadata || {};
  const source = clean(metadata.source).toLowerCase();
  const product = clean(metadata.product).toLowerCase();
  const plan = clean(metadata.plan).toLowerCase();
  return Boolean(
    source.includes('open_house_kit') ||
    product.includes('open_house_kit') ||
    ['monthly', 'annual'].includes(plan)
  );
}

function isPaidSession(session) {
  return session?.payment_status === 'paid' || session?.payment_status === 'no_payment_required';
}

function statusForCheckout({ eventType, session }) {
  if (eventType === 'checkout.session.async_payment_failed') return 'payment_failed';
  if (session?.payment_status === 'paid') return 'paid';
  if (session?.payment_status === 'no_payment_required') return 'no_payment_required';
  return 'payment_pending';
}

function fulfillmentStatusFor(status) {
  if (status === 'paid' || status === 'no_payment_required') return 'needs_review';
  if (status === 'payment_failed') return 'payment_failed';
  return 'payment_pending';
}

function buildOrderPayloadFromSession(session, source = {}) {
  const metadata = session.metadata || {};
  const customer = session.customer_details || {};
  const shipping = session.shipping_details || {};
  const shippingAddress = shipping.address || {};
  const customerAddress = customer.address || {};
  const address = Object.keys(shippingAddress).length ? shippingAddress : customerAddress;
  const eventType = clean(source.eventType || 'checkout_success_return', 120);
  const status = source.status || statusForCheckout({ eventType, session });
  const paid = status === 'paid' || status === 'no_payment_required';
  const email = clean(customer.email || session.customer_email || metadata.email, 320).toLowerCase();
  const phone = clean(customer.phone || metadata.phone, 80);

  return {
    stripe_checkout_session_id: clean(session.id, 160),
    stripe_webhook_event_id: clean(source.eventId, 160) || null,
    last_stripe_event_type: eventType,
    stripe_subscription_id: clean(session.subscription, 160) || null,
    stripe_customer_id: clean(session.customer, 160) || null,
    stripe_payment_intent_id: clean(session.payment_intent, 160) || null,
    status,
    fulfillment_status: fulfillmentStatusFor(status),
    plan: clean(metadata.plan || 'unknown', 80),
    product: clean(metadata.product, 120) || null,
    source: clean(metadata.source, 120) || null,
    flow: clean(metadata.flow, 120) || null,
    uid: clean(metadata.uid, 160) || null,
    agent_id: clean(metadata.agent_id, 160) || null,
    agent_slug: clean(metadata.agent_slug, 160) || null,
    agent_name: clean(metadata.agent, 180) || null,
    brokerage: clean(metadata.brokerage, 180) || null,
    email: email || null,
    phone: phone || null,
    phone_normalized: normalizePhone(phone) || null,
    shipping_name: clean(shipping.name || customer.name, 180) || null,
    shipping_address_line1: clean(address.line1, 240) || null,
    shipping_address_line2: clean(address.line2, 240) || null,
    shipping_city: clean(address.city, 160) || null,
    shipping_state: clean(address.state, 80) || null,
    shipping_postal_code: clean(address.postal_code, 40) || null,
    shipping_country: clean(address.country, 12) || null,
    address_summary: clean(metadata.address || compactAddress(address), 500) || null,
    event_label: clean(metadata.event, 240) || null,
    sign_id: clean(metadata.sign_id, 160) || null,
    sponsor_profile_id: clean(metadata.sponsor_profile_id, 160) || null,
    sponsor_name: clean(metadata.sponsor_name, 180) || null,
    sponsor_company: clean(metadata.sponsor_company, 180) || null,
    notes: clean(metadata.notes, 1000) || null,
    amount_subtotal: Number.isFinite(session.amount_subtotal) ? session.amount_subtotal : null,
    amount_total: Number.isFinite(session.amount_total) ? session.amount_total : null,
    currency: clean(session.currency, 12) || null,
    payment_status: clean(session.payment_status, 80) || null,
    customer_details: customer,
    shipping_details: shipping,
    metadata,
    raw_session: session,
    stripe_created_at: timestampFromSeconds(session.created),
    paid_at: paid ? timestampFromSeconds(source.eventCreated) || new Date().toISOString() : null
  };
}

async function upsertOpenHouseKitOrder(order) {
  const rows = await supabaseRest('open_house_kit_orders?on_conflict=stripe_checkout_session_id&select=*&limit=1', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(order)
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

function baseUrlFromReq(req) {
  const configured = clean(process.env.REL8TION_PUBLIC_BASE_URL || process.env.OPEN_HOUSE_KIT_PUBLIC_BASE_URL, 300);
  if (configured) return configured.replace(/\/+$/, '');
  const proto = clean(req?.headers?.['x-forwarded-proto'] || req?.headers?.['X-Forwarded-Proto'] || 'https', 20);
  const host = clean(req?.headers?.['x-forwarded-host'] || req?.headers?.['X-Forwarded-Host'] || req?.headers?.host || 'getrel8tion.com', 200);
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function hashToken(token) {
  return createHash('sha256').update(clean(token, 500)).digest('hex');
}

function addDays(date, days) {
  const safeDays = Number.isFinite(days) && days > 0 ? days : 90;
  return new Date(date.getTime() + safeDays * 24 * 60 * 60 * 1000);
}

function dashboardUrl({ baseUrl, orderId, token }) {
  const url = new URL('/kit-dashboard', baseUrl || 'https://getrel8tion.com');
  url.searchParams.set('order', orderId);
  url.searchParams.set('token', token);
  return url.toString();
}

async function createDashboardAccess(orderId, purpose = 'dashboard', metadata = {}) {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const now = new Date();
  const expiresAt = addDays(now, TOKEN_TTL_DAYS).toISOString();
  const rows = await supabaseRest('open_house_kit_access_tokens?select=id,expires_at', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      order_id: orderId,
      token_hash: hashToken(token),
      purpose,
      expires_at: expiresAt,
      metadata
    })
  });
  const tokenRow = Array.isArray(rows) ? rows[0] || null : null;
  return { token, token_row: tokenRow, expires_at: expiresAt };
}

async function getOrderById(orderId) {
  const rows = await supabaseRest(`open_house_kit_orders?id=eq.${enc(orderId)}&select=*&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function verifyDashboardAccess(orderId, token) {
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();
  const rows = await supabaseRest(
    `open_house_kit_access_tokens?order_id=eq.${enc(orderId)}&token_hash=eq.${enc(tokenHash)}&revoked_at=is.null&expires_at=gt.${enc(now)}&select=id,order_id,purpose,expires_at&limit=1`
  );
  const tokenRow = Array.isArray(rows) ? rows[0] || null : null;
  if (!tokenRow) {
    const error = new Error('Dashboard link is expired or invalid.');
    error.status = 401;
    throw error;
  }

  const accessedAt = new Date().toISOString();
  await Promise.all([
    supabaseRest(`open_house_kit_access_tokens?id=eq.${enc(tokenRow.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ last_used_at: accessedAt })
    }).catch(() => null),
    supabaseRest(`open_house_kit_orders?id=eq.${enc(orderId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ dashboard_last_accessed_at: accessedAt })
    }).catch(() => null)
  ]);

  const order = await getOrderById(orderId);
  if (!order) {
    const error = new Error('Open House Kit order was not found.');
    error.status = 404;
    throw error;
  }
  return { order, token: tokenRow };
}

async function loadLogoChoices(brokerage = '') {
  const rows = await supabaseRest('company_logos?status=eq.approved&select=id,brand_key,display_name,brokerage_name,domain,logo_url,aliases&order=display_name.asc&limit=200');
  const normalizedBrokerage = clean(brokerage).toLowerCase();
  return (Array.isArray(rows) ? rows : []).sort((a, b) => {
    const aText = [a.display_name, a.brokerage_name, ...(a.aliases || [])].join(' ').toLowerCase();
    const bText = [b.display_name, b.brokerage_name, ...(b.aliases || [])].join(' ').toLowerCase();
    const aScore = normalizedBrokerage && aText.includes(normalizedBrokerage) ? 0 : 1;
    const bScore = normalizedBrokerage && bText.includes(normalizedBrokerage) ? 0 : 1;
    if (aScore !== bScore) return aScore - bScore;
    return clean(a.display_name).localeCompare(clean(b.display_name));
  });
}

async function selectLogo({ orderId, logoId, customLogoUrl, customLogoStoragePath, logoNotes }) {
  let patch = {
    logo_notes: clean(logoNotes, 1000) || null,
    logo_selected_at: new Date().toISOString()
  };

  if (logoId) {
    const rows = await supabaseRest(`company_logos?id=eq.${enc(logoId)}&status=eq.approved&select=id,display_name,logo_url&limit=1`);
    const logo = Array.isArray(rows) ? rows[0] || null : null;
    if (!logo) {
      const error = new Error('Selected logo was not found.');
      error.status = 404;
      throw error;
    }
    patch = {
      ...patch,
      selected_logo_id: logo.id,
      selected_logo_name: logo.display_name,
      selected_logo_url: logo.logo_url,
      custom_logo_url: null,
      custom_logo_storage_path: null,
      logo_choice_status: 'selected'
    };
  } else if (customLogoUrl) {
    patch = {
      ...patch,
      selected_logo_id: null,
      selected_logo_name: null,
      selected_logo_url: null,
      custom_logo_url: clean(customLogoUrl, 1200),
      custom_logo_storage_path: clean(customLogoStoragePath, 500) || null,
      logo_choice_status: 'uploaded'
    };
  } else {
    const error = new Error('Choose a logo or upload your own.');
    error.status = 400;
    throw error;
  }

  const rows = await supabaseRest(`open_house_kit_orders?id=eq.${enc(orderId)}&select=*`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

function sanitizeFileName(name) {
  const ext = clean(name, 120).toLowerCase().match(/\.(png|jpe?g|webp|svg)$/)?.[0] || '';
  const base = clean(name, 120).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'logo';
  return `${base.slice(0, 60)}${ext || '.png'}`;
}

function parseDataUrl(dataUrl) {
  const match = clean(dataUrl, 8 * 1024 * 1024).match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return {
    contentType: match[1],
    base64: match[2]
  };
}

async function uploadLogoObject({ orderId, fileName, contentType, dataBase64 }) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    const error = new Error('Logo storage is not configured.');
    error.status = 501;
    throw error;
  }

  const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
  const safeType = clean(contentType, 80).toLowerCase();
  if (!allowed.has(safeType)) {
    const error = new Error('Upload a PNG, JPG, WEBP, or SVG logo.');
    error.status = 400;
    throw error;
  }

  const buffer = Buffer.from(clean(dataBase64, 8 * 1024 * 1024), 'base64');
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) {
    const error = new Error('Logo upload must be under 5 MB.');
    error.status = 400;
    throw error;
  }

  const storagePath = `${orderId}/${Date.now()}-${sanitizeFileName(fileName)}`;
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${LOGO_BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': safeType,
      'x-upsert': 'true'
    },
    body: buffer
  });

  const raw = await response.text().catch(() => '');
  if (!response.ok) {
    const error = new Error(raw || `Logo upload failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return {
    storage_path: storagePath,
    public_url: `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${LOGO_BUCKET}/${storagePath}`
  };
}

function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(String(password), salt, PASSWORD_ITERATIONS, 32, 'sha256').toString('hex');
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const parts = clean(storedHash, 500).split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 10000) return false;
  const hash = pbkdf2Sync(String(password), parts[2], iterations, 32, 'sha256').toString('hex');
  const left = Buffer.from(hash, 'hex');
  const right = Buffer.from(parts[3], 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

async function setDashboardPassword(orderId, password) {
  if (String(password || '').length < 8) {
    const error = new Error('Use at least 8 characters.');
    error.status = 400;
    throw error;
  }
  const now = new Date().toISOString();
  const rows = await supabaseRest(`open_house_kit_orders?id=eq.${enc(orderId)}&select=*`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      dashboard_password_hash: passwordHash(password),
      dashboard_password_set_at: now,
      dashboard_secured_at: now
    })
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function loginWithPassword({ orderId, email, password }) {
  const order = await getOrderById(orderId);
  const providedEmail = clean(email, 320).toLowerCase();
  if (!order || !providedEmail || clean(order.email, 320).toLowerCase() !== providedEmail || !verifyPassword(password, order.dashboard_password_hash)) {
    const error = new Error('Email or password did not match this kit dashboard.');
    error.status = 401;
    throw error;
  }
  return order;
}

function moneyLabel(amount, currency = 'usd') {
  const cents = Number(amount);
  if (!Number.isFinite(cents)) return '';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: clean(currency, 12).toUpperCase() || 'USD'
    }).format(cents / 100);
  } catch (_) {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function nameForOrder(order) {
  return clean(order.agent_name || order.shipping_name || order.email || 'there', 120);
}

function timelineText(order) {
  const paidAt = order.paid_at ? new Date(order.paid_at) : new Date();
  const prepStart = new Date(paidAt.getTime() + 24 * 60 * 60 * 1000);
  const expected = new Date(paidAt.getTime() + 14 * 24 * 60 * 60 * 1000);
  return {
    paid: paidAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    prep: prepStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    expected: expected.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  };
}

function welcomeEmail({ order, url }) {
  const name = nameForOrder(order);
  const timeline = timelineText(order);
  const amount = moneyLabel(order.amount_total, order.currency);
  const subject = 'Welcome to REL8TION - your Open House Kit is in motion';
  const text = [
    `Welcome to REL8TION, ${name}. You made a smart decision.`,
    '',
    'Your Open House Kit payment was received and your setup dashboard is ready.',
    '',
    'What happens next:',
    `- Today: confirm the kit details and select the logo for your Rel8tionChips.`,
    `- ${timeline.prep}: REL8TION reviews the logo and prepares the kit for production/fulfillment.`,
    `- By ${timeline.expected}: expected delivery window for the Open House Kit, sooner if local handoff is available.`,
    '',
    amount ? `Order total: ${amount}` : '',
    `Dashboard: ${url}`,
    '',
    'REL8TION'
  ].filter((line) => line !== '').join('\n');
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#17224f;line-height:1.55;max-width:620px;margin:0 auto;padding:28px;">
      <img src="https://rel8tion.me/wp-content/uploads/2026/04/logo150x100trans.png" alt="REL8TION" style="height:42px;width:auto;margin-bottom:22px;">
      <h1 style="font-size:30px;line-height:1.05;margin:0 0 12px;color:#172c76;">Welcome to REL8TION.</h1>
      <p style="font-size:18px;font-weight:700;margin:0 0 20px;">You made a smart decision.</p>
      <p>Your Open House Kit payment was received and your setup dashboard is ready.</p>
      <div style="border:1px solid #d9e8f7;border-radius:18px;padding:18px;margin:22px 0;background:#f5fbff;">
        <p style="margin:0 0 10px;font-weight:800;">What to expect</p>
        <p style="margin:0 0 8px;"><strong>Today:</strong> confirm details and select the logo for your Rel8tionChips.</p>
        <p style="margin:0 0 8px;"><strong>${timeline.prep}:</strong> logo review and kit preparation.</p>
        <p style="margin:0;"><strong>By ${timeline.expected}:</strong> expected delivery window, sooner if local handoff is available.</p>
      </div>
      ${amount ? `<p><strong>Order total:</strong> ${amount}</p>` : ''}
      <p><a href="${url}" style="display:inline-block;background:#172c76;color:white;text-decoration:none;border-radius:999px;padding:14px 20px;font-weight:800;">Open Your Kit Dashboard</a></p>
      <p style="color:#59667d;font-size:13px;">This link opens your setup dashboard. Your Rel8tionChip will also connect you back into the REL8TION owner experience once it is live.</p>
    </div>
  `;
  return { subject, text, html };
}

function welcomeSms({ order, url }) {
  const timeline = timelineText(order);
  return [
    'Welcome to REL8TION - smart decision.',
    `Your Open House Kit is in motion. Select/confirm your chip logo here: ${url}`,
    `Expected kit delivery by ${timeline.expected}, sooner if local handoff is available.`
  ].join('\n');
}

async function alreadySent(orderId, channel) {
  const rows = await supabaseRest(
    `open_house_kit_notifications?order_id=eq.${enc(orderId)}&channel=eq.${enc(channel)}&template_key=eq.${WELCOME_TEMPLATE_KEY}&status=eq.sent&select=id&limit=1`
  ).catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

async function logNotification({ orderId, channel, recipient, status, provider, providerMessageId, error, metadata = {} }) {
  await supabaseRest('open_house_kit_notifications', {
    method: 'POST',
    body: JSON.stringify({
      order_id: orderId,
      channel,
      recipient: recipient || null,
      template_key: WELCOME_TEMPLATE_KEY,
      status,
      provider: provider || null,
      provider_message_id: providerMessageId || null,
      error: error ? clean(error, 1000) : null,
      metadata,
      sent_at: status === 'sent' ? new Date().toISOString() : null
    })
  }).catch((logError) => {
    console.error('[open-house-kit] notification log failed', logError);
  });
}

async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  const apiKey = clean(process.env.RESEND_API_KEY, 500);
  if (!apiKey) {
    const error = new Error('RESEND_API_KEY is not configured.');
    error.code = 'email_config_missing';
    throw error;
  }

  const from = clean(process.env.REL8TION_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'REL8TION <onboarding@resend.dev>', 320);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({ from, to, subject, html, text })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.message || data?.error?.message || `Resend failed: ${response.status}`);
    error.payload = data;
    throw error;
  }
  return data;
}

async function sendSms({ to, message, orderId }) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    const error = new Error('Supabase SMS function is not configured.');
    error.code = 'sms_config_missing';
    throw error;
  }
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/send-lead-sms`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      agent_phone: to,
      buyer_phone: to,
      buyer_name: 'REL8TION customer',
      message,
      category: 'event_transactional',
      metadata: {
        mode: 'open_house_kit_welcome',
        order_id: orderId
      }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `SMS send failed: ${response.status}`);
  }
  return data;
}

async function patchWelcomeSummary(order, summary) {
  const patch = {
    welcome_message_last_attempted_at: new Date().toISOString(),
    welcome_message_count: Number(order.welcome_message_count || 0) + 1
  };
  if (summary.email_status) {
    patch.welcome_email_status = summary.email_status;
    patch.welcome_email_error = summary.email_error || null;
    if (summary.email_status === 'sent') patch.welcome_email_sent_at = new Date().toISOString();
  }
  if (summary.sms_status) {
    patch.welcome_sms_status = summary.sms_status;
    patch.welcome_sms_error = summary.sms_error || null;
    if (summary.sms_status === 'sent') patch.welcome_sms_sent_at = new Date().toISOString();
  }
  const rows = await supabaseRest(`open_house_kit_orders?id=eq.${enc(order.id)}&select=*`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  }).catch(() => []);
  return Array.isArray(rows) ? rows[0] || order : order;
}

async function sendWelcomeNotifications({ order, req, baseUrl }) {
  if (!order?.id || !['paid', 'no_payment_required'].includes(order.status)) {
    return { skipped: true, reason: 'order_not_paid' };
  }

  const result = {};
  const origin = baseUrl || baseUrlFromReq(req);

  if (order.email && !(await alreadySent(order.id, 'email'))) {
    const access = await createDashboardAccess(order.id, 'welcome_email', { channel: 'email' });
    const url = dashboardUrl({ baseUrl: origin, orderId: order.id, token: access.token });
    const email = welcomeEmail({ order, url });
    try {
      const sent = await sendEmail({
        to: order.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
        idempotencyKey: `open-house-kit-welcome-${order.id}-email`
      });
      result.email_status = 'sent';
      result.email_provider_id = sent?.id || null;
      await logNotification({
        orderId: order.id,
        channel: 'email',
        recipient: order.email,
        status: 'sent',
        provider: 'resend',
        providerMessageId: sent?.id || null,
        metadata: { dashboard_url: url }
      });
    } catch (error) {
      result.email_status = error.code === 'email_config_missing' ? 'skipped' : 'failed';
      result.email_error = error.message || 'Email send failed.';
      await logNotification({
        orderId: order.id,
        channel: 'email',
        recipient: order.email,
        status: result.email_status,
        provider: 'resend',
        error: result.email_error,
        metadata: { dashboard_url: url }
      });
    }
  }

  const phone = order.phone_normalized || normalizePhone(order.phone);
  if (phone && !(await alreadySent(order.id, 'sms'))) {
    const access = await createDashboardAccess(order.id, 'welcome_sms', { channel: 'sms' });
    const url = dashboardUrl({ baseUrl: origin, orderId: order.id, token: access.token });
    try {
      const sent = await sendSms({
        to: phone,
        message: welcomeSms({ order, url }),
        orderId: order.id
      });
      result.sms_status = 'sent';
      result.sms_provider_id = sent?.sms?.externalId || sent?.sms?.sid || null;
      await logNotification({
        orderId: order.id,
        channel: 'sms',
        recipient: phone,
        status: 'sent',
        provider: sent?.sms?.provider || 'send-lead-sms',
        providerMessageId: result.sms_provider_id,
        metadata: { dashboard_url: url, sms: sent?.sms || null }
      });
    } catch (error) {
      result.sms_status = error.code === 'sms_config_missing' ? 'skipped' : 'failed';
      result.sms_error = error.message || 'SMS send failed.';
      await logNotification({
        orderId: order.id,
        channel: 'sms',
        recipient: phone,
        status: result.sms_status,
        provider: 'send-lead-sms',
        error: result.sms_error,
        metadata: { dashboard_url: url }
      });
    }
  }

  if (Object.keys(result).length) {
    result.order = await patchWelcomeSummary(order, result);
  }
  return result;
}

function publicOrder(order = {}) {
  const metadata = order.metadata && typeof order.metadata === 'object' ? order.metadata : {};
  const websiteBuilderIncluded = String(metadata.website_builder_included || '').toLowerCase() === 'true';
  const websiteBuilderCode = websiteBuilderIncluded && order.stripe_checkout_session_id
    ? websitePromoCodeForSession(order.stripe_checkout_session_id)
    : '';
  return {
    id: order.id,
    status: order.status,
    fulfillment_status: order.fulfillment_status,
    plan: order.plan,
    product: order.product,
    agent_name: order.agent_name,
    brokerage: order.brokerage,
    email: order.email,
    phone: order.phone,
    phone_normalized: order.phone_normalized,
    shipping_name: order.shipping_name,
    address_summary: order.address_summary,
    shipping_city: order.shipping_city,
    shipping_state: order.shipping_state,
    shipping_postal_code: order.shipping_postal_code,
    amount_total: order.amount_total,
    currency: order.currency,
    paid_at: order.paid_at,
    created_at: order.created_at,
    dashboard_secured_at: order.dashboard_secured_at,
    dashboard_password_set_at: order.dashboard_password_set_at,
    dashboard_device_lock_set_at: order.dashboard_device_lock_set_at,
    dashboard_device_lock_label: order.dashboard_device_lock_label,
    logo_choice_status: order.logo_choice_status,
    selected_logo_id: order.selected_logo_id,
    selected_logo_name: order.selected_logo_name,
    selected_logo_url: order.selected_logo_url,
    custom_logo_url: order.custom_logo_url,
    logo_notes: order.logo_notes,
    logo_selected_at: order.logo_selected_at,
    welcome_email_status: order.welcome_email_status,
    welcome_email_sent_at: order.welcome_email_sent_at,
    welcome_sms_status: order.welcome_sms_status,
    welcome_sms_sent_at: order.welcome_sms_sent_at,
    uid: order.uid,
    agent_slug: order.agent_slug,
    promotion: clean(metadata.promotion, 80) || null,
    future_platform_upgrades_included: String(metadata.future_platform_upgrades_included || '').toLowerCase() === 'true',
    website_builder_included: websiteBuilderIncluded,
    website_builder_url: websiteBuilderCode ? websiteBuilderUrlWithCode(websiteBuilderCode) : null
  };
}

module.exports = {
  clean,
  compactAddress,
  createDashboardAccess,
  dashboardUrl,
  baseUrlFromReq,
  buildOrderPayloadFromSession,
  getOrderById,
  isEligibleOpenHouseKitSession,
  isPaidSession,
  loadLogoChoices,
  loginWithPassword,
  normalizePhone,
  parseDataUrl,
  publicOrder,
  selectLogo,
  sendWelcomeNotifications,
  setDashboardPassword,
  uploadLogoObject,
  upsertOpenHouseKitOrder,
  verifyDashboardAccess,
  websiteBuilderUrlWithCode,
  websitePromoCodeForSession
};
