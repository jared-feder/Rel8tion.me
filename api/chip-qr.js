const { sendJson, supabaseRest } = require('../lib/admin-auth');

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

function enc(value) {
  return encodeURIComponent(String(value || '').trim());
}

function clean(value) {
  return String(value || '').trim();
}

function cleanCode(value) {
  const raw = clean(value);
  if (!raw) return '';
  let candidate = raw;
  try {
    const url = new URL(raw, 'https://irel8.me');
    const parts = url.pathname.split('/').filter(Boolean);
    candidate = parts[parts.length - 1] || url.searchParams.get('code') || raw;
  } catch (_) {}
  return String(candidate || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function list(path) {
  const rows = await supabaseRest(path);
  return Array.isArray(rows) ? rows : [];
}

async function one(path) {
  const rows = await list(`${path}${path.includes('?') ? '&' : '?'}limit=1`);
  return rows[0] || null;
}

function wantsJson(req) {
  const accept = String(req.headers?.accept || '').toLowerCase();
  const url = new URL(req.url || '', 'https://rel8tion.local');
  return accept.includes('application/json') || url.searchParams.get('format') === 'json';
}

function htmlShell({ title, eyebrow = 'Rel8tionChip QR', body, action = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&family=Plus+Jakarta+Sans:wght@800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:Inter,system-ui,sans-serif;color:#17224f;background:radial-gradient(circle at 15% 8%,rgba(255,255,255,.86) 0 12%,transparent 24%),linear-gradient(180deg,#58d1f8 0%,#eefaff 54%,#f8fbff 100%);display:grid;place-items:center;padding:22px}
    .card{width:min(560px,100%);border:1px solid rgba(255,255,255,.74);background:rgba(255,255,255,.62);box-shadow:0 26px 70px rgba(23,34,79,.16);backdrop-filter:blur(18px);border-radius:34px;padding:30px;text-align:center}
    img{height:58px;width:auto;margin-bottom:24px}.eyebrow{display:inline-flex;border:1px solid rgba(23,44,118,.1);background:rgba(255,255,255,.72);border-radius:999px;padding:9px 12px;font-size:11px;font-weight:900;letter-spacing:.13em;text-transform:uppercase;color:#51627d}
    h1{font-family:"Plus Jakarta Sans",Inter,sans-serif;font-size:clamp(34px,8vw,56px);line-height:.96;margin:18px 0 12px;color:#172c76;letter-spacing:0}p{font-size:16px;line-height:1.55;font-weight:700;color:#51627d;margin:0 auto 16px;max-width:440px}
    .btn{display:inline-flex;align-items:center;justify-content:center;min-height:52px;border-radius:999px;background:#172c76;color:white;text-decoration:none;font-weight:900;padding:13px 20px;margin-top:12px;box-shadow:0 16px 30px rgba(23,44,118,.18)}
    .soft{background:rgba(255,255,255,.8);color:#172c76;border:1px solid rgba(23,44,118,.12);box-shadow:none}
    .code{margin:18px auto 0;display:inline-flex;border-radius:16px;background:rgba(255,255,255,.74);border:1px solid rgba(23,44,118,.08);padding:10px 12px;font-weight:900;color:#172c76}
  </style>
</head>
<body>
  <main class="card">
    <img src="https://rel8tion.me/wp-content/uploads/2026/04/logo150x100trans.png" alt="Rel8tion">
    <div class="eyebrow">${eyebrow}</div>
    <h1>${title}</h1>
    ${body}
    ${action}
  </main>
</body>
</html>`;
}

function sendHtml(res, status, html) {
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

async function loadChip(code) {
  return one(`rel8tion_chip_inventory?chip_code=eq.${enc(code)}&select=*`);
}

async function validateClaimedAgentKey({ uid, agentSlug }) {
  if (!uid || !agentSlug) {
    const error = new Error('Missing UID or agent slug.');
    error.status = 400;
    throw error;
  }
  const key = await one(
    `keys?uid=eq.${enc(uid)}&agent_slug=eq.${enc(agentSlug)}&claimed=eq.true&select=uid,agent_slug,claimed,device_role,assigned_slot`
  );
  if (!key?.uid) {
    const error = new Error('This QR can only be linked from the claimed chip owner dashboard or claim flow.');
    error.status = 403;
    throw error;
  }
  return key;
}

async function loadAgent(agentSlug) {
  return one(`agents?slug=eq.${enc(agentSlug)}&select=slug,name,brokerage,phone,email`);
}

function isVerifiedProfileQr(chip) {
  return ['loan_officer', 'nmb', 'verified', 'professional'].includes(String(chip?.chip_type || '').toLowerCase());
}

async function loadVerifiedProfileByUid(uid) {
  if (!uid) return null;
  return one(`verified_profiles?uid=eq.${enc(uid)}&is_active=eq.true&select=uid,slug,full_name,title,company_name,phone,email,is_active`);
}

async function resolveVerifiedProfile(chip) {
  return loadVerifiedProfileByUid(chip?.verified_profile_uid || chip?.uid);
}

async function linkChip(body) {
  const chipCode = cleanCode(body.chip_code || body.code || body.qr_code);
  const uid = clean(body.uid);
  const agentSlug = clean(body.agent_slug || body.agent);
  if (!chipCode) {
    const error = new Error('Missing Rel8tionChip QR code.');
    error.status = 400;
    throw error;
  }

  await validateClaimedAgentKey({ uid, agentSlug });
  const [chip, agent] = await Promise.all([loadChip(chipCode), loadAgent(agentSlug)]);
  if (!chip?.id) {
    const error = new Error('That Rel8tionChip QR code was not found.');
    error.status = 404;
    throw error;
  }
  if (['disabled', 'retired'].includes(chip.status)) {
    const error = new Error('That Rel8tionChip QR code is not available.');
    error.status = 409;
    throw error;
  }
  if (chip.agent_slug && chip.agent_slug !== agentSlug) {
    const error = new Error('That Rel8tionChip QR code is already linked to another profile.');
    error.status = 409;
    throw error;
  }
  if (chip.uid && chip.uid !== uid) {
    const error = new Error('That Rel8tionChip QR code is already linked to another NFC chip.');
    error.status = 409;
    throw error;
  }

  const now = new Date().toISOString();
  const rows = await supabaseRest(`rel8tion_chip_inventory?id=eq.${enc(chip.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      uid,
      agent_slug: agentSlug,
      company_slug: slugify(agent?.brokerage || body.company_slug || ''),
      chip_type: chip.chip_type || 'agent',
      qr_url: chip.qr_url || `https://irel8.me/c/${chipCode}`,
      status: 'linked',
      claimed_at: chip.claimed_at || now,
      linked_at: chip.linked_at || now
    })
  });
  const linked = Array.isArray(rows) ? rows[0] || null : null;
  return {
    chip: linked,
    public_url: `https://irel8.me/c/${chipCode}`,
    profile_url: `/b?agent=${encodeURIComponent(agentSlug)}`
  };
}

async function listForAgent(query) {
  const uid = clean(query.uid);
  const agentSlug = clean(query.agent_slug || query.agent);
  await validateClaimedAgentKey({ uid, agentSlug });
  const rows = await list(
    `rel8tion_chip_inventory?or=(uid.eq.${enc(uid)},agent_slug.eq.${enc(agentSlug)})&select=*&order=linked_at.desc.nullslast,created_at.desc&limit=20`
  );
  return { chips: rows };
}

async function renderPublicQr(req, res, code) {
  const chipCode = cleanCode(code);
  if (!chipCode) {
    sendHtml(res, 400, htmlShell({
      title: 'Missing QR Code',
      body: '<p>This Rel8tionChip QR link is missing its code.</p>'
    }));
    return;
  }

  const chip = await loadChip(chipCode);
  if (!chip?.id) {
    if (wantsJson(req)) {
      sendJson(res, 404, { ok: false, error: 'Rel8tionChip QR code not found.' });
      return;
    }
    sendHtml(res, 404, htmlShell({
      title: 'QR Code Not Found',
      body: '<p>This Rel8tionChip QR code is not in the active inventory yet.</p>',
      action: `<div class="code">${chipCode}</div>`
    }));
    return;
  }

  await supabaseRest(`rel8tion_chip_inventory?id=eq.${enc(chip.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ last_scanned_at: new Date().toISOString() })
  }).catch(() => null);

  if (chip.status === 'linked' && chip.agent_slug) {
    if (wantsJson(req)) {
      sendJson(res, 200, {
        ok: true,
        chip,
        profile_url: `/b?agent=${encodeURIComponent(chip.agent_slug)}`
      });
      return;
    }
    res.writeHead(302, {
      Location: `/b?agent=${encodeURIComponent(chip.agent_slug)}&chip_code=${encodeURIComponent(chipCode)}`
    });
    res.end();
    return;
  }

  if (chip.status === 'linked' && isVerifiedProfileQr(chip)) {
    const profile = await resolveVerifiedProfile(chip);
    if (profile?.slug) {
      const profileUrl = `/nmb-verified?slug=${encodeURIComponent(profile.slug)}&chip_code=${encodeURIComponent(chipCode)}`;
      if (wantsJson(req)) {
        sendJson(res, 200, {
          ok: true,
          chip,
          verified_profile: profile,
          profile_url: profileUrl
        });
        return;
      }
      res.writeHead(302, { Location: profileUrl });
      res.end();
      return;
    }

    if (wantsJson(req)) {
      sendJson(res, 409, { ok: false, error: 'This loan officer QR is linked, but its public profile is not active.' });
      return;
    }
    sendHtml(res, 409, htmlShell({
      title: 'Profile Needs Attention',
      eyebrow: 'Loan Officer QR',
      body: '<p>This loan officer QR is linked, but the public profile is not active yet. Open the owner dashboard or contact Rel8tion to finish setup.</p>',
      action: `<div class="code">${chipCode}</div>`
    }));
    return;
  }

  if (wantsJson(req)) {
    sendJson(res, 200, { ok: true, chip, linked: false });
    return;
  }

  if (isVerifiedProfileQr(chip)) {
    sendHtml(res, 200, htmlShell({
      title: 'Loan Officer QR Ready',
      eyebrow: 'Loan Officer QR',
      body: `<p>This QR code is ready, but it has not been connected to a verified loan officer profile yet.</p><p>Tap the NFC side of the loan officer Rel8tionChip to open the private dashboard, then link this public QR.</p>`,
      action: `<div class="code">${chipCode}</div><a class="btn soft" href="/nmb-activate?chip_code=${encodeURIComponent(chipCode)}">Open Loan Officer Setup</a><script>try{localStorage.setItem('rel8tion_lo_chip_qr_pending',JSON.stringify({purpose:'loan_officer_chip_qr_link',chipCode:${JSON.stringify(chipCode)},startedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+10*60*1000).toISOString(),sourceHost:location.host,sourcePath:location.pathname}));}catch(e){}</script>`
    }));
    return;
  }

  sendHtml(res, 200, htmlShell({
    title: 'Rel8tionChip Not Linked Yet',
    body: `<p>This QR code is ready, but it has not been connected to an agent profile yet.</p><p>Tap the NFC side of this same Rel8tionChip to activate the owner dashboard, then choose Link My Keychain QR.</p>`,
    action: `<div class="code">${chipCode}</div><a class="btn soft" href="/claim?chip_code=${encodeURIComponent(chipCode)}">Open Claim Flow</a><script>try{localStorage.setItem('rel8tion_chip_qr_pending',JSON.stringify({purpose:'rel8tion_chip_qr_link',chipCode:${JSON.stringify(chipCode)},startedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+10*60*1000).toISOString(),sourceHost:location.host,sourcePath:location.pathname}));}catch(e){}</script>`
  }));
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url || '', 'https://rel8tion.local');

    if (req.method === 'GET') {
      const action = clean(url.searchParams.get('action'));
      if (action === 'for_agent') {
        sendJson(res, 200, { ok: true, ...(await listForAgent(Object.fromEntries(url.searchParams.entries()))) });
        return;
      }
      await renderPublicQr(req, res, url.searchParams.get('code') || url.searchParams.get('id'));
      return;
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    const body = parseBody(req);
    const action = clean(body.action || 'link');
    if (action !== 'link') {
      sendJson(res, 400, { ok: false, error: 'Unsupported chip QR action.' });
      return;
    }

    sendJson(res, 200, { ok: true, ...(await linkChip(body)) });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Rel8tionChip QR request failed.',
      details: error.payload || null
    });
  }
};
