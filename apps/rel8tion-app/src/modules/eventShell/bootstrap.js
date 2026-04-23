import { ASSETS } from '../../core/config.js';
import { getAgentBySlug } from '../../api/agents.js';
import { createCheckin, getEventById, touchEvent } from '../../api/events.js';
import { sendFinancingLeadAlert } from '../../api/notifications.js';
import { getOpenHouseById } from '../../api/openHouses.js';
import { esc, money } from '../../core/utils.js';

const CHECKIN_PATHS = Object.freeze({
  BUYER: 'buyer',
  BUYER_WITH_AGENT: 'buyer_with_agent',
  BUYER_AGENT: 'buyer_agent'
});

const PATH_LABELS = Object.freeze({
  [CHECKIN_PATHS.BUYER]: 'Buyer',
  [CHECKIN_PATHS.BUYER_WITH_AGENT]: 'Buyer With Agent',
  [CHECKIN_PATHS.BUYER_AGENT]: 'Buyer Agent'
});

const pageState = {
  eventRow: null,
  house: null,
  agent: null,
  selectedPath: CHECKIN_PATHS.BUYER,
  submitting: false,
  successMessage: '',
  errorMessage: '',
  lastCheckin: null,
  financingAlertSent: false
};

function getEventIdFromUrl() {
  return new URLSearchParams(window.location.search).get('event') || '';
}

function getPathFromUrl() {
  const path = new URLSearchParams(window.location.search).get('path') || CHECKIN_PATHS.BUYER;
  return Object.values(CHECKIN_PATHS).includes(path) ? path : CHECKIN_PATHS.BUYER;
}

function setPathInUrl(path) {
  const url = new URL(window.location.href);
  url.searchParams.set('path', path);
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);
}

function render(html) {
  document.getElementById('app').innerHTML = html;
}

function shell(content) {
  render(`
    <section class="w-full max-w-5xl rounded-[40px] border border-white/60 bg-white/20 backdrop-blur-md p-6 md:p-10 shadow-[0_25px_50px_rgba(31,42,90,0.1)]">
      <div class="text-center mb-6">
        <img src="${ASSETS.rel8tionLogo}" alt="Rel8tion" class="h-16 md:h-20 mx-auto w-auto">
      </div>
      ${content}
    </section>
  `);
}

function loading(message) {
  shell(`
    <div class="text-center">
      <div class="inline-flex items-center px-4 py-2 rounded-full bg-white/50 border border-white/70 text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-5">Live Event</div>
      <div class="mx-auto mb-6 h-14 w-14 rounded-full border-[6px] border-slate-200 border-t-sky-500 animate-spin"></div>
      <h1 class="font-['Plus_Jakarta_Sans'] text-4xl md:text-6xl font-extrabold tracking-tight text-slate-900 mb-4">Loading Event</h1>
      <p class="text-slate-700 text-lg md:text-xl font-medium max-w-2xl mx-auto">${esc(message)}</p>
    </div>
  `);
}

function errorView(title, message, actions = '') {
  shell(`
    <div class="text-center">
      <div class="inline-flex items-center px-4 py-2 rounded-full bg-white/50 border border-white/70 text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-5">Live Event</div>
      <h1 class="font-['Plus_Jakarta_Sans'] text-4xl md:text-6xl font-extrabold tracking-tight text-slate-900 mb-4">${esc(title)}</h1>
      <p class="text-slate-700 text-lg md:text-xl font-medium max-w-2xl mx-auto mb-8">${esc(message)}</p>
      <div class="flex flex-col md:flex-row items-center justify-center gap-3">
        ${actions || '<a href="/" class="inline-flex items-center justify-center w-full md:w-auto px-10 py-4 rounded-full font-bold text-base md:text-lg bg-white/80 border border-white/80 text-slate-700">Go Home</a>'}
      </div>
    </div>
  `);
}

function houseStatus(house) {
  try {
    const now = new Date();
    const start = house?.open_start ? new Date(house.open_start) : null;
    const end = house?.open_end ? new Date(house.open_end) : null;
    if (start && end && now >= start && now <= end) return { label: 'Live Now', color: '#16a34a' };
    if (start && now < start) return { label: 'Upcoming', color: '#2563eb' };
    return { label: 'Ended', color: '#6b7280' };
  } catch {
    return { label: 'Open House', color: '#6b7280' };
  }
}

function safeUrl(url) {
  if (!url) return '#';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://${url}`;
}

function buttonClasses(selected) {
  return selected
    ? 'text-white shadow-[0_18px_40px_rgba(59,130,246,0.20)]'
    : 'bg-white/80 border border-white/80 text-slate-700';
}

function pathButton(path, label) {
  const selected = path === pageState.selectedPath;
  const style = selected ? 'background:linear-gradient(90deg,#38bdf8,#2563eb);' : '';
  return `
    <button type="button" data-path="${path}" class="path-button inline-flex items-center justify-center px-5 py-3 rounded-full font-bold text-sm md:text-base ${buttonClasses(selected)}" ${style ? `style="${style}"` : ''}>
      ${esc(label)}
    </button>
  `;
}

function field(label, name, type = 'text', placeholder = '', required = false) {
  return `
    <label class="block">
      <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">${esc(label)}</div>
      <input name="${name}" type="${type}" ${required ? 'required' : ''} placeholder="${esc(placeholder)}" class="w-full rounded-[18px] border border-slate-200 bg-white/85 px-4 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-sky-400">
    </label>
  `;
}

function todayDateValue() {
  return new Date().toISOString().slice(0, 10);
}

function selectField(label, name, options) {
  return `
    <label class="block">
      <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">${esc(label)}</div>
      <select name="${name}" class="w-full rounded-[18px] border border-slate-200 bg-white/85 px-4 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-sky-400">
        ${options.map((option) => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('')}
      </select>
    </label>
  `;
}

function getPathDescription(path) {
  if (path === CHECKIN_PATHS.BUYER) {
    return 'For buyers visiting directly. Capture contact info and whether financing is already lined up.';
  }
  if (path === CHECKIN_PATHS.BUYER_WITH_AGENT) {
    return 'For buyers visiting with representation already in place. Keep both sides visible and protected.';
  }
  return 'For buyer agents checking in a represented client. Preserve the relationship from the first tap.';
}

function renderFormFields() {
  if (pageState.selectedPath === CHECKIN_PATHS.BUYER) {
    return `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${field('Your Name', 'visitor_name', 'text', 'Jane Buyer', true)}
        ${field('Phone', 'visitor_phone', 'tel', '(555) 555-5555')}
        <div class="md:col-span-2">
          ${field('Email', 'visitor_email', 'email', 'you@email.com')}
        </div>
        <div class="md:col-span-2">
          ${selectField('Pre-Approved', 'pre_approved', [
            { value: '', label: 'Select' },
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' }
          ])}
        </div>
      </div>
    `;
  }

  if (pageState.selectedPath === CHECKIN_PATHS.BUYER_WITH_AGENT) {
    return `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${field('Buyer Name', 'visitor_name', 'text', 'Jane Buyer', true)}
        ${field('Buyer Phone', 'visitor_phone', 'tel', '(555) 555-5555')}
        <div class="md:col-span-2">
          ${field('Buyer Email', 'visitor_email', 'email', 'buyer@email.com')}
        </div>
        ${field('Buyer Agent Name', 'buyer_agent_name', 'text', 'Agent Name', true)}
        ${field('Buyer Agent Phone', 'buyer_agent_phone', 'tel', '(555) 555-5555')}
        <div class="md:col-span-2">
          ${field('Buyer Agent Email', 'buyer_agent_email', 'email', 'agent@email.com')}
        </div>
        <div class="md:col-span-2">
          ${selectField('Buyer Pre-Approved', 'pre_approved', [
            { value: '', label: 'Select' },
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' }
          ])}
        </div>
      </div>
    `;
  }

  return `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      ${field('Buyer Agent Name', 'buyer_agent_name', 'text', 'Agent Name', true)}
      ${field('Buyer Agent Phone', 'buyer_agent_phone', 'tel', '(555) 555-5555')}
      <div class="md:col-span-2">
        ${field('Buyer Agent Email', 'buyer_agent_email', 'email', 'agent@email.com')}
      </div>
      ${field('Buyer Name', 'visitor_name', 'text', 'Buyer Name', true)}
      ${field('Buyer Phone', 'visitor_phone', 'tel', '(555) 555-5555')}
      <div class="md:col-span-2">
        ${field('Buyer Email', 'visitor_email', 'email', 'buyer@email.com')}
      </div>
      <label class="md:col-span-2 flex items-start gap-3 rounded-[18px] border border-slate-200 bg-white/80 px-4 py-4 text-slate-700 font-semibold">
        <input type="checkbox" name="represented_buyer_confirmed" value="true" class="mt-1 h-4 w-4 rounded border-slate-300">
        <span>I represent this buyer and want that relationship documented with this check-in.</span>
      </label>
      <div class="md:col-span-2">
        ${selectField('Buyer Pre-Approved', 'pre_approved', [
          { value: '', label: 'Select' },
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' }
        ])}
      </div>
    </div>
  `;
}

function renderDisclosureBlock() {
  return `
    <div class="rounded-[22px] border border-slate-200 bg-white/80 p-5 space-y-4">
      <div>
        <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Disclosure & Consent</div>
        <p class="text-slate-600 font-medium leading-relaxed">
          I agree to be contacted about this property, similar homes, open houses, and financing options. If I am not pre-approved, I consent to speaking with a specialist.
        </p>
      </div>
      <label class="flex items-start gap-3 text-slate-700 font-semibold">
        <input type="checkbox" name="disclosure_accepted" value="true" required class="mt-1 h-4 w-4 rounded border-slate-300">
        <span>I have read and accept this disclosure.</span>
      </label>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${field('Signature', 'signature_name', 'text', 'Type your full name', true)}
        <label class="block">
          <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Today</div>
          <input name="signature_date" type="date" value="${todayDateValue()}" required class="w-full rounded-[18px] border border-slate-200 bg-white/85 px-4 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-sky-400">
        </label>
      </div>
    </div>
  `;
}

function renderFinancingBlock() {
  return `
    <div class="rounded-[22px] border border-sky-200 bg-sky-50/90 p-5 space-y-3">
      <div class="text-[11px] font-black uppercase tracking-[0.18em] text-sky-500">Financing Help</div>
      <p class="text-slate-700 font-medium leading-relaxed">
        If you are not pre-approved yet, we can connect you with a financing specialist so you can move faster after the open house.
      </p>
      <label class="flex items-start gap-3 text-slate-700 font-semibold">
        <input type="checkbox" name="financing_requested" value="true" class="mt-1 h-4 w-4 rounded border-slate-300">
        <span>Yes, connect me with a financing specialist.</span>
      </label>
    </div>
  `;
}

function buildCheckinPayload(formData) {
  const values = Object.fromEntries(formData.entries());
  const preApproved = values.pre_approved === 'yes' ? true : (values.pre_approved === 'no' ? false : null);
  const financingRequested = values.financing_requested === 'true' || preApproved === false;
  return {
    open_house_event_id: pageState.eventRow.id,
    visitor_type: pageState.selectedPath,
    visitor_name: values.visitor_name || null,
    visitor_phone: values.visitor_phone || null,
    visitor_email: values.visitor_email || null,
    buyer_agent_name: values.buyer_agent_name || null,
    buyer_agent_phone: values.buyer_agent_phone || null,
    buyer_agent_email: values.buyer_agent_email || null,
    pre_approved: preApproved,
    represented_buyer_confirmed: values.represented_buyer_confirmed === 'true',
    metadata: {
      source: 'app-event-shell',
      path: pageState.selectedPath,
      disclosure_accepted: values.disclosure_accepted === 'true',
      signature_name: values.signature_name || null,
      signature_date: values.signature_date || null,
      signature_timestamp: new Date().toISOString(),
      financing_requested: financingRequested
    }
  };
}

function attachEventHandlers() {
  document.querySelectorAll('.path-button').forEach((button) => {
    button.addEventListener('click', () => {
      const nextPath = button.getAttribute('data-path');
      if (!nextPath || nextPath === pageState.selectedPath) return;
      pageState.selectedPath = nextPath;
      pageState.successMessage = '';
      pageState.errorMessage = '';
      pageState.financingAlertSent = false;
      setPathInUrl(nextPath);
      renderEventShell();
    });
  });

  const form = document.getElementById('checkin-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pageState.submitting) return;

    pageState.submitting = true;
    pageState.successMessage = '';
    pageState.errorMessage = '';
    pageState.financingAlertSent = false;
    renderEventShell();

    try {
      const payload = buildCheckinPayload(new FormData(form));
      await createCheckin(payload);
      try {
        await touchEvent(pageState.eventRow.id);
      } catch (error) {
        console.log('touchEvent after checkin skipped', error);
      }

      const financingRequested = payload.metadata?.financing_requested === true;
      if (financingRequested) {
        await sendFinancingLeadAlert({
          agentPhone: pageState.agent?.phone || payload.buyer_agent_phone || '',
          buyerPhone: payload.visitor_phone || '',
          buyerName: payload.visitor_name || 'Buyer',
          address: pageState.house?.address || 'Open House Visitor',
          price: pageState.house?.price ? money(pageState.house.price) : '',
          preapproved: payload.pre_approved === true ? 'yes' : 'no'
        });
      }

      pageState.lastCheckin = payload;
      pageState.financingAlertSent = financingRequested;
      pageState.successMessage = financingRequested
        ? 'Check-in saved. Financing follow-up has been flagged.'
        : 'Check-in saved. You are all set.';
      form.reset();
    } catch (error) {
      console.error(error);
      pageState.errorMessage = error.message || 'Unable to save check-in.';
    } finally {
      pageState.submitting = false;
      renderEventShell();
    }
  });
}

function renderEventShell() {
  const { eventRow, house, agent, selectedPath } = pageState;
  const image = house?.image || 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=1200&q=80';
  const status = houseStatus(house);
  const agentName = agent?.name || eventRow?.agent_slug || 'Listing Representative';

  const lastCheckinNeedsFinancing = pageState.lastCheckin?.metadata?.financing_requested === true;

  shell(`
    <div class="text-center mb-8">
      <div class="inline-flex items-center px-4 py-2 rounded-full bg-white/50 border border-white/70 text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-5">Live Event Shell</div>
      <h1 class="font-['Plus_Jakarta_Sans'] text-4xl md:text-6xl font-extrabold tracking-tight text-slate-900 mb-4">Welcome In</h1>
      <p class="text-slate-700 text-lg md:text-xl font-medium max-w-3xl mx-auto">Tap once, check in cleanly, and keep the right relationships visible from the start.</p>
    </div>

    <section class="rounded-[30px] overflow-hidden border border-white/70 bg-white/75 shadow-[0_18px_40px_rgba(31,42,90,0.08)] mb-6">
      <img src="${esc(image)}" alt="Property" class="w-full h-64 md:h-80 object-cover bg-slate-100">
      <div class="p-6 md:p-8">
        <div class="inline-flex items-center px-4 py-2 rounded-full text-xs font-black uppercase tracking-[0.18em] text-white mb-4" style="background:${status.color}">${esc(status.label)}</div>
        <div class="font-['Plus_Jakarta_Sans'] text-3xl md:text-5xl font-extrabold tracking-tight text-slate-900 mb-2">${esc(house?.address || 'Open House Event')}</div>
        ${house?.price ? `<div class="text-sky-600 font-black text-2xl md:text-3xl mb-3">${money(house.price)}</div>` : ''}
        <div class="text-slate-600 text-base md:text-lg font-semibold">${esc(house?.brokerage || 'Brokerage info available on event record')}</div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <div class="rounded-[22px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Hosted By</div>
            <div class="text-slate-900 font-black text-lg">${esc(agentName)}</div>
          </div>
          <div class="rounded-[22px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Event ID</div>
            <div class="text-slate-900 font-bold break-all">${esc(eventRow?.id || '')}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="grid grid-cols-1 lg:grid-cols-[1.25fr_.75fr] gap-5 mb-5">
      <article class="rounded-[28px] border border-white/70 bg-white/75 p-6 shadow-[0_18px_40px_rgba(31,42,90,0.08)]">
        <div class="flex flex-wrap gap-3 mb-5">
          ${pathButton(CHECKIN_PATHS.BUYER, PATH_LABELS[CHECKIN_PATHS.BUYER])}
          ${pathButton(CHECKIN_PATHS.BUYER_WITH_AGENT, PATH_LABELS[CHECKIN_PATHS.BUYER_WITH_AGENT])}
          ${pathButton(CHECKIN_PATHS.BUYER_AGENT, PATH_LABELS[CHECKIN_PATHS.BUYER_AGENT])}
        </div>

        <h2 class="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mb-3">Check In</h2>
        <p class="text-slate-600 font-medium leading-relaxed mb-5">${esc(getPathDescription(selectedPath))}</p>

        <form id="checkin-form" class="space-y-4">
          ${renderFormFields()}
          ${renderDisclosureBlock()}
          ${selectedPath !== CHECKIN_PATHS.BUYER_AGENT ? renderFinancingBlock() : ''}
          <button type="submit" class="inline-flex items-center justify-center w-full px-8 py-4 rounded-full font-bold text-base md:text-lg text-white shadow-[0_18px_40px_rgba(59,130,246,0.28)] disabled:opacity-70" style="background:linear-gradient(90deg,#38bdf8,#2563eb);" ${pageState.submitting ? 'disabled' : ''}>
            ${pageState.submitting ? 'Saving Check-In...' : 'Submit Check-In'}
          </button>
          ${pageState.successMessage ? `<div class="rounded-[18px] border border-emerald-200 bg-emerald-50 px-4 py-4 text-emerald-700 font-semibold">${esc(pageState.successMessage)}</div>` : ''}
          ${pageState.errorMessage ? `<div class="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-4 text-rose-700 font-semibold">${esc(pageState.errorMessage)}</div>` : ''}
        </form>
      </article>

      <article class="rounded-[28px] border border-white/70 bg-white/75 p-6 shadow-[0_18px_40px_rgba(31,42,90,0.08)]">
        <h2 class="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mb-3">Why This Matters</h2>
        <div class="space-y-4 text-slate-600 font-medium leading-relaxed">
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            Buyers check in through the live event, not a generic form that floats around with no context.
          </div>
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            If a buyer shows up with an agent, that relationship can be documented right here.
          </div>
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            Pre-approval status is captured at the moment of real interest, not days later.
          </div>
          ${lastCheckinNeedsFinancing ? `
            <div class="rounded-[20px] bg-sky-50 border border-sky-200 p-4">
              Financing follow-up was requested for this check-in.${pageState.financingAlertSent ? ' Your SMS alert path was triggered as well.' : ''} This is where your NMB/service-side handoff can turn live interest into a real opportunity.
            </div>
          ` : ''}
        </div>
      </article>
    </section>

    <section class="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
      <article class="rounded-[28px] border border-white/70 bg-white/75 p-6 shadow-[0_18px_40px_rgba(31,42,90,0.08)]">
        <h2 class="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mb-3">Property & Buyer Experience</h2>
        <p class="text-slate-600 font-medium leading-relaxed">Next, this panel should hold disclosures, property media, school info, walkability, and the rest of the guided in-home experience.</p>
      </article>

      <article class="rounded-[28px] border border-white/70 bg-white/75 p-6 shadow-[0_18px_40px_rgba(31,42,90,0.08)]">
        <h2 class="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mb-3">Debug Snapshot</h2>
        <div class="grid grid-cols-1 gap-3 text-sm">
          <div class="rounded-[18px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Open House Source</div>
            <div class="text-slate-900 font-bold break-all">${esc(eventRow?.open_house_source_id || '')}</div>
          </div>
          <div class="rounded-[18px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Agent Slug</div>
            <div class="text-slate-900 font-bold break-all">${esc(eventRow?.agent_slug || '')}</div>
          </div>
          <div class="rounded-[18px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Event Status</div>
            <div class="text-slate-900 font-bold">${esc(eventRow?.status || '')}</div>
          </div>
          <div class="rounded-[18px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Listing Link</div>
            <div class="text-slate-900 font-bold">${house?.link ? `<a class="text-sky-600 underline" href="${esc(safeUrl(house.link))}" target="_blank" rel="noopener noreferrer">Open Listing</a>` : '—'}</div>
          </div>
        </div>
      </article>
    </section>

    ${pageState.successMessage ? `
      <section class="rounded-[28px] border border-emerald-200 bg-emerald-50/90 p-6 shadow-[0_18px_40px_rgba(16,185,129,0.08)]">
        <h2 class="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-emerald-900 mb-3">You Are Checked In</h2>
        <p class="text-emerald-800 font-medium leading-relaxed">
          ${esc(pageState.successMessage)}
          ${lastCheckinNeedsFinancing ? ` ${pageState.financingAlertSent ? 'An SMS alert was also sent for the financing follow-up.' : 'Financing follow-up was flagged from this visit as well.'}` : ''}
        </p>
      </section>
    ` : ''}
  `);

  attachEventHandlers();
}

export async function initEventShellPage() {
  const eventId = getEventIdFromUrl();
  if (!eventId) {
    errorView(
      'Missing Event ID',
      'This event page is meant to open from a Smart Sign or a live event link. Open a sign flow first, or use a real event id in the URL.',
      `
        <a href="/sign" class="inline-flex items-center justify-center w-full md:w-auto px-8 py-4 rounded-full font-bold text-base md:text-lg text-white shadow-[0_18px_40px_rgba(59,130,246,0.28)]" style="background:linear-gradient(90deg,#38bdf8,#2563eb);">Open Smart Sign Flow</a>
        <a href="/claim" class="inline-flex items-center justify-center w-full md:w-auto px-8 py-4 rounded-full font-bold text-base md:text-lg bg-white/80 border border-white/80 text-slate-700">Open Claim Flow</a>
      `
    );
    return;
  }

  pageState.selectedPath = getPathFromUrl();
  loading('Resolving active event record...');

  try {
    const eventRow = await getEventById(eventId);
    if (!eventRow) {
      errorView('Event Not Found', 'No open house event was found for that event id.');
      return;
    }

    pageState.eventRow = eventRow;

    try {
      await touchEvent(eventId);
    } catch (error) {
      console.log('touchEvent skipped', error);
    }

    loading('Loading linked property...');
    pageState.house = eventRow.open_house_source_id
      ? await getOpenHouseById(eventRow.open_house_source_id)
      : null;

    pageState.agent = null;
    if (eventRow.agent_slug) {
      try {
        pageState.agent = await getAgentBySlug(eventRow.agent_slug);
      } catch (error) {
        console.log('getAgentBySlug skipped', error);
      }
    }

    renderEventShell();
  } catch (error) {
    console.error(error);
    errorView('Event Shell Failed', error.message || 'Something went wrong while loading this live event shell.');
  }
}
