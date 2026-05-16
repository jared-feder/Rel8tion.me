const STORAGE_KEY = 'rel8tion_host_session';
const PENDING_SIGN_KEY = 'rel8tion_pending_sign_activation';
const SESSION_MAX_AGE_MS = 15 * 60 * 1000;
const PENDING_SIGN_MAX_AGE_MS = 30 * 60 * 1000;

export function saveHostSession(session = {}) {
  const payload = {
    agentSlug: session.agentSlug || '',
    uid: session.uid || '',
    source: session.source || 'unknown',
    selectedOpenHouse: session.selectedOpenHouse || null,
    createdAt: new Date().toISOString()
  };

  if (!payload.agentSlug) return null;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.log('saveHostSession skipped', error);
  }

  return payload;
}

export function getHostSession() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
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
    window.localStorage.removeItem(STORAGE_KEY);
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

  try {
    window.localStorage.setItem(PENDING_SIGN_KEY, JSON.stringify(payload));
  } catch (error) {
    console.log('savePendingSignActivation skipped', error);
  }

  return payload;
}

export function getPendingSignActivation() {
  try {
    const raw = window.localStorage.getItem(PENDING_SIGN_KEY);
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
    window.localStorage.removeItem(PENDING_SIGN_KEY);
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
