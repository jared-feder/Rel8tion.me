const QRCode = require('qrcode');
const JSZip = require('jszip');
const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');

const MAX_BATCH = 100;

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
function batchId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `agent-qr-${stamp}-${Math.random().toString(36).slice(2, 7)}`;
}
function fileSafe(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-'); }
function qrUrl(row) { return row.qr_url || `https://irel8.me/c/${encodeURIComponent(row.chip_code)}`; }

async function reserveNext(quantity, id) {
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

async function createArchive(rows, id) {
  const zip = new JSZip();
  const imageFolder = zip.folder('images');
  const csvRows = [['sequence', 'chip_code', 'qr_url', 'image_file', 'batch_id', 'printed_at']];

  await Promise.all(rows.map(async (row, index) => {
    const code = fileSafe(row.chip_code);
    const filename = `${code}.png`;
    const url = qrUrl(row);
    const png = await QRCode.toBuffer(url, {
      type: 'png', errorCorrectionLevel: 'H', width: 1024, margin: 4,
      color: { dark: '#000000', light: '#FFFFFF' }
    });
    imageFolder.file(filename, png);
    csvRows.push([index + 1, row.chip_code, url, `images/${filename}`, id, row.printed_at || '']);
  }));

  zip.file('agent-qr-batch.csv', `\uFEFF${csvRows.map((row) => row.map(csv).join(',')).join('\r\n')}\r\n`);
  zip.file('README.txt', [
    'REL8TION Agent Rel8tionChip QR Batch', `Batch: ${id}`, `Codes: ${rows.length}`, '',
    'Each PNG is 1024x1024, black on white, with high QR error correction.',
    'The image_file column in agent-qr-batch.csv exactly matches the PNG inside the images folder.',
    'These QR codes open the public agent-profile resolver. NFC remains the private owner-dashboard path.'
  ].join('\r\n'));
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
    const quantity = Math.floor(Number(parseBody(req).quantity || 1));
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_BATCH) {
      return sendJson(res, 400, { ok: false, error: `Quantity must be between 1 and ${MAX_BATCH}.` });
    }
    const id = batchId();
    const rows = await reserveNext(quantity, id);
    if (!rows.length) return sendJson(res, 409, { ok: false, error: 'No unprinted agent QR codes are available.' });
    const archive = await createArchive(rows, id);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.zip"`);
    res.setHeader('X-REL8TION-Batch-Id', id);
    res.setHeader('X-REL8TION-Code-Count', String(rows.length));
    return res.status(200).send(archive);
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.message || 'Unable to export agent QR batch.' });
  }
};
