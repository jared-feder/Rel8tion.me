import { ROUTES } from '../../core/config.js';
import { state, resetDetectionState, setDetectedHouse, setNearbyHouses, setLoaderInterval } from '../../core/state.js';
import { debug, normalizePhoneForMatch, randSuffix, slugify } from '../../core/utils.js';

import { applyBranding } from '../../api/brokerages.js';
import { findNearestOpenHouses } from '../../api/openHouses.js';
import {
  findAgentByEmail,
  findAgentByPhoneNormalized,
  upsertAgent,
  uploadFullProfilePhoto
} from '../../api/agents.js';
import { sendActivationSMS } from '../../api/notifications.js';
import {
  linkKeyToAgent,
  loadAgentFromUID
} from '../../api/keys.js';

import {
  showAlreadyClaimed,
  showDetection,
  showError,
  showForm,
  showFullProfileForm,
  showIntro,
  showLoading,
  showOtherListings,
  showVerifyAgent
} from './renderer.js';

const SIGN_DEMO_SESSION_KEY = 'rel8tion_sign_demo_session';

function getSearchParams() {
  return new URLSearchParams(window.location.search);
}

function isSignDemoMode() {
  return getSearchParams().get('mode') === 'sign-demo';
}

function readSignDemoSession() {
  try {
    const raw = window.localStorage.getItem(SIGN_DEMO_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function redirectToSignDemo(agentSlug) {
  if (!agentSlug) return;
  const params = getSearchParams();
  const next = new URLSearchParams();
  const pending = readSignDemoSession();
  if (state.uid) next.set('uid', state.uid);
  next.set('agent', agentSlug);
  next.set('mode', 'sign-demo');
  if (params.get('code')) next.set('code', params.get('code'));
  else if (pending?.publicCode) next.set('code', pending.publicCode);
  if (params.get('sign_id')) next.set('sign_id', params.get('sign_id'));
  else if (pending?.signId) next.set('sign_id', pending.signId);
  window.location.href = `/sign-demo-activate.html?${next.toString()}`;
}

export function bindPublicHandlers() {
  window.startDetection = startDetection;
  window.skipToForm = skipToForm;
  window.confirmListing = confirmListing;
  window.showOtherListings = showOtherListings;
  window.autoActivate = autoActivate;
  window.activate = activate;
  window.saveFullProfile = saveFullProfile;
  window.init = init;
  window.selectHouse = selectHouse;
  window.showForm = showForm;
  window.showFullProfileForm = showFullProfileForm;
}

export function startLoaderTextCycle() {
  const steps = [
    'Analyzing your location...',
    'Matching nearby listings...',
    'Checking your chip setup...',
    'Preparing your Rel8tion activation...'
  ];
  let i = 0;
  clearInterval(state.loaderInterval);
  const id = setInterval(() => {
    i += 1;
    const el = document.getElementById('loaderText');
    if (!el) return;
    if (i < steps.length) el.textContent = steps[i];
    else clearInterval(id);
  }, 1200);
  setLoaderInterval(id);
}

export function skipToForm() {
  resetDetectionState();
  state.currentBrand = null;
  showForm();
}

export async function startDetection() {
  showLoading('Scanning nearby listings...');
  startLoaderTextCycle();

  if (!navigator.geolocation) {
    showForm('', 'Location detection is not supported on this device.');
    return;
  }

  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      const houses = await findNearestOpenHouses(pos.coords.latitude, pos.coords.longitude);
      if (!Array.isArray(houses) || !houses.length) {
        showForm('', 'No nearby open house was found. Continue manually.');
        return;
      }

      setNearbyHouses(houses);
      setDetectedHouse(houses.find((h) => h.agent || h.agent_phone || h.agent_email) || houses[0]);
      if (state.detectedHouse?.brokerage) await applyBranding(state.detectedHouse.brokerage);
      showDetection();
    } catch (e) {
      debug('DETECTION FAILED', { message: e?.message || String(e) });
      showForm('', 'Detection failed. Continue manually.');
    }
  }, () => {
    showForm('', 'Location permission was denied. Continue manually.');
  }, {
    enableHighAccuracy: true,
    timeout: 20000,
    maximumAge: 0
  });
}

export function selectHouse(id) {
  setDetectedHouse(state.nearbyHouses.find((h) => String(h.id) === String(id)) || null);
  if (state.detectedHouse?.brokerage) applyBranding(state.detectedHouse.brokerage).then(() => showDetection());
  else showDetection();
}

export async function confirmListing() {
  if (!state.detectedHouse) {
    showForm();
    return;
  }
  if (state.detectedHouse.brokerage) await applyBranding(state.detectedHouse.brokerage);
  if (state.detectedHouse.agent || state.detectedHouse.agent_phone || state.detectedHouse.agent_email) showVerifyAgent();
  else showForm(state.detectedHouse.brokerage || '');
}

export async function autoActivate() {
  const h = state.detectedHouse;
  if (!(h?.agent || h?.agent_phone || h?.agent_email)) {
    showForm(h?.brokerage || '');
    return;
  }
  showLoading('Claiming your Rel8tionChip...');
  try {
    let existingAgent = state.prefilledAgent?.slug ? state.prefilledAgent : null;
    const phone_normalized = normalizePhoneForMatch(h.agent_phone);
    if (!existingAgent && phone_normalized) existingAgent = await findAgentByPhoneNormalized(phone_normalized);
    if (!existingAgent && h.agent_email) existingAgent = await findAgentByEmail(h.agent_email);

    const baseSlug = slugify(h.agent || h.agent_email || h.agent_phone || 'agent') || 'agent';
    const slug = existingAgent?.slug || `${baseSlug}-${randSuffix()}`;
    const agent = {
      name: existingAgent?.name || h.agent || 'Agent',
      phone: existingAgent?.phone || h.agent_phone || null,
      phone_normalized: existingAgent?.phone_normalized || phone_normalized || null,
      email: existingAgent?.email || h.agent_email || null,
      brokerage: existingAgent?.brokerage || h.brokerage || null,
      slug,
      image_url: existingAgent?.image_url || state.prefilledAgent?.image_url || null,
      instagram: existingAgent?.instagram || state.prefilledAgent?.instagram || null,
      website: existingAgent?.website || state.prefilledAgent?.website || null,
      facebook: existingAgent?.facebook || state.prefilledAgent?.facebook || null,
      bio: existingAgent?.bio || state.prefilledAgent?.bio || null
    };

    await upsertAgent(agent);
    await linkKeyToAgent(slug);
    await sendActivationSMS(agent.phone, slug, agent.name);
    window.location.href = `${ROUTES.onboarding}?agent=${encodeURIComponent(slug)}`;
  } catch (e) {
    debug('AUTO ACTIVATE FAILED', { message: e?.message || String(e) });
    showForm(h?.brokerage || '', 'Auto-activation failed: ' + (e?.message || 'unknown error'));
  }
}

export async function activate() {
  const name = document.getElementById('name')?.value?.trim() || '';
  const phone = document.getElementById('phone')?.value?.trim() || '';
  if (!name || !phone) {
    alert('Complete name and phone number.');
    return;
  }
  showLoading('Activating your profile...');
  try {
    const brokerage = state.detectedHouse?.brokerage || state.currentBrand?.name || state.prefilledAgent?.brokerage || null;
    const phone_normalized = normalizePhoneForMatch(phone);
    let existingAgent = state.prefilledAgent?.slug ? state.prefilledAgent : null;
    if (!existingAgent && phone_normalized) existingAgent = await findAgentByPhoneNormalized(phone_normalized);

    const slug = existingAgent?.slug || `${slugify(name) || 'agent'}-${randSuffix()}`;
    const agent = {
      name,
      phone,
      phone_normalized,
      email: existingAgent?.email || state.prefilledAgent?.email || null,
      brokerage: existingAgent?.brokerage || brokerage,
      slug,
      image_url: existingAgent?.image_url || state.prefilledAgent?.image_url || null,
      instagram: existingAgent?.instagram || state.prefilledAgent?.instagram || null,
      website: existingAgent?.website || state.prefilledAgent?.website || null,
      facebook: existingAgent?.facebook || state.prefilledAgent?.facebook || null,
      bio: existingAgent?.bio || state.prefilledAgent?.bio || null
    };
    await upsertAgent(agent);
    await linkKeyToAgent(slug);
    await sendActivationSMS(phone, slug, name);
    window.location.href = `${ROUTES.onboarding}?agent=${encodeURIComponent(slug)}`;
  } catch (e) {
    debug('ACTIVATE FAILED', { message: e?.message || String(e) });
    showForm(state.detectedHouse?.brokerage || '', 'Activation failed: ' + (e?.message || 'unknown error'));
  }
}

export async function saveFullProfile() {
  const name = document.getElementById('full_name')?.value?.trim() || '';
  const phone = document.getElementById('full_phone')?.value?.trim() || '';
  const phone_normalized = normalizePhoneForMatch(phone);
  const email = document.getElementById('full_email')?.value?.trim() || '';
  const brokerage = document.getElementById('full_brokerage')?.value?.trim() || '';
  const instagram = document.getElementById('full_instagram')?.value?.trim() || '';
  const website = document.getElementById('full_website')?.value?.trim() || '';
  const facebook = document.getElementById('full_facebook')?.value?.trim() || '';
  const bio = document.getElementById('full_bio')?.value?.trim() || '';

  if (!name || !phone) {
    alert('Name and phone are required.');
    return;
  }

  showLoading('Saving full profile...');
  try {
    const slug = state.prefilledAgent?.slug || `${slugify(name) || 'agent'}-${randSuffix()}`;
    const image_url = await uploadFullProfilePhoto(slug);
    const agent = { name, phone, phone_normalized, brokerage: brokerage || null, slug, image_url: image_url || null, instagram: instagram || null, website: website || null, email: email || null, facebook: facebook || null, bio: bio || null };
    await upsertAgent(agent);
    await linkKeyToAgent(slug);
    await sendActivationSMS(phone, slug, name);
    window.location.href = `${ROUTES.onboarding}?agent=${encodeURIComponent(slug)}`;
  } catch (e) {
    debug('SAVE FULL PROFILE FAILED', { message: e?.message || String(e) });
    showFullProfileForm(document.getElementById('full_brokerage')?.value?.trim() || state.detectedHouse?.brokerage || '', 'Saving full profile failed: ' + (e?.message || 'unknown error'));
  }
}

export async function init() {
  showLoading('Checking your Rel8tion chip...');
  startLoaderTextCycle();
  if (!state.uid) {
    showError('Invalid Key', 'This claim page is missing a chip uid in the URL.');
    return;
  }
  try {
    await loadAgentFromUID();
    if (state.keyRecord?.claimed === true && state.keyRecord?.agent_slug) {
      const claimedSlug = state.prefilledAgent?.slug || state.keyRecord.agent_slug;
      if (isSignDemoMode()) {
        redirectToSignDemo(claimedSlug);
        return;
      }
      if (state.prefilledAgent) showAlreadyClaimed(state.prefilledAgent);
      else window.location.href = `${ROUTES.onboarding}?agent=${encodeURIComponent(state.keyRecord.agent_slug)}`;
    } else {
      showIntro();
    }
  } catch (e) {
    debug('INIT FAILED', { message: e?.message || String(e) });
    showIntro();
  }
}
