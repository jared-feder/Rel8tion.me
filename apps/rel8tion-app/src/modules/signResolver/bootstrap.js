import { ASSETS, ROUTES } from '../../core/config.js';
import { closeEvent, createOpenHouseEvent, getEventById, resolveEventLifecycle } from '../../api/events.js';
import { findNearestOpenHouses, getOpenHouseById } from '../../api/openHouses.js';
import { getHostSession, hostSessionLabel } from '../../core/hostSession.js';
import {
  assignSmartSignToAgent,
  getActiveSmartSignEvent,
  getSmartSignByPublicCode,
  getSmartSignsByAssignedAgent,
  updateSmartSign
} from '../../api/smartSigns.js';
import { esc, money } from '../../core/utils.js';

const pageState = {
  sign: null,
  hostSession: null,
  nearbyHouses: [],
  activating: false,
  activationError: '',
  statusMessage: ''
};

const SIGN_DEMO_SESSION_KEY = 'rel8tion_sign_demo_session';

function getCodeFromUrl() {
  return new URLSearchParams(window.location.search).get('code') || '';
}

function readSignActivationSession() {
  try {
    const raw = window.localStorage.getItem(SIGN_DEMO_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function continueSignActivationFromQr(code) {
  const pending = readSignActivationSession();
  if (!pending?.uid || !pending?.agentSlug) return false;
  if (pending.publicCode && pending.publicCode !== code) return false;
  if (!pending.publicCode && !pending.qrArmedAt) return false;
  if (!['waiting_for_sign_code', 'waiting_for_sign_chip_1', 'waiting_for_second_sign_chip', 'waiting_for_handshake'].includes(pending.stage)) {
    return false;
  }

  const next = new URLSearchParams();
  next.set('code', code);
  next.set('uid', pending.uid);
  next.set('agent', pending.agentSlug);
  if (pending.signId) next.set('sign_id', pending.signId);
  window.location.replace(`/sign-demo-activate.html?${next.toString()}`);
  return true;
}

function render(html) {
  document.getElementById('app').innerHTML = html;
}

function shell(content) {
  render(`
    <section class="w-full max-w-3xl rounded-[40px] border border-white/60 bg-white/20 backdrop-blur-md p-8 md:p-10 text-center shadow-[0_25px_50px_rgba(31,42,90,0.1)]">
      <div class="mb-6">
        <img src="${ASSETS.rel8tionLogo}" alt="Rel8tion" class="h-16 md:h-20 mx-auto w-auto">
      </div>
      ${content}
    </section>
  `);
}

function loading(message) {
  shell(`
    <div class="inline-flex items-center px-4 py-2 rounded-full bg-white/50 border border-white/70 text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-5">Smart Sign</div>
    <div class="mx-auto mb-6 h-14 w-14 rounded-full border-[6px] border-slate-200 border-t-sky-500 animate-spin"></div>
    <h1 class="font-['Plus_Jakarta_Sans'] text-4xl md:text-6xl font-extrabold tracking-tight text-slate-900 mb-4">Opening Live Event</h1>
    <p class="text-slate-700 text-lg md:text-xl font-medium max-w-2xl mx-auto">${esc(message)}</p>
  `);
}

function errorView(title, message) {
  shell(`
    <div class="inline-flex items-center px-4 py-2 rounded-full bg-white/50 border border-white/70 text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-5">Smart Sign</div>
    <h1 class="font-['Plus_Jakarta_Sans'] text-4xl md:text-6xl font-extrabold tracking-tight text-slate-900 mb-4">${esc(title)}</h1>
    <p class="text-slate-700 text-lg md:text-xl font-medium max-w-2xl mx-auto mb-8">${esc(message)}</p>
    <a href="/" class="inline-flex items-center justify-center w-full md:w-auto px-10 py-4 rounded-full font-bold text-base md:text-lg bg-white/80 border border-white/80 text-slate-700">Go Home</a>
  `);
}

function activationCard(sign) {
  const signReady = Boolean(sign?.activation_uid_primary && sign?.activation_uid_secondary);
  const hostOwnsSign = Boolean(pageState.hostSession?.agentSlug && sign?.assigned_agent_slug && sign.assigned_agent_slug === pageState.hostSession.agentSlug);
  const signAssignedToOtherHost = Boolean(pageState.hostSession?.agentSlug && sign?.assigned_agent_slug && sign.assigned_agent_slug !== pageState.hostSession.agentSlug);

  if (!signReady) {
    return `
      <div class="rounded-[28px] border border-amber-200 bg-amber-50/90 p-6 text-left max-w-xl mx-auto mt-6">
        <div class="text-[11px] font-black uppercase tracking-[0.18em] text-amber-700 mb-3">Sign Setup Incomplete</div>
        <div class="text-slate-900 font-black text-xl mb-3">Both Smart Sign chips must be registered first</div>
        <p class="text-slate-700 font-semibold leading-relaxed">
          This Smart Sign is missing one of its two embedded chip assignments. Register both sign chips to this sign before trying to activate it into a live event.
        </p>
      </div>
    `;
  }

  if (!pageState.hostSession) {
    return `
      <div class="rounded-[28px] border border-white/70 bg-white/60 p-6 text-left max-w-xl mx-auto mt-6">
        <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-3">Host Activation</div>
        <div class="text-slate-900 font-black text-xl mb-3">Host session not detected</div>
        <p class="text-slate-600 font-semibold leading-relaxed">
          This sign is ready, but no recent host chip scan was found on this device. Scan the claimed Rel8tionChip first, then scan this sign to bind it to the open house.
        </p>
      </div>
    `;
  }

  if (signAssignedToOtherHost) {
    return `
      <div class="rounded-[28px] border border-rose-200 bg-rose-50/90 p-6 text-left max-w-xl mx-auto mt-6">
        <div class="text-[11px] font-black uppercase tracking-[0.18em] text-rose-700 mb-3">Assigned To Another Host</div>
        <div class="text-slate-900 font-black text-xl mb-3">This sign already belongs to another agent</div>
        <p class="text-slate-700 font-semibold leading-relaxed">
          Recent host detected: <span class="text-slate-900">${esc(hostSessionLabel(pageState.hostSession) || pageState.hostSession.agentSlug)}</span>.
          This sign is currently assigned to <span class="text-slate-900">${esc(sign.assigned_agent_slug)}</span>, so it cannot be activated from this host session.
        </p>
      </div>
    `;
  }

  const housesMarkup = pageState.nearbyHouses.length
    ? `
      <div class="space-y-3 mt-5">
        ${pageState.nearbyHouses.slice(0, 5).map((house) => `
          <button type="button" class="activate-house-button w-full rounded-[24px] border border-white/80 bg-white/85 p-4 text-left shadow-sm hover:shadow-md transition-all" data-house-id="${esc(house.id)}">
            <div class="text-slate-900 font-black text-lg leading-tight mb-1">${esc(house.address || 'Open House')}</div>
            <div class="text-sky-600 font-black text-base mb-1">${house.price ? money(house.price) : ''}</div>
            <div class="text-slate-500 font-semibold text-sm">${esc(house.brokerage || '')}</div>
          </button>
        `).join('')}
      </div>
    `
    : '';

  return `
    <div class="rounded-[28px] border border-sky-100 bg-gradient-to-br from-sky-50/95 to-white p-6 text-left max-w-2xl mx-auto mt-6 shadow-[0_18px_40px_rgba(31,42,90,0.08)]">
      <div class="text-[11px] font-black uppercase tracking-[0.18em] text-sky-500 mb-3">Host Activation</div>
      <div class="text-slate-900 font-black text-2xl md:text-3xl mb-2">Activate This Smart Sign</div>
      <p class="text-slate-600 font-medium leading-relaxed mb-5">
        Recent host recognized: <span class="text-slate-900 font-black">${esc(hostSessionLabel(pageState.hostSession) || pageState.hostSession.agentSlug)}</span>.
        ${hostOwnsSign
          ? 'Use this device to detect the nearest listing and bind the sign to a live event.'
          : 'This sign is unassigned, so the next activation will also claim it into the first open sign slot for this host.'}
      </p>

      <div class="rounded-[20px] bg-white/80 border border-white/80 p-4 mb-4">
        <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Smart Sign</div>
        <div class="text-slate-900 font-black">${esc(sign.public_code || '')}</div>
        <div class="text-slate-500 font-semibold text-sm mt-1">
          ${sign.assigned_agent_slug
            ? `Assigned to ${esc(sign.assigned_agent_slug)}${sign.assigned_slot ? ` • Slot ${esc(sign.assigned_slot)}` : ''}`
            : 'Currently unassigned'}
        </div>
      </div>

      <div class="flex flex-col md:flex-row gap-3">
        <button type="button" id="detect-nearest-house-button" class="inline-flex items-center justify-center w-full md:w-auto px-8 py-4 rounded-full font-bold text-base md:text-lg text-white shadow-[0_18px_40px_rgba(59,130,246,0.28)] disabled:opacity-70" style="background:linear-gradient(90deg,#38bdf8,#2563eb);" ${pageState.activating ? 'disabled' : ''}>
          ${pageState.activating ? 'Working...' : 'Use Nearby Listing'}
        </button>
        <a href="/claim" class="inline-flex items-center justify-center w-full md:w-auto px-8 py-4 rounded-full font-bold text-base md:text-lg bg-white/80 border border-white/80 text-slate-700">
          Claim Another Chip
        </a>
      </div>

      ${pageState.statusMessage ? `<div class="rounded-[18px] border border-sky-200 bg-sky-50 px-4 py-4 text-sky-700 font-semibold mt-4">${esc(pageState.statusMessage)}</div>` : ''}
      ${pageState.activationError ? `<div class="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-4 text-rose-700 font-semibold mt-4">${esc(pageState.activationError)}</div>` : ''}
      ${housesMarkup}
    </div>
  `;
}

function inactiveView(sign) {
  shell(`
    <div class="inline-flex items-center px-4 py-2 rounded-full bg-white/50 border border-white/70 text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-5">Smart Sign</div>
    <h1 class="font-['Plus_Jakarta_Sans'] text-4xl md:text-6xl font-extrabold tracking-tight text-slate-900 mb-4">Sign Found</h1>
    <p class="text-slate-700 text-lg md:text-xl font-medium max-w-2xl mx-auto mb-8">This sign exists, but it is not attached to an active open house yet.</p>
    <div class="rounded-[28px] border border-white/70 bg-white/60 p-6 text-left max-w-xl mx-auto">
      <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-3">Smart Sign Status</div>
      <div class="text-slate-900 font-black text-xl mb-2">${esc(sign.public_code || '')}</div>
      <div class="text-slate-600 font-semibold">Status: ${esc(sign.status || 'inactive')}</div>
    </div>
    ${activationCard(sign)}
  `);

  attachInactiveHandlers(sign);
}

function activeView(sign, eventRow, house) {
  const image = house?.image || 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=1200&q=80';
  shell(`
    <div class="inline-flex items-center px-4 py-2 rounded-full bg-white/50 border border-white/70 text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-5">Live Open House</div>
    <h1 class="font-['Plus_Jakarta_Sans'] text-4xl md:text-6xl font-extrabold tracking-tight text-slate-900 mb-4">Welcome In</h1>
    <p class="text-slate-700 text-lg md:text-xl font-medium max-w-2xl mx-auto mb-8">This sign is attached to a live event. Continue to the buyer-facing event shell.</p>
    <div class="rounded-[30px] overflow-hidden border border-white/70 bg-white/75 shadow-[0_18px_40px_rgba(31,42,90,0.08)] text-left mb-8">
      <img src="${esc(image)}" alt="Property" class="w-full h-56 object-cover bg-slate-100">
      <div class="p-6">
        <div class="text-slate-900 font-black text-2xl md:text-3xl mb-2">${esc(house?.address || 'Open House Event')}</div>
        ${house?.price ? `<div class="text-sky-600 font-black text-xl mb-2">${money(house.price)}</div>` : ''}
        <div class="text-slate-600 font-semibold">${esc(house?.brokerage || 'Live event resolved')}</div>
        <div class="mt-4 text-sm text-slate-500">
          <div>Sign Code: ${esc(sign?.public_code || '')}</div>
          <div>Event ID: ${esc(eventRow?.id || '')}</div>
        </div>
      </div>
    </div>
    <a href="${ROUTES.event}?event=${encodeURIComponent(eventRow.id)}" class="inline-flex items-center justify-center w-full px-10 py-4 rounded-full font-bold text-base md:text-lg text-white shadow-[0_18px_40px_rgba(59,130,246,0.28)]" style="background:linear-gradient(90deg,#38bdf8,#2563eb);">Continue To Live Event</a>
    <p class="mt-4 text-sm text-slate-500 font-semibold">Redirecting automatically...</p>
  `);

  window.setTimeout(() => {
    window.location.replace(`${ROUTES.event}?event=${encodeURIComponent(eventRow.id)}`);
  }, 1200);
}

function attachInactiveHandlers(sign) {
  const detectButton = document.getElementById('detect-nearest-house-button');
  detectButton?.addEventListener('click', async () => {
    pageState.activating = true;
    pageState.activationError = '';
    pageState.statusMessage = 'Checking nearby listings...';
    pageState.nearbyHouses = [];
    inactiveView(sign);

    if (!navigator.geolocation) {
      pageState.activating = false;
      pageState.activationError = 'Location is not supported on this device, so nearby listing detection cannot run here.';
      pageState.statusMessage = '';
      inactiveView(sign);
      return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const houses = await findNearestOpenHouses(position.coords.latitude, position.coords.longitude);
        pageState.nearbyHouses = Array.isArray(houses) ? houses : [];
        pageState.statusMessage = pageState.nearbyHouses.length
          ? 'Select the listing you want to bind to this sign.'
          : 'No nearby open house was found for this location.';
      } catch (error) {
        console.error(error);
        pageState.activationError = error.message || 'Unable to load nearby listings.';
        pageState.statusMessage = '';
      } finally {
        pageState.activating = false;
        inactiveView(sign);
      }
    }, () => {
      pageState.activating = false;
      pageState.activationError = 'Location permission was denied, so this sign could not be matched to a nearby listing.';
      pageState.statusMessage = '';
      inactiveView(sign);
    }, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0
    });
  });

  document.querySelectorAll('.activate-house-button').forEach((button) => {
    button.addEventListener('click', async () => {
      const houseId = button.getAttribute('data-house-id');
      const house = pageState.nearbyHouses.find((item) => String(item.id) === String(houseId));
      if (!house) return;
      await activateSignToHouse(sign, house);
    });
  });
}

async function activateSignToHouse(sign, house) {
  if (!pageState.hostSession?.agentSlug) {
    pageState.activationError = 'A recent host chip session is required before activating this sign.';
    inactiveView(sign);
    return;
  }

  pageState.activating = true;
  pageState.activationError = '';
  pageState.statusMessage = 'Binding this sign to a live event...';
  inactiveView(sign);

  try {
    let effectiveSign = sign;

    if (!effectiveSign.activation_uid_primary || !effectiveSign.activation_uid_secondary) {
      throw new Error('This Smart Sign is missing one of its two registered sign chips.');
    }

    if (effectiveSign.assigned_agent_slug && effectiveSign.assigned_agent_slug !== pageState.hostSession.agentSlug) {
      throw new Error('This Smart Sign is assigned to another agent and cannot be activated from this host session.');
    }

    if (!effectiveSign.assigned_agent_slug) {
      const assignedSigns = await getSmartSignsByAssignedAgent(pageState.hostSession.agentSlug);
      const usedSlots = new Set(
        assignedSigns
          .map((item) => Number(item.assigned_slot))
          .filter((value) => Number.isInteger(value) && value > 0)
      );
      const availableSlot = [1, 2].find((slot) => !usedSlots.has(slot));
      if (!availableSlot) {
        throw new Error('This host already has both Smart Sign slots assigned.');
      }

      effectiveSign = await assignSmartSignToAgent(sign.id, pageState.hostSession.agentSlug, availableSlot);
    }

    const request = {
      smart_sign_id: effectiveSign.id,
      agent_slug: pageState.hostSession.agentSlug,
      open_house_source_id: house.id
    };

    const activeEvent = await getActiveSmartSignEvent(effectiveSign.id);
    const lifecycle = resolveEventLifecycle({ activeEvent, request });

    let eventRow = null;
    if (lifecycle.action === 'resume') {
      eventRow = activeEvent;
    } else {
      if (activeEvent && lifecycle.action === 'close_and_create_new') {
        await closeEvent(activeEvent.id);
      }

      if (activeEvent && lifecycle.action === 'prompt_resume_or_new') {
        eventRow = activeEvent;
      } else {
        eventRow = await createOpenHouseEvent({
          smart_sign_id: effectiveSign.id,
          open_house_source_id: house.id,
          agent_slug: pageState.hostSession.agentSlug,
          status: 'live',
          activation_uid_primary: pageState.hostSession.uid || null,
          activation_method: 'host_chip_session_sign_activation',
          setup_confirmed_at: new Date().toISOString(),
          last_activity_at: new Date().toISOString()
        });
      }
    }

    if (!eventRow?.id) {
      throw new Error('The event activation did not return a live event id.');
    }

    await updateSmartSign(effectiveSign.id, {
      active_event_id: eventRow.id,
      status: 'active',
      setup_confirmed_at: new Date().toISOString()
    });

    const freshHouse = await getOpenHouseById(eventRow.open_house_source_id || house.id);
    activeView({ ...effectiveSign, active_event_id: eventRow.id, status: 'active' }, eventRow, freshHouse || house);
  } catch (error) {
    console.error(error);
    pageState.activating = false;
    pageState.statusMessage = '';
    pageState.activationError = error.message || 'Unable to activate this sign right now.';
    inactiveView(sign);
  }
}

export async function initSignResolverPage() {
  const code = getCodeFromUrl();
  if (!code) {
    errorView('Missing Sign Code', 'This route needs ?code=YOUR_PUBLIC_CODE');
    return;
  }

  if (continueSignActivationFromQr(code)) {
    return;
  }

  loading('Looking up sign identity...');

  try {
    pageState.hostSession = getHostSession();
    const sign = await getSmartSignByPublicCode(code);
    if (!sign) {
      window.location.replace(`/sign-demo-activate.html?code=${encodeURIComponent(code)}&fresh_qr=1`);
      return;
    }
    pageState.sign = sign;

    let eventRow = null;
    if (sign.active_event_id) {
      loading('Loading active event...');
      eventRow = await getEventById(sign.active_event_id);
    }
    if (!eventRow && sign.id) {
      loading('Checking for a current live event...');
      eventRow = await getActiveSmartSignEvent(sign.id);
    }

    if (!eventRow) {
      inactiveView(sign);
      return;
    }

    const house = eventRow.open_house_source_id
      ? await getOpenHouseById(eventRow.open_house_source_id)
      : null;

    activeView(sign, eventRow, house);
  } catch (error) {
    console.error(error);
    errorView('Resolve Failed', error.message || 'Something went wrong while loading this sign.');
  }
}
