const QRCode = require('qrcode');
const JSZip = require('jszip');
const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');

const MAX_BATCH = 100;
const INVENTORY_TYPES = Object.freeze({
  agent: {
    label: 'Agent Rel8tionChip',
    batchPrefix: 'agent-qr',
    csvFilename: 'agent-qr-batch.csv',
    emptyError: 'No unprinted agent QR codes are available.'
  },
  event_pass: {
    label: 'Event Pass',
    batchPrefix: 'event-pass-qr',
    csvFilename: 'event-pass-qr-batch.csv',
    emptyError: 'No fresh unprinted Event Pass QR codes are available.'
  }
});

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch (_) { return {}; }
}
function enc(value) { return encodeURIComponent(String(value || '').trim()); }
function csv(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function normalizeInventoryType(value) {
  const normalized = String(value || 'agent').trim().toLowerCase().replace(/-/g, '_');
  return INVENTORY_TYPES[normalized] ? normalized : '';
}
function batchId(inventoryType) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${INVENTORY_TYPES[inventoryType].batchPrefix}-${stamp}-${Math.random().toString(36).slice(2, 7)}`;
}
function fileSafe(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-'); }
function codeValue(row, inventoryType) {
  return inventoryType === 'event_pass' ? row.public_code : row.chip_code;
}
function qrUrl(row, inventoryType) {
  const code = codeValue(row, inventoryType);
  if (inventoryType === 'event_pass') {
    return `https://app.rel8tion.me/pass?code=${encodeURIComponent(code)}`;
  }
  return row.qr_url || `https://irel8.me/c/${encodeURIComponent(code)}`;
}

async function reserveAgents(quantity, id) {
  const candidates = await supabaseRest(
    `rel8tion_chip_inventory?chip_type=eq.agent&status=eq.unassigned&is_printed=eq.false&select=id,chip_code,qr_url,created_at&order=created_at.asc,chip_code.asc&limit=${quantity}`
  );
  const ids = (Array.isArray(candidates) ? candidates : []).map((row) => row.id).filter(Boolean);
  if (!ids.length) return [];
  const now = new Date().toISOString();
  const rows = await supabaseRest(
    `rel8tion_chip_inventory?id=in.(${ids.map(enc).join(',')})&is_printed=eq.false`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ is_printed: true, print_batch_id: id, printed_at: now, updated_at: now })
    }
  );
  return Array.isArray(rows) ? rows.sort((a, b) => String(a.chip_code).localeCompare(String(b.chip_code))) : [];
}

function isFreshEventPass(row) {
  const metadata = row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
  return row?.inventory_type === 'event_pass'
    && row?.is_printed === false
    && !row?.claimed_at
    && !row?.smart_sign_id
    && !row?.assigned_agent_slug
    && !row?.assigned_agent_phone
    && !row?.sponsor_loan_officer_profile_id
    && !row?.sponsor_loan_officer_uid
    && row?.pass_model === 'single_event'
    && row?.sponsor_coverage_required === false
    && row?.sponsor_coverage_consent_required === true
    && row?.reuse_allowed === false
    && row?.reuse_status === 'not_reusable'
    && Object.keys(metadata).length === 0;
}

async function reserveEventPasses(quantity, id) {
  const candidateLimit = Math.min(MAX_BATCH * 3, Math.max(quantity, quantity * 3));
  const candidates = await supabaseRest(
    'smart_sign_inventory?inventory_type=eq.event_pass&is_printed=eq.false&claimed_at=is.null'
    + '&smart_sign_id=is.null&assigned_agent_slug=is.null&assigned_agent_phone=is.null'
    + '&sponsor_loan_officer_profile_id=is.null&sponsor_loan_officer_uid=is.null'
    + '&pass_model=eq.single_event&sponsor_coverage_required=eq.false'
    + '&sponsor_coverage_consent_required=eq.true&reuse_allowed=eq.false&reuse_status=eq.not_reusable'
    + `&select=*&order=created_at.asc,public_code.asc&limit=${candidateLimit}`
  );
  const selected = (Array.isArray(candidates) ? candidates : []).filter(isFreshEventPass).slice(0, quantity);
  if (!selected.length) return [];

  const now = new Date().toISOString();
  const rows = [];
  for (let index = 0; index < selected.length; index += 10) {
    const group = selected.slice(index, index + 10);
    const reserved = await Promise.all(group.map(async (candidate) => {
      const result = await supabaseRest(
        `smart_sign_inventory?id=eq.${enc(candidate.id)}&inventory_type=eq.event_pass&is_printed=eq.false`
        + '&claimed_at=is.null&smart_sign_id=is.null&assigned_agent_slug=is.null&assigned_agent_phone=is.null'
        + '&sponsor_loan_officer_profile_id=is.null&sponsor_loan_officer_uid=is.null'
        + '&pass_model=eq.single_event&sponsor_coverage_required=eq.false'
        + '&sponsor_coverage_consent_required=eq.true&reuse_allowed=eq.false&reuse_status=eq.not_reusable',
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            is_printed: true,
            metadata: {
              ...(candidate.metadata || {}),
              print_batch_id: id,
              printed_at: now,
              print_source: 'admin_qr_batch'
            }
          })
        }
      );
      return Array.isArray(result) && result.length ? result[0] : null;
    }));
    rows.push(...reserved.filter(Boolean));
  }

  return rows
    .map((row) => ({ ...row, printed_at: row.metadata?.printed_at || now }))
    .sort((a, b) => String(a.public_code).localeCompare(String(b.public_code)));
}

async function reserveNext(quantity, id, inventoryType) {
  return inventoryType === 'event_pass'
    ? reserveEventPasses(quantity, id)
    : reserveAgents(quantity, id);
}

async function createArchive(rows, id, inventoryType) {
  const config = INVENTORY_TYPES[inventoryType];
  const zip = new JSZip();
  const imageFolder = zip.folder('images');
  const csvRows = inventoryType === 'event_pass'
    ? [['sequence', 'public_code', 'qr_url', 'image_file', 'batch_id', 'printed_at']]
    : [['sequence', 'chip_code', 'qr_url', 'image_file', 'batch_id', 'printed_at']];

  await Promise.all(rows.map(async (row, index) => {
    const publicCode = codeValue(row, inventoryType);
    const code = fileSafe(publicCode);
    const filename = `${code}.png`;
    const url = qrUrl(row, inventoryType);
    const png = await QRCode.toBuffer(url, {
      type: 'png', errorCorrectionLevel: 'H', width: 1024, margin: 4,
      color: { dark: '#000000', light: '#FFFFFF' }
    });
    imageFolder.file(filename, png);
    csvRows.push([index + 1, publicCode, url, `images/${filename}`, id, row.printed_at || '']);
  }));

  zip.file(config.csvFilename, `\uFEFF${csvRows.map((row) => row.map(csv).join(',')).join('\r\n')}\r\n`);
  const readme = [
    `REL8TION ${config.label} QR Batch`, `Batch: ${id}`, `Codes: ${rows.length}`, '',
    'Each PNG is 1024x1024, black on white, with high QR error correction.',
    `The image_file column in ${config.csvFilename} exactly matches the PNG inside the images folder.`
  ];
  readme.push(inventoryType === 'event_pass'
    ? 'These QR codes open the Event Pass activation flow. Each code is sourced from fresh smart_sign_inventory Event Pass inventory.'
    : 'These QR codes open the public agent-profile resolver. NFC remains the private owner-dashboard path.');
  zip.file('README.txt', readme.join('\r\n'));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }
    assertAdminConfig();
    const auth = adminAuthorized(req);
    if (!auth.ok) return sendJson(res, 401, { ok: false, error: auth.error });
    const body = parseBody(req);
    const inventoryType = normalizeInventoryType(body.inventory_type || body.type || 'agent');
    if (!inventoryType) {
      return sendJson(res, 400, { ok: false, error: 'Inventory type must be agent or event_pass.' });
    }
    const quantity = Math.floor(Number(body.quantity ?? 1));
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_BATCH) {
      return sendJson(res, 400, { ok: false, error: `Quantity must be between 1 and ${MAX_BATCH}.` });
    }
    const id = batchId(inventoryType);
    const rows = await reserveNext(quantity, id, inventoryType);
    if (!rows.length) return sendJson(res, 409, { ok: false, error: INVENTORY_TYPES[inventoryType].emptyError });
    const archive = await createArchive(rows, id, inventoryType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.zip"`);
    res.setHeader('X-REL8TION-Batch-Id', id);
    res.setHeader('X-REL8TION-Code-Count', String(rows.length));
    res.setHeader('X-REL8TION-Inventory-Type', inventoryType);
    return res.status(200).send(archive);
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.message || 'Unable to export QR batch.' });
  }
};
