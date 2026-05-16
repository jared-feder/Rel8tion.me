import { ROUTES } from '../../core/config.js';
import {
  resetDetectionState,
  setDetectedAgentPhoto,
  setDetectedHouse,
  setLoaderInterval,
  setManuallyEnteredProfile,
  setNearbyHouses,
  setPrefilledAgent,
  setSelectedBrokerage,
  state
} from '../../core/state.js';
import { debug, normalizePhoneForMatch, randSuffix, slugify } from '../../core/utils.js';
import { applyBranding } from '../../api/brokerages.js';
import { findNearestOpenHouses, searchOpenHouses } from '../../api/openHouses.js';
import {
  findAgentByEmail,
  findAgentByPhoneNormalized,
  getAgentBySlug,
  findListingAgentPhoto,
  findListingAgentProfile,
  findListingAgentsByOpenHouse,
  isGenericAgentNameValue,
  upsertAgent,
  uploadFullProfilePhoto
} from '../../api/agents.js?v=20260511-agent-labels';
import { sendActivationSMS } from '../../api/notifications.js';
import { linkKeyToAgent, loadAgentFromUID } from '../../api/keys.js';
import {
  clearHostSession,
  clearPendingSignActivation,
  getPendingSignActivation,
  saveHostSession
} from '../../core/hostSession.js?v=20260426-1108';
import {
  showAlreadyClaimed,
  showBetaClaimMenu,
  showBrokerageStep,
  showDetection,
  showError,
  showForm,
  showFullProfileForm,
  showIntro,
  showMissingChipNotice,
  showLoading,
  showListingSearch,
  showOtherListings,
  showVerifyAgent
} from './renderer.js?v=20260509-agent-name';

const BETA_KEYCHAIN_UID = '7ce5a51b-8202-4178-afc7-40a2e10e2a4d';
const BETA_AGENT_SLUG = 'main-beta';
const RESET_TOKEN_KEY = 'rel8tion_key_reset_admin_token';

function onboardingRoute(slug) {
  const url = new URL(ROUTES.onboarding, window.location.origin);
  url.searchParams.set('agent', slug);
  if (state.uid) {
    url.searchParams.set('uid', state.uid);
  }
  return `${url.pathname}${url.search}`;
}

function isBetaKeychain() {
  return state.uid === BETA_KEYCHAIN_UID;
}

function hasLockedProfileIdentity() {
  return Boolean(
    state.prefilledAgent?.slug
      && (
        state.manuallyEnteredProfile
        || (isBetaKeychain() && !isGeneratedGenericAgent(state.prefilledAgent))
      )
  );
}

function clearBetaBrowserSignState() {
  clearHostSession();
  clearPendingSignActivation();
  try {
    window.localStorage.removeItem('rel8tion_sign_demo_session');
    window.localStorage.removeItem('rel8tion_agent_dashboard_pending');
    window.localStorage.removeItem('rel8tion_loan_officer_pending');
  } catch (_) {}
}

function getResetAdminToken() {
  let token = '';
  try {
    token = window.localStorage.getItem(RESET_TOKEN_KEY) || '';
  } catch (_) {}
  if (!token) {
    token = window.prompt('Enter the beta reset admin code') || '';
    if (token) {
      try { window.localStorage.setItem(RESET_TOKEN_KEY, token); } catch (_) {}
    }
  }
  return token.trim();
}

async function betaResetApi(action) {
  const token = getResetAdminToken();
  if (!token) throw new Error('Missing beta reset admin code.');

  const res = await fetch('/api/admin/reset-key', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': token
    },
    body: JSON.stringify({
      uid: BETA_KEYCHAIN_UID,
      action
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    if (res.status === 401) {
      try { window.localStorage.removeItem(RESET_TOKEN_KEY); } catch (_) {}
    }
    throw new Error(data.error || `Beta reset request failed: ${res.status}`);
  }
  return data;
}

function routeAfterVerifiedAgent(slug, source = 'claim') {
  const h = state.detectedHouse || null;
  saveHostSession({
    agentSlug: slug,
    uid: state.uid || '',
    source,
    selectedOpenHouse: h?.id ? {
      id: h.id,
      address: h.address || '',
      brokerage: h.brokerage || '',
      price: h.price || null,
      beds: h.beds || null,
      baths: h.baths || null,
      sqft: h.sqft || h.square_feet || null,
      square_feet: h.square_feet || h.sqft || null,
      image: h.image || h.image_url || '',
      image_url: h.image_url || h.image || '',
      open_start: h.open_start || null,
      open_end: h.open_end || null,
      lat: h.lat || null,
      lng: h.lng || null
    } : null
  });

  const pendingSign = getPendingSignActivation();
  if (pendingSign?.code) {
    clearPendingSignActivation();
    const url = new URL('/sign-demo-activate.html', window.location.origin);
    url.searchParams.set('code', pendingSign.code);
    url.searchParams.set('uid', state.uid || '');
    url.searchParams.set('agent', slug);
    if (pendingSign.source === 'event_pass') {
      url.searchParams.set('source', 'event_pass');
      url.searchParams.set('fresh_qr', '1');
    }
    return `${url.pathname}${url.search}`;
  }

  return onboardingRoute(slug);
}

export function bindPublicHandlers() {
  window.startFieldFlow = startFieldFlow;
  window.startOfficeFlow = startOfficeFlow;
  window.startDetection = startDetection;
  window.skipToForm = startOfficeFlow;
  window.routeUnknownAgentFlow = routeUnknownAgentFlow;
  window.continueFromBrokerageStep = continueFromBrokerageStep;
  window.confirmListing = confirmListing;
  window.showOtherListings = showOtherListings;
  window.showListingSearch = showListingSearch;
  window.searchListingByQuery = searchListingByQuery;
  window.autoActivate = autoActivate;
  window.saveFullProfile = saveFullProfile;
  window.init = init;
  window.selectHouse = selectHouse;
  window.selectAgentByEncoded = selectAgentByEncoded;
  window.editDetectedProfile = editDetectedProfile;
  window.showForm = showForm;
  window.showBrokerageStep = showBrokerageStep;
  window.showFullProfileForm = showFullProfileForm;
  window.startBetaClaimTest = startBetaClaimTest;
  window.continueBetaClaim = continueBetaClaim;
  window.resetLastBetaTrial = resetLastBetaTrial;
  window.restoreBetaKeychain = restoreBetaKeychain;
}

export function editDetectedProfile() {
  showFullProfileForm(
    state.detectedHouse?.brokerage || state.prefilledAgent?.brokerage || '',
    'Update or complete your profile below.'
  );
}

function startLoaderTextCycle() {
  const steps = [
    'Checking your setup...',
    'Matching branding...',
    'Preparing your profile...'
  ];
  let i = 0;
  clearInterval(state.loaderInterval);
  const id = setInterval(() => {
    i += 1;
    const el = document.getElementById('loaderText');
    if (!el) return;
    if (i < steps.length) el.textContent = steps[i];
    else clearInterval(id);
  }, 1100);
  setLoaderInterval(id);
}

export function startFieldFlow() {
  return startDetection();
}

export function startOfficeFlow() {
  resetDetectionState();
  setSelectedBrokerage('');
  showBrokerageStep('Choose your brokerage to continue.');
}

export async function startBetaClaimTest() {
  if (!isBetaKeychain()) return;
  const shouldReset = window.confirm('Reset the last beta trial first?\n\nThis restores the keychain to Main Beta and clears the beta sign, listing event, and activation session so the next run behaves fresh.');
  if (!shouldReset) return;
  showLoading('Resetting beta trial...');
  try {
    await resetLastBetaTrial({ renderMenu: false });
    resetDetectionState();
    setSelectedBrokerage('');
    setPrefilledAgent(null);
    setManuallyEnteredProfile(false);
    showIntro('Beta fresh-claim mode is on. The beta keychain and beta sign will behave like a new activation for this test run.');
  } catch (e) {
    debug('START BETA CLAIM TEST FAILED', { message: e?.message || String(e) });
    showBetaClaimMenu(state.prefilledAgent || { slug: state.keyRecord?.agent_slug || BETA_AGENT_SLUG }, 'Could not reset the last beta trial. Try again before starting the fresh test.');
  }
}

export function continueBetaClaim() {
  const slug = state.keyRecord?.agent_slug || BETA_AGENT_SLUG;
  window.location.href = routeAfterVerifiedAgent(slug, 'beta-current-claim');
}

export async function resetLastBetaTrial({ renderMenu = true } = {}) {
  if (!isBetaKeychain()) return null;
  clearBetaBrowserSignState();
  resetDetectionState();
  setSelectedBrokerage('');
  setManuallyEnteredProfile(false);
  if (renderMenu) showLoading('Resetting last beta trial...');

  const result = await betaResetApi('reset_beta_lane');
  await loadAgentFromUID();
  const agent = await getAgentBySlug(BETA_AGENT_SLUG);
  setPrefilledAgent(agent || {
    slug: BETA_AGENT_SLUG,
    name: 'Main Beta',
    brokerage: 'Rel8tion Beta'
  });

  if (renderMenu) {
    showBetaClaimMenu(state.prefilledAgent, 'Last beta trial was cleared. The keychain is back to Main Beta and the beta sign is fresh.');
  }

  return result?.changed?.restoredKey || state.keyRecord;
}

export async function restoreBetaKeychain() {
  if (!isBetaKeychain()) return;
  showLoading('Restoring Main Beta...');
  try {
    const result = await betaResetApi('restore_beta_keychain');
    await loadAgentFromUID();
    const agent = await getAgentBySlug(BETA_AGENT_SLUG);
    setPrefilledAgent(agent || {
      slug: BETA_AGENT_SLUG,
      name: 'Main Beta',
      brokerage: 'Rel8tion Beta'
    });
    setManuallyEnteredProfile(false);
    showBetaClaimMenu(state.prefilledAgent, `Restored this keychain to ${result?.changed?.agent_slug || BETA_AGENT_SLUG}.`);
  } catch (e) {
    debug('RESTORE BETA KEYCHAIN FAILED', { message: e?.message || String(e) });
    showBetaClaimMenu(state.prefilledAgent || { slug: state.keyRecord?.agent_slug || BETA_AGENT_SLUG }, 'Could not restore Main Beta. Try again.');
  }
}

export function routeUnknownAgentFlow(brokerage = '', notice = '') {
  const cleanBrokerage = String(brokerage || '').trim();
  if (cleanBrokerage) {
    setSelectedBrokerage(cleanBrokerage);
    applyBranding(cleanBrokerage).then(() => {
      showFullProfileForm(cleanBrokerage, notice || 'Complete your profile to activate your Rel8tionchip.');
    });
    return;
  }

  setSelectedBrokerage('');
  showBrokerageStep(notice || 'Select your brokerage to continue.');
}

export async function continueFromBrokerageStep() {
  const select = document.getElementById('brokerage_step_select');
  const custom = document.getElementById('brokerage_step_custom');
  const selected = select?.value || '';
  const customValue = custom?.value?.trim() || '';
  const brokerage = selected === '__other__' ? customValue : selected;

  if (!brokerage) {
    alert('Select your brokerage to continue.');
    return;
  }

  setSelectedBrokerage(brokerage);
  await applyBranding(brokerage);
  showFullProfileForm(brokerage, 'Complete your profile to activate your Rel8tionchip.');
}

export async function startDetection() {
  showLoading('Preparing your setup');
  startLoaderTextCycle();

  if (!navigator.geolocation) {
    routeUnknownAgentFlow('', 'Location is not supported on this device. Continue manually.');
    return;
  }

  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      const houses = await findNearestOpenHouses(pos.coords.latitude, pos.coords.longitude);
      if (!Array.isArray(houses) || !houses.length) {
        routeUnknownAgentFlow('', 'No nearby listing found. Continue manually.');
        return;
      }

      setNearbyHouses(houses);
      setDetectedHouse(houses.find((h) => h.agent || h.agent_phone || h.agent_email) || houses[0]);
      if (state.detectedHouse?.brokerage) {
        setSelectedBrokerage(state.detectedHouse.brokerage);
        await applyBranding(state.detectedHouse.brokerage);
      }
      showDetection();
    } catch (e) {
      debug('DETECTION FAILED', { message: e?.message || String(e) });
      routeUnknownAgentFlow('', 'Detection failed. Continue manually.');
    }
  }, () => {
    routeUnknownAgentFlow('', 'Location permission was denied. Continue manually.');
  }, {
    enableHighAccuracy: true,
    timeout: 20000,
    maximumAge: 0
  });
}

export function selectHouse(id) {
  setDetectedHouse(state.nearbyHouses.find((h) => String(h.id) === String(id)) || null);
  if (state.detectedHouse?.brokerage) {
    setSelectedBrokerage(state.detectedHouse.brokerage);
    applyBranding(state.detectedHouse.brokerage).then(() => showDetection());
  } else {
    showDetection();
  }
}

export async function searchListingByQuery() {
  const input = document.getElementById('listing_search_input');
  const query = input?.value?.trim() || '';

  if (!query) {
    showListingSearch('Enter an address or MLS/source ID first.');
    return;
  }

  showLoading('Searching listings...');

  try {
    const houses = await searchOpenHouses(query);
    if (!Array.isArray(houses) || !houses.length) {
      showListingSearch('No matching listing found. Try another address, MLS/source ID, or continue manually.');
      return;
    }

    setNearbyHouses(houses);
    setDetectedHouse(houses.find((h) => h.agent || h.agent_phone || h.agent_email) || houses[0]);
    if (state.detectedHouse?.brokerage) {
      setSelectedBrokerage(state.detectedHouse.brokerage);
      await applyBranding(state.detectedHouse.brokerage);
    }
    showOtherListings();
  } catch (e) {
    debug('LISTING SEARCH FAILED', { message: e?.message || String(e) });
    showListingSearch('Search failed. Try another address, MLS/source ID, or continue manually.');
  }
}

async function showAgentSelection() {
  const h = state.detectedHouse;
  if (!h) return;

  if (hasLockedProfileIdentity()) {
    showVerifyAgent();
    return;
  }

  try {
    const agents = await findListingAgentsByOpenHouse(h.id);

    if (!agents.length) {
      const listingProfile = await findListingAgentProfile({
        openHouseId: h?.id || '',
        name: h?.agent || '',
        phone: h?.agent_phone || ''
      }).catch(() => null);
      const profilePhoto = listingProfile?.primary_photo_url
        || listingProfile?.directory_photo_url
        || await findListingAgentPhoto({
          openHouseId: h?.id || '',
          name: h?.agent || '',
          phone: h?.agent_phone || ''
        });
      setDetectedAgentPhoto(profilePhoto || '');

      if (listingProfile?.name || listingProfile?.phone || listingProfile?.email) {
        setPrefilledAgent({
          ...(state.prefilledAgent || {}),
          name: listingProfile.name || (!isGenericAgentName(h?.agent) ? h?.agent : ''),
          phone: listingProfile.phone || h?.agent_phone || state.prefilledAgent?.phone || '',
          email: listingProfile.email || h?.agent_email || state.prefilledAgent?.email || '',
          brokerage: listingProfile.brokerage || h?.brokerage || state.prefilledAgent?.brokerage || '',
          image_url: profilePhoto || state.prefilledAgent?.image_url || ''
        });
        showVerifyAgent();
      } else if (h?.agent && !isGenericAgentName(h.agent)) {
        showVerifyAgent();
      } else {
        routeUnknownAgentFlow(h?.brokerage || '', 'We did not find an agent record. Complete your profile below.');
      }
      return;
    }

    if (agents.length === 1) {
      selectAgent(agents[0]);
      return;
    }

    const fallbackBrokerage = h?.brokerage || '';
    const cards = agents.map((a) => {
      const photo = a.primary_photo_url || a.directory_photo_url || '';
      return `
        <div onclick="selectAgentByEncoded(this.dataset.agent)" data-agent="${encodeURIComponent(JSON.stringify(a))}" class="flex items-center gap-4 p-4 rounded-[24px] bg-white/80 border border-white/70 shadow hover:shadow-xl cursor-pointer">
          ${photo ? `<img src="${photo}" class="w-16 h-16 rounded-full object-cover bg-white">` : `<div class="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 font-black">AG</div>`}
          <div class="text-left">
            <div class="font-black text-lg text-[#1f2a5a]">${a.name || 'Agent'}</div>
            <div class="text-sm text-slate-500">${a.phone || ''}</div>
          </div>
        </div>
      `;
    }).join('');

    document.getElementById('app').innerHTML = `
      <div class="w-full max-w-xl rounded-[38px] md:rounded-[46px] border border-white/70 bg-white/20 backdrop-blur-[10px] p-6 md:p-10 text-center transition-all duration-500 shadow-[0_25px_60px_rgba(31,42,90,0.12),inset_0_1px_1px_rgba(255,255,255,0.35)]">
        <div class="mb-8">
          <img src="https://rel8tion.me/wp-content/uploads/2026/04/logo150x100trans.png" class="h-16 md:h-20 mx-auto drop-shadow-sm" alt="Rel8tion">
        </div>
        <div>
          <h1 class="font-['Poppins'] text-3xl md:text-4xl font-black mb-4 uppercase text-[#1f2a5a]">Select Yourself</h1>
          <p class="text-slate-500 text-lg mb-6">We found multiple agents on this listing.</p>
          <div class="space-y-3">${cards}</div>
          <button onclick="routeUnknownAgentFlow('${fallbackBrokerage.replace(/'/g, "\\'")}', 'Complete your profile manually below.')" class="mt-6 text-slate-400 text-sm font-bold uppercase tracking-widest">Not Me</button>
        </div>
      </div>
    `;
  } catch (e) {
    debug('AGENT SELECTION FAILED', { message: e?.message || String(e) });
    if (h?.agent && !isGenericAgentName(h.agent)) {
      showVerifyAgent();
    } else {
      routeUnknownAgentFlow(h?.brokerage || '', 'Agent lookup failed. Continue manually.');
    }
  }
}

export async function confirmListing() {
  if (!state.detectedHouse) {
    routeUnknownAgentFlow('', 'No listing selected. Continue manually.');
    return;
  }

  const profileLocked = hasLockedProfileIdentity();

  if (!profileLocked && state.detectedHouse.brokerage) {
    setSelectedBrokerage(state.detectedHouse.brokerage);
    await applyBranding(state.detectedHouse.brokerage);
  }

  if (profileLocked) {
    showVerifyAgent();
    return;
  }

  showLoading('Checking listing agents...');
  try {
    await showAgentSelection();
  } catch (e) {
    debug('CONFIRM LISTING FAILED', { message: e?.message || String(e) });
    routeUnknownAgentFlow(state.detectedHouse?.brokerage || '', "We didn't find an exact match. Complete your profile below.");
  }
}

export function selectAgentByEncoded(encoded) {
  try {
    const agent = JSON.parse(decodeURIComponent(encoded));
    selectAgent(agent);
  } catch (e) {
    debug('SELECT AGENT DECODE FAILED', { message: e?.message || String(e) });
  }
}

function selectAgent(agent) {
  if (hasLockedProfileIdentity()) {
    showVerifyAgent();
    return;
  }

  const selectedName = !isGenericAgentName(agent.name)
    ? agent.name
    : (!isGenericAgentName(state.prefilledAgent?.name)
      ? state.prefilledAgent.name
      : (!isGenericAgentName(state.detectedHouse?.agent) ? state.detectedHouse.agent : ''));

  setPrefilledAgent({
    ...(state.prefilledAgent || {}),
    name: selectedName,
    phone: agent.phone || state.prefilledAgent?.phone || '',
    email: agent.email || state.prefilledAgent?.email || '',
    brokerage: agent.brokerage || state.detectedHouse?.brokerage || state.prefilledAgent?.brokerage || '',
    image_url: agent.primary_photo_url || agent.directory_photo_url || state.prefilledAgent?.image_url || ''
  });

  setDetectedAgentPhoto(agent.primary_photo_url || agent.directory_photo_url || '');
  showVerifyAgent();
}

function getFullProfileBrokerage() {
  const brokerageSelect = document.getElementById('full_brokerage_select')?.value || '';
  const brokerageCustom = document.getElementById('full_brokerage_custom')?.value?.trim() || '';
  return brokerageSelect === '__other__' ? brokerageCustom : brokerageSelect;
}

function isGenericAgentName(name) {
  return isGenericAgentNameValue(name);
}

function isGeneratedGenericAgent(agent) {
  return isGenericAgentName(agent?.name) && /^agent-[a-z0-9]{3,}$/i.test(String(agent?.slug || ''));
}

export async function autoActivate() {
  const h = state.detectedHouse;
  if (!state.uid) {
    showError('Chip Required', 'This preview can show the activation flow, but saving a live claim requires a real chip uid.');
    return;
  }
  if (!(h?.agent || h?.agent_phone || h?.agent_email || state.prefilledAgent?.name || state.prefilledAgent?.phone)) {
    routeUnknownAgentFlow(h?.brokerage || '', 'Complete your profile below.');
    return;
  }

  showLoading('Activating your profile...');

  try {
    const sourceName = state.prefilledAgent?.name || h?.agent || '';
    const sourcePhone = state.prefilledAgent?.phone || h?.agent_phone || null;
    const sourceEmail = state.prefilledAgent?.email || h?.agent_email || null;
    const phoneNormalized = normalizePhoneForMatch(sourcePhone);

    const reusablePrefilledSlug = state.prefilledAgent?.slug || '';
    let existingAgent = reusablePrefilledSlug ? state.prefilledAgent : null;
    if (!existingAgent && phoneNormalized) existingAgent = await findAgentByPhoneNormalized(phoneNormalized);
    if (!existingAgent && sourceEmail) existingAgent = await findAgentByEmail(sourceEmail);

    const resolvedName = isGeneratedGenericAgent(existingAgent)
      ? sourceName
      : existingAgent?.name || sourceName;
    if (!existingAgent && isGenericAgentName(resolvedName)) {
      routeUnknownAgentFlow(h?.brokerage || state.selectedBrokerage || '', 'Complete your profile below so this keychain saves under your real name.');
      return;
    }

    const baseSlug = slugify(resolvedName || sourceEmail || sourcePhone || 'agent') || 'agent';
    const slug = existingAgent?.slug || reusablePrefilledSlug || `${baseSlug}-${randSuffix()}`;
    const agent = {
      name: resolvedName,
      phone: existingAgent?.phone || sourcePhone,
      phone_normalized: existingAgent?.phone_normalized || phoneNormalized || null,
      email: existingAgent?.email || sourceEmail || null,
      brokerage: existingAgent?.brokerage || state.selectedBrokerage || h?.brokerage || null,
      slug,
      image_url: existingAgent?.image_url || state.prefilledAgent?.image_url || state.detectedAgentPhoto || null,
      bio: existingAgent?.bio || state.prefilledAgent?.bio || null
    };

    await upsertAgent(agent);
    await linkKeyToAgent(slug);
    await sendActivationSMS(agent.phone, slug, agent.name);
    window.location.href = routeAfterVerifiedAgent(slug, 'claim-auto-activate');
  } catch (e) {
    debug('AUTO ACTIVATE FAILED', { message: e?.message || String(e) });
    routeUnknownAgentFlow(h?.brokerage || '', 'Auto activation failed. Complete your profile below.');
  }
}

export async function saveFullProfile() {
  if (!state.uid) {
    showError('Chip Required', 'This preview can show the form, but saving a live activation requires a real chip uid.');
    return;
  }

  const name = document.getElementById('full_name')?.value?.trim() || '';
  const phone = document.getElementById('full_phone')?.value?.trim() || '';
  const phoneNormalized = normalizePhoneForMatch(phone);
  const email = document.getElementById('full_email')?.value?.trim() || '';
  const brokerage = getFullProfileBrokerage();
  const bio = document.getElementById('full_bio')?.value?.trim() || '';

  if (!name || !phone) {
    alert('Name and phone are required.');
    return;
  }
  if (!brokerage) {
    alert('Brokerage is required.');
    return;
  }

  showLoading('Saving your profile...');

  try {
    const reusablePrefilledSlug = state.prefilledAgent?.slug || '';
    let existingAgent = reusablePrefilledSlug ? state.prefilledAgent : null;
    if (!existingAgent && phoneNormalized) existingAgent = await findAgentByPhoneNormalized(phoneNormalized);
    if (!existingAgent && email) existingAgent = await findAgentByEmail(email);

    const slug = existingAgent?.slug || reusablePrefilledSlug || `${slugify(name) || 'agent'}-${randSuffix()}`;
    const existingImageUrl = existingAgent?.image_url || state.prefilledAgent?.image_url || '';
    const imageUrl = await uploadFullProfilePhoto(slug);
    const agent = {
      name,
      phone,
      phone_normalized: phoneNormalized,
      email: email || null,
      brokerage: brokerage || null,
      slug,
      image_url: imageUrl || existingImageUrl || state.detectedAgentPhoto || null,
      bio: bio || null
    };

    await upsertAgent(agent);
    setManuallyEnteredProfile(true);
    setSelectedBrokerage(brokerage);
    await applyBranding(brokerage);
    await linkKeyToAgent(slug);
    await sendActivationSMS(phone, slug, name);
    window.location.href = routeAfterVerifiedAgent(slug, 'claim-full-profile');
  } catch (e) {
    debug('SAVE FULL PROFILE FAILED', { message: e?.message || String(e) });
    showFullProfileForm(brokerage || state.detectedHouse?.brokerage || state.selectedBrokerage || '', 'Saving failed. Please try again.');
  }
}

export async function init() {
  showLoading('Checking your setup...');
  startLoaderTextCycle();

  if (!state.uid) {
    showMissingChipNotice();
    return;
  }

  try {
    await loadAgentFromUID();
    if (isBetaKeychain()) {
      showBetaClaimMenu(state.prefilledAgent || {
        slug: state.keyRecord?.agent_slug || BETA_AGENT_SLUG,
        name: state.keyRecord?.agent_slug || 'Main Beta'
      });
      return;
    }
    if (state.keyRecord?.claimed === true && state.keyRecord?.agent_slug) {
      const nextRoute = routeAfterVerifiedAgent(state.keyRecord.agent_slug, 'claimed-chip-scan');
      if (nextRoute !== onboardingRoute(state.keyRecord.agent_slug)) {
        window.location.href = nextRoute;
        return;
      }
      if (state.prefilledAgent) showAlreadyClaimed(state.prefilledAgent);
      else window.location.href = nextRoute;
      return;
    }
    showIntro();
  } catch (e) {
    debug('INIT FAILED', { message: e?.message || String(e) });
    showIntro();
  }
}
