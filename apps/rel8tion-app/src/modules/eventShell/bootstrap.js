import { ASSETS } from '../../core/config.js';
import { findListingAgentPhoto, getAgentBySlug } from '../../api/agents.js';
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
  mode: 'checkin',
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

function formatEventWindow(house) {
  try {
    if (!house?.open_start && !house?.open_end) return 'Today';
    const start = house?.open_start ? new Date(house.open_start) : null;
    const end = house?.open_end ? new Date(house.open_end) : null;
    const sameDay = start && end && start.toDateString() === end.toDateString();
    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric'
    });
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });

    if (start && end && sameDay) {
      return `${dateFormatter.format(start)} • ${timeFormatter.format(start)} - ${timeFormatter.format(end)}`;
    }
    if (start && end) {
      return `${dateFormatter.format(start)} - ${dateFormatter.format(end)}`;
    }
    if (start) {
      return `${dateFormatter.format(start)} • ${timeFormatter.format(start)}`;
    }
    return dateFormatter.format(end);
  } catch {
    return 'Today';
  }
}

function safeUrl(url) {
  if (!url) return '#';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://${url}`;
}

function telHref(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : '#';
}

function smsHref(phone, body = '') {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  if (!digits) return '#';
  return body ? `sms:${digits}?body=${encodeURIComponent(body)}` : `sms:${digits}`;
}

function mailtoHref(email, subject = '') {
  return email ? `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}` : '#';
}

function textOrDash(value) {
  return value ? esc(value) : '&mdash;';
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || '';
}

function agentPhotoUrl(agent) {
  return firstPresent(
    agent?.image_url,
    agent?.primary_photo_url,
    agent?.directory_photo_url,
    agent?.photo_url
  );
}

function hostAgentSlug(eventRow) {
  return firstPresent(
    eventRow?.host_agent_slug,
    eventRow?.agent_slug,
    eventRow?.setup_context?.agent_slug
  );
}

function formatNumber(value) {
  const n = Number(value || 0);
  return n ? n.toLocaleString() : '';
}

function propertyFacts(house) {
  return [
    { label: 'Beds', value: firstPresent(house?.beds, house?.bedrooms) },
    { label: 'Baths', value: firstPresent(house?.baths, house?.bathrooms) },
    { label: 'Sq Ft', value: formatNumber(firstPresent(house?.sqft, house?.square_feet, house?.living_area)) },
    { label: 'Taxes', value: house?.taxes ? money(house.taxes) : '' }
  ];
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
    return 'A fast direct check-in for buyers touring on their own. Clean, low-friction, and ready for follow-up the same day.';
  }
  if (path === CHECKIN_PATHS.BUYER_WITH_AGENT) {
    return 'For represented buyers touring with an agent already in the picture. Keep the buyer relationship visible from the first touchpoint.';
  }
  return 'For buyer agents checking in on behalf of a client. Document representation and keep the event record accurate in real time.';
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

function normalizeValue(value) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function hasContactInfo(email, phone) {
  return Boolean(normalizeValue(email) || normalizeValue(phone));
}

function validateCheckin(values) {
  if (!normalizeValue(values.visitor_name)) {
    throw new Error('Add the visitor name so this check-in stays tied to a real person.');
  }

  if (!hasContactInfo(values.visitor_email, values.visitor_phone)) {
    throw new Error('Add at least an email or phone number so there is a real follow-up path after the visit.');
  }

  if (pageState.selectedPath !== CHECKIN_PATHS.BUYER) {
    if (!normalizeValue(values.buyer_agent_name)) {
      throw new Error('Add the buyer agent name so the represented relationship is clearly documented.');
    }

    if (!hasContactInfo(values.buyer_agent_email, values.buyer_agent_phone)) {
      throw new Error('Add at least an email or phone number for the buyer agent.');
    }
  }

  if (pageState.selectedPath === CHECKIN_PATHS.BUYER_AGENT && values.represented_buyer_confirmed !== 'true') {
    throw new Error('Confirm that you represent this buyer before submitting the check-in.');
  }

  if (values.pre_approved === 'no' && !hasContactInfo(values.visitor_email, values.visitor_phone)) {
    throw new Error('Financing follow-up needs a real way to reach the buyer. Add an email or phone number.');
  }

  if (values.disclosure_accepted !== 'true') {
    throw new Error('Accept the disclosure to continue.');
  }

  if (!normalizeValue(values.signature_name)) {
    throw new Error('Type a full-name signature to complete the check-in.');
  }

  if (!normalizeValue(values.signature_date)) {
    throw new Error('Add today’s date to complete the check-in.');
  }
}

function buildCheckinPayload(formData) {
  const values = Object.fromEntries(formData.entries());
  validateCheckin(values);
  const preApproved = values.pre_approved === 'yes' ? true : (values.pre_approved === 'no' ? false : null);
  const financingRequested = values.financing_requested === 'true' || preApproved === false;
  const representedBuyerConfirmed = pageState.selectedPath === CHECKIN_PATHS.BUYER_WITH_AGENT
    ? true
    : values.represented_buyer_confirmed === 'true';

  return {
    open_house_event_id: pageState.eventRow.id,
    visitor_type: pageState.selectedPath,
    visitor_name: normalizeValue(values.visitor_name),
    visitor_phone: normalizeValue(values.visitor_phone),
    visitor_email: normalizeValue(values.visitor_email),
    buyer_agent_name: normalizeValue(values.buyer_agent_name),
    buyer_agent_phone: normalizeValue(values.buyer_agent_phone),
    buyer_agent_email: normalizeValue(values.buyer_agent_email),
    pre_approved: preApproved,
    represented_buyer_confirmed: representedBuyerConfirmed,
    metadata: {
      source: 'app-event-shell',
      path: pageState.selectedPath,
      relationship_state: representedBuyerConfirmed ? 'represented' : 'direct',
      disclosure_accepted: values.disclosure_accepted === 'true',
      signature_name: normalizeValue(values.signature_name),
      signature_date: normalizeValue(values.signature_date),
      signature_timestamp: new Date().toISOString(),
      financing_requested: financingRequested
    }
  };
}

function nextStepCards() {
  const house = pageState.house;
  const agent = pageState.agent;
  const subjectAddress = house?.address || 'this property';
  const askQuestionBody = `Hi${agent?.name ? ` ${agent.name}` : ''}, I just checked in through Rel8tion for ${subjectAddress} and had a quick question.`;
  const financingCopy = pageState.lastCheckin?.metadata?.financing_requested
    ? 'Financing help was requested from this visit, so your service-side follow-up can begin immediately.'
    : 'If financing comes up later, the event is already structured to route that request cleanly.';

  return `
    <section class="grid grid-cols-1 xl:grid-cols-[1.05fr_.95fr] gap-5 mb-5">
      <article class="rounded-[28px] border border-white/70 bg-white/78 p-6 shadow-[0_18px_40px_rgba(31,42,90,0.08)]">
        <div class="inline-flex items-center px-4 py-2 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700 mb-4">Checked In</div>
        <h2 class="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mb-3">Your Visit Is Live</h2>
        <p class="text-slate-600 font-medium leading-relaxed mb-5">
          This open-house visit is now tied to a real event, a real property, and the right people. That is the trust layer working the way it should.
        </p>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          <a href="${esc(safeUrl(house?.link || ''))}" ${house?.link ? 'target="_blank" rel="noopener noreferrer"' : ''} class="inline-flex items-center justify-center px-5 py-4 rounded-full font-bold text-sm md:text-base text-white shadow-[0_18px_40px_rgba(59,130,246,0.28)] ${house?.link ? '' : 'pointer-events-none opacity-60'}" style="background:linear-gradient(90deg,#38bdf8,#2563eb);">
            View Listing
          </a>
          <a href="${esc(smsHref(agent?.phone || '', askQuestionBody))}" class="inline-flex items-center justify-center px-5 py-4 rounded-full font-bold text-sm md:text-base bg-white/80 border border-slate-200 text-slate-700 ${agent?.phone ? '' : 'pointer-events-none opacity-60'}">
            Ask a Question
          </a>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Event Path</div>
            <div class="text-slate-900 font-black">${esc(PATH_LABELS[pageState.lastCheckin?.visitor_type || pageState.selectedPath] || 'Buyer')}</div>
          </div>
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Buyer Status</div>
            <div class="text-slate-900 font-black">${pageState.lastCheckin?.pre_approved === true ? 'Pre-Approved' : (pageState.lastCheckin?.pre_approved === false ? 'Needs Financing' : 'Status Not Shared')}</div>
          </div>
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Relationship</div>
            <div class="text-slate-900 font-black">${pageState.lastCheckin?.represented_buyer_confirmed ? 'Represented' : 'Direct Visitor'}</div>
          </div>
        </div>
      </article>

      <article class="rounded-[28px] border border-white/70 bg-white/78 p-6 shadow-[0_18px_40px_rgba(31,42,90,0.08)]">
        <h2 class="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mb-3">Next Best Actions</h2>
        <div class="space-y-4 text-slate-600 font-medium leading-relaxed">
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            Use this visit to answer the buyer’s immediate questions while the property is still in front of them.
          </div>
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            ${esc(financingCopy)}
          </div>
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            ${pageState.lastCheckin?.represented_buyer_confirmed
              ? 'Representation was preserved in the check-in record, which keeps the handoff cleaner for everyone involved.'
              : 'If the buyer returns with an agent later, Rel8tion can document that relationship at the event level too.'}
          </div>
        </div>
      </article>
    </section>

    <section class="grid grid-cols-1 lg:grid-cols-[1.05fr_.95fr] gap-5 mb-5">
      <article class="rounded-[28px] border border-white/70 bg-white/78 p-6 shadow-[0_18px_40px_rgba(31,42,90,0.08)]">
        <h2 class="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mb-4">Property Snapshot</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Address</div>
            <div class="text-slate-900 font-bold leading-relaxed">${esc(house?.address || 'Open House')}</div>
          </div>
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Open Window</div>
            <div class="text-slate-900 font-bold">${esc(formatEventWindow(house))}</div>
          </div>
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Price</div>
            <div class="text-slate-900 font-bold">${house?.price ? money(house.price) : '&mdash;'}</div>
          </div>
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Brokerage</div>
            <div class="text-slate-900 font-bold">${textOrDash(house?.brokerage)}</div>
          </div>
        </div>
      </article>

      <article class="rounded-[28px] border border-white/70 bg-white/78 p-6 shadow-[0_18px_40px_rgba(31,42,90,0.08)]">
        <h2 class="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mb-4">Host Contact</h2>
        <div class="rounded-[22px] bg-slate-50 border border-slate-100 p-5 mb-4">
          <div class="text-slate-900 font-black text-xl mb-1">${esc(agent?.name || hostAgentSlug(pageState.eventRow) || 'Host Agent')}</div>
          <div class="text-slate-600 font-semibold mb-3">${textOrDash(agent?.brokerage || house?.brokerage)}</div>
          <div class="space-y-1 text-slate-700 font-medium">
            <div>${textOrDash(agent?.phone)}</div>
            <div class="break-all">${textOrDash(agent?.email)}</div>
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <a href="${esc(telHref(agent?.phone || ''))}" class="inline-flex items-center justify-center px-4 py-4 rounded-full font-bold text-sm bg-white/80 border border-slate-200 text-slate-700 ${agent?.phone ? '' : 'pointer-events-none opacity-60'}">Call</a>
          <a href="${esc(smsHref(agent?.phone || '', `Hi${agent?.name ? ` ${agent.name}` : ''}, I just checked in for ${subjectAddress}.`))}" class="inline-flex items-center justify-center px-4 py-4 rounded-full font-bold text-sm bg-white/80 border border-slate-200 text-slate-700 ${agent?.phone ? '' : 'pointer-events-none opacity-60'}">Text</a>
          <a href="${esc(mailtoHref(agent?.email || '', `Question about ${subjectAddress}`))}" class="inline-flex items-center justify-center px-4 py-4 rounded-full font-bold text-sm bg-white/80 border border-slate-200 text-slate-700 ${agent?.email ? '' : 'pointer-events-none opacity-60'}">Email</a>
        </div>
      </article>
    </section>
  `;
}

function attachEventHandlers() {
  document.querySelectorAll('.path-button').forEach((button) => {
    button.addEventListener('click', () => {
      const nextPath = button.getAttribute('data-path');
      if (!nextPath || nextPath === pageState.selectedPath) return;
      pageState.selectedPath = nextPath;
      pageState.mode = 'checkin';
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
      const createdCheckin = await createCheckin(payload);
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

      pageState.lastCheckin = { ...payload, id: createdCheckin?.id || null };
      pageState.mode = 'guest';
      pageState.financingAlertSent = financingRequested;
      pageState.successMessage = financingRequested
        ? 'Check-in complete. Financing follow-up has been flagged from this visit.'
        : 'Check-in complete. Your visit is now linked to this live event.';
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
  const agentName = agent?.name || hostAgentSlug(eventRow) || 'Host Agent';
  const agentImage = agentPhotoUrl(agent);
  const facts = propertyFacts(house);

  const lastCheckinNeedsFinancing = pageState.lastCheckin?.metadata?.financing_requested === true;

  shell(`
    <div class="text-center mb-8">
      <div class="inline-flex items-center px-4 py-2 rounded-full bg-white/50 border border-white/70 text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-5">Verified Live Event</div>
      <h1 class="font-['Plus_Jakarta_Sans'] text-4xl md:text-6xl font-extrabold tracking-tight text-slate-900 mb-4">Welcome In</h1>
      <p class="text-slate-700 text-lg md:text-xl font-medium max-w-3xl mx-auto">This isn’t a floating form. It’s a real, time-stamped open-house event with the right property, the right host, and the right relationship trail behind it.</p>
    </div>

    <section class="rounded-[30px] overflow-hidden border border-white/70 bg-white/75 shadow-[0_18px_40px_rgba(31,42,90,0.08)] mb-6">
      <img src="${esc(image)}" alt="Property" class="w-full h-64 md:h-80 object-cover bg-slate-100">
      <div class="p-6 md:p-8">
        <div class="inline-flex items-center px-4 py-2 rounded-full text-xs font-black uppercase tracking-[0.18em] text-white mb-4" style="background:${status.color}">${esc(status.label)}</div>
        <div class="font-['Plus_Jakarta_Sans'] text-3xl md:text-5xl font-extrabold tracking-tight text-slate-900 mb-2">${esc(house?.address || 'Open House Event')}</div>
        ${house?.price ? `<div class="text-sky-600 font-black text-2xl md:text-3xl mb-3">${money(house.price)}</div>` : ''}
        <div class="text-slate-600 text-base md:text-lg font-semibold">${esc(house?.brokerage || 'Brokerage info available on event record')}</div>

        <div class="grid grid-cols-1 md:grid-cols-[1.25fr_.9fr_.9fr] gap-4 mt-6">
          <div class="rounded-[22px] bg-slate-50 border border-slate-100 p-4 flex items-center gap-4">
            ${agentImage ? `<img src="${esc(agentImage)}" onerror="this.style.display='none';" alt="${esc(agentName)}" class="w-16 h-16 rounded-full object-cover bg-white border border-white shadow-sm">` : ''}
            <div>
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Hosted By</div>
            <div class="text-slate-900 font-black text-lg">${esc(agentName)}</div>
            </div>
          </div>
          <div class="rounded-[22px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Open Window</div>
            <div class="text-slate-900 font-bold">${esc(formatEventWindow(house))}</div>
          </div>
          <div class="rounded-[22px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Event ID</div>
            <div class="text-slate-900 font-bold break-all">${esc(eventRow?.id || '')}</div>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          ${facts.map((fact) => `
            <div class="rounded-[18px] bg-white/80 border border-slate-100 p-4">
              <div class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">${esc(fact.label)}</div>
              <div class="text-slate-900 font-black text-lg">${fact.value ? esc(fact.value) : '&mdash;'}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <section class="grid grid-cols-1 lg:grid-cols-[1.2fr_.8fr] gap-5 mb-5">
      <article class="rounded-[28px] border border-white/70 bg-white/75 p-6 shadow-[0_18px_40px_rgba(31,42,90,0.08)]">
        <div class="flex flex-wrap gap-3 mb-5">
          ${pathButton(CHECKIN_PATHS.BUYER, PATH_LABELS[CHECKIN_PATHS.BUYER])}
          ${pathButton(CHECKIN_PATHS.BUYER_WITH_AGENT, PATH_LABELS[CHECKIN_PATHS.BUYER_WITH_AGENT])}
          ${pathButton(CHECKIN_PATHS.BUYER_AGENT, PATH_LABELS[CHECKIN_PATHS.BUYER_AGENT])}
        </div>

        <div class="rounded-[24px] border border-sky-100 bg-gradient-to-br from-sky-50/95 to-white p-5 mb-5">
          <div class="text-[11px] font-black uppercase tracking-[0.18em] text-sky-500 mb-2">Check-In Path</div>
          <h2 class="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mb-2">${esc(PATH_LABELS[selectedPath])}</h2>
          <p class="text-slate-600 font-medium leading-relaxed">${esc(getPathDescription(selectedPath))}</p>
        </div>

        ${pageState.mode === 'guest' ? `
          <div class="rounded-[24px] border border-emerald-200 bg-emerald-50/90 p-5 mb-5">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700 mb-2">Visit Confirmed</div>
            <p class="text-emerald-900 font-semibold leading-relaxed">${esc(pageState.successMessage)}</p>
          </div>
        ` : ''}

        ${pageState.mode === 'checkin' ? `
          <form id="checkin-form" class="space-y-4">
            ${renderFormFields()}
            ${renderDisclosureBlock()}
            ${selectedPath !== CHECKIN_PATHS.BUYER_AGENT ? renderFinancingBlock() : ''}
            <button type="submit" class="inline-flex items-center justify-center w-full px-8 py-4 rounded-full font-bold text-base md:text-lg text-white shadow-[0_18px_40px_rgba(59,130,246,0.28)] disabled:opacity-70" style="background:linear-gradient(90deg,#38bdf8,#2563eb);" ${pageState.submitting ? 'disabled' : ''}>
              ${pageState.submitting ? 'Saving Check-In...' : 'Complete Check-In'}
            </button>
            ${pageState.errorMessage ? `<div class="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-4 text-rose-700 font-semibold">${esc(pageState.errorMessage)}</div>` : ''}
          </form>
        ` : `
          <div class="space-y-4">
            <div class="rounded-[22px] border border-slate-200 bg-white/85 p-5">
              <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">What Happens Next</div>
              <p class="text-slate-700 font-medium leading-relaxed">You can still switch the path above if you need to log a different relationship type, but this visit is already tied to the active event and ready for the guided experience below.</p>
            </div>
            <button type="button" id="new-checkin-button" class="inline-flex items-center justify-center w-full px-8 py-4 rounded-full font-bold text-base md:text-lg bg-white/85 border border-slate-200 text-slate-700">
              Start Another Check-In
            </button>
          </div>
        `}
      </article>

      <article class="rounded-[28px] border border-white/70 bg-white/75 p-6 shadow-[0_18px_40px_rgba(31,42,90,0.08)]">
        <h2 class="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mb-3">Why This Feels Different</h2>
        <div class="space-y-4 text-slate-600 font-medium leading-relaxed">
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            The check-in is attached to a live event, not a generic page floating around with no property context.
          </div>
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            If a buyer shows up with representation, that relationship can be documented at the point of contact.
          </div>
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            Pre-approval status is captured while intent is high, not two days later in a cold follow-up thread.
          </div>
          ${lastCheckinNeedsFinancing ? `
            <div class="rounded-[20px] bg-sky-50 border border-sky-200 p-4">
              Financing follow-up was requested for this check-in.${pageState.financingAlertSent ? ' Your SMS alert path was triggered as well.' : ''} This turns an open-house visit into a live service opportunity instead of a forgotten note.
            </div>
          ` : ''}
        </div>
      </article>
    </section>

    ${pageState.mode === 'guest' ? nextStepCards() : ''}

    <section class="grid grid-cols-1 md:grid-cols-2 gap-5">
      <article class="rounded-[28px] border border-white/70 bg-white/75 p-6 shadow-[0_18px_40px_rgba(31,42,90,0.08)]">
        <h2 class="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mb-3">Live Event Details</h2>
        <div class="grid grid-cols-1 gap-3 text-sm">
          <div class="rounded-[18px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Hosted By</div>
            <div class="text-slate-900 font-bold">${esc(agentName)}</div>
          </div>
          <div class="rounded-[18px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Open House Source</div>
            <div class="text-slate-900 font-bold break-all">${esc(eventRow?.open_house_source_id || '')}</div>
          </div>
          <div class="rounded-[18px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Host Agent Slug</div>
            <div class="text-slate-900 font-bold break-all">${esc(hostAgentSlug(eventRow))}</div>
          </div>
          <div class="rounded-[18px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Event Status</div>
            <div class="text-slate-900 font-bold">${esc(eventRow?.status || '')}</div>
          </div>
          <div class="rounded-[18px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Listing Link</div>
            <div class="text-slate-900 font-bold">${house?.link ? `<a class="text-sky-600 underline" href="${esc(safeUrl(house.link))}" target="_blank" rel="noopener noreferrer">Open Listing</a>` : '&mdash;'}</div>
          </div>
        </div>
      </article>

      <article class="rounded-[28px] border border-white/70 bg-white/75 p-6 shadow-[0_18px_40px_rgba(31,42,90,0.08)]">
        <h2 class="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mb-3">What Comes Next</h2>
        <div class="space-y-4 text-slate-600 font-medium leading-relaxed">
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            This is where richer property content, school data, walkability, video, and disclosure packages can live next.
          </div>
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            The check-in is already being saved with a stronger relationship trail, so the UI can now keep getting better without redoing the event logic.
          </div>
        </div>
      </article>
    </section>
  `);

  attachEventHandlers();

  const newCheckinButton = document.getElementById('new-checkin-button');
  newCheckinButton?.addEventListener('click', () => {
    pageState.mode = 'checkin';
    pageState.successMessage = '';
    pageState.errorMessage = '';
    renderEventShell();
  });
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
  pageState.mode = 'checkin';
  pageState.successMessage = '';
  pageState.errorMessage = '';
  pageState.lastCheckin = null;
  pageState.financingAlertSent = false;
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
    const agentSlug = hostAgentSlug(eventRow);
    if (agentSlug) {
      try {
        pageState.agent = await getAgentBySlug(agentSlug);
        if (pageState.agent && !agentPhotoUrl(pageState.agent)) {
          const photo = await findListingAgentPhoto({
            openHouseId: eventRow.open_house_source_id || '',
            name: pageState.agent.name || '',
            phone: pageState.agent.phone || ''
          });
          if (photo) pageState.agent.image_url = photo;
        }
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
