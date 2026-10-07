const STORAGE_KEY = 'rel8tion_host_session';
const PENDING_SIGN_KEY = 'rel8tion_pending_sign_activation';
const SESSION_MAX_AGE_MS = 15 * 60 * 1000;
const PENDING_SIGN_MAX_AGE_MS = 30 * 60 * 1000;

function storageAreas() {
  const areas = [];
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const area = window[name];
      if (area) areas.push(area);
    } catch (_) {}
  }
  return areas;
}

function readStored(key) {
  for (const area of storageAreas()) {
    try {
      const raw = area.getItem(key);
      if (raw) return raw;
    } catch (_) {}
  }
  return null;
}

function writeStored(key, value) {
  for (const area of storageAreas()) {
    try {
      area.setItem(key, value);
      return true;
    } catch (_) {}
  }
  return false;
}

function removeStored(key) {
  for (const area of storageAreas()) {
    try { area.removeItem(key); } catch (_) {}
  }
}

export function saveHostSession(session = {}) {
  const payload = {
    agentSlug: session.agentSlug || '',
    uid: session.uid || '',
    source: session.source || 'unknown',
    selectedOpenHouse: session.selectedOpenHouse || null,
    createdAt: new Date().toISOString()
  };

  if (!payload.agentSlug) return null;

  if (!writeStored(STORAGE_KEY, JSON.stringify(payload))) console.log('saveHostSession skipped: browser storage unavailable');

  return payload;
}

export function getHostSession() {
  try {
    const raw = readStored(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.agentSlug || !parsed?.createdAt) return null;

    const ageMs = Date.now() - new Date(parsed.createdAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs > SESSION_MAX_AGE_MS) {
      clearHostSession();
      return null;
    }

    return parsed;
  } catch (error) {
    console.log('getHostSession skipped', error);
    return null;
  }
}

export function clearHostSession() {
  try {
    removeStored(STORAGE_KEY);
  } catch (error) {
    console.log('clearHostSession skipped', error);
  }
}

export function savePendingSignActivation(sign = {}) {
  const payload = {
    code: sign.code || sign.publicCode || '',
    signId: sign.signId || '',
    inventoryId: sign.inventoryId || '',
    source: sign.source || 'sign-qr',
    createdAt: new Date().toISOString()
  };

  if (!payload.code) return null;

  if (!writeStored(PENDING_SIGN_KEY, JSON.stringify(payload))) console.log('savePendingSignActivation skipped: browser storage unavailable');

  return payload;
}

export function getPendingSignActivation() {
  try {
    const raw = readStored(PENDING_SIGN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.code || !parsed?.createdAt) return null;

    const ageMs = Date.now() - new Date(parsed.createdAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs > PENDING_SIGN_MAX_AGE_MS) {
      clearPendingSignActivation();
      return null;
    }

    return parsed;
  } catch (error) {
    console.log('getPendingSignActivation skipped', error);
    return null;
  }
}

export function clearPendingSignActivation() {
  try {
    removeStored(PENDING_SIGN_KEY);
  } catch (error) {
    console.log('clearPendingSignActivation skipped', error);
  }
}

export function hostSessionLabel(session) {
  if (!session?.agentSlug) return '';
  return session.agentSlug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
