const PENDING_CHIP_QR_KEY = 'rel8tion_chip_qr_pending';

export function normalizeChipQrInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let candidate = raw;
  try {
    const url = new URL(raw, window.location.origin);
    const parts = url.pathname.split('/').filter(Boolean);
    candidate = parts[parts.length - 1] || url.searchParams.get('code') || raw;
  } catch (_) {}
  return String(candidate || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

export function readPendingChipQrCode() {
  try {
    const raw = window.localStorage.getItem(PENDING_CHIP_QR_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    const expiresAt = new Date(parsed.expiresAt || 0).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      window.localStorage.removeItem(PENDING_CHIP_QR_KEY);
      return '';
    }
    return normalizeChipQrInput(parsed.chipCode || parsed.code || '');
  } catch (_) {
    window.localStorage.removeItem(PENDING_CHIP_QR_KEY);
    return '';
  }
}

export function clearPendingChipQrCode() {
  try {
    window.localStorage.removeItem(PENDING_CHIP_QR_KEY);
  } catch (_) {}
}

export function readChipQrCodeFromPage() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = normalizeChipQrInput(params.get('chip_code') || params.get('qr_code') || '');
  const fromInput = normalizeChipQrInput(
    document.getElementById('rel8tion_chip_qr_code')?.value
      || document.getElementById('keychain_qr_code')?.value
      || ''
  );
  return fromInput || fromQuery || readPendingChipQrCode();
}

export async function linkChipQrToAgent({ chipCode, agentSlug, uid }) {
  const code = normalizeChipQrInput(chipCode);
  if (!code || !agentSlug || !uid) return null;
  const response = await fetch('/api/chip-qr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'link',
      chip_code: code,
      agent_slug: agentSlug,
      uid
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Unable to link QR code: ${response.status}`);
  }
  clearPendingChipQrCode();
  return data;
}

export async function loadAgentChipQrLinks({ agentSlug, uid }) {
  if (!agentSlug || !uid) return [];
  const url = new URL('/api/chip-qr', window.location.origin);
  url.searchParams.set('action', 'for_agent');
  url.searchParams.set('agent_slug', agentSlug);
  url.searchParams.set('uid', uid);
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) return [];
  return Array.isArray(data.chips) ? data.chips : [];
}
