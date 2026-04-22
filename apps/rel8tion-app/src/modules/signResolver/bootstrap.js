import { ASSETS, ROUTES } from '../../core/config.js';
import { getEventById } from '../../api/events.js';
import { getOpenHouseById } from '../../api/openHouses.js';
import { getActiveSmartSignEvent, getSmartSignByPublicCode } from '../../api/smartSigns.js';
import { esc, money } from '../../core/utils.js';

function getCodeFromUrl() {
  return new URLSearchParams(window.location.search).get('code') || '';
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
  `);
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

export async function initSignResolverPage() {
  const code = getCodeFromUrl();
  if (!code) {
    errorView('Missing Sign Code', 'This route needs ?code=YOUR_PUBLIC_CODE');
    return;
  }

  loading('Looking up sign identity...');

  try {
    const sign = await getSmartSignByPublicCode(code);
    if (!sign) {
      errorView('Invalid Sign', 'No smart sign was found for that public code.');
      return;
    }

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
