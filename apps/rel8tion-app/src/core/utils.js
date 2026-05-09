export function debug(msg, data = null) {
  console.log('DEBUG:', msg, data || '');
}

export function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function randSuffix() {
  return Math.random().toString(36).slice(2, 5);
}

export function normalizePhone(v) {
  const digits = String(v || '').replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return v || '';
}

export function normalizePhoneForMatch(v) {
  let digits = String(v || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }
  return digits;
}

export function money(v) {
  const n = Number(v || 0);
  if (!n) return '';
  return '$' + n.toLocaleString();
}

export function getStatus(h) {
  try {
    const now = new Date();
    const start = h?.open_start ? new Date(h.open_start) : null;
    const end = h?.open_end ? new Date(h.open_end) : null;

    if (start && end && now >= start && now <= end) {
      return { label: 'LIVE NOW', color: '#16a34a', icon: 'LIVE NOW' };
    }
    if (start && now < start) {
      return { label: 'UPCOMING', color: '#2563eb', icon: 'UPCOMING' };
    }
    return { label: 'ENDED', color: '#6b7280', icon: 'ENDED' };
  } catch {
    return { label: 'OPEN HOUSE', color: '#2563eb', icon: 'OPEN HOUSE' };
  }
}

export function jsonHeaders(key) {
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: 'Bearer ' + key
  };
}

export function authHeaders(key) {
  return {
    apikey: key,
    Authorization: 'Bearer ' + key
  };
}
