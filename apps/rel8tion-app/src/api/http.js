import { debug } from '../core/utils.js';

export async function fetchJson(url, options = {}) {
  debug('FETCH', { url, method: options.method || 'GET' });

  const res = await fetch(url, options);
  const raw = await res.text().catch(() => '');

  debug('FETCH RESPONSE', { url, status: res.status, ok: res.ok, raw });

  if (!res.ok) {
    throw new Error(raw || `Request failed: ${res.status}`);
  }

  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error('Invalid JSON response: ' + raw);
  }
}
