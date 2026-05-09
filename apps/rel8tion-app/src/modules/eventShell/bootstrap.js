import { ASSETS, NYS_HOUSING_ANTI_DISCRIMINATION_DISCLOSURE_PDF_URL } from '../../core/config.js';
import { findListingAgentPhoto, getAgentBySlug } from '../../api/agents.js?v=20260427-3props';
import { applyBranding } from '../../api/brokerages.js';
import { createCheckin, generateSignedDisclosurePdf, getDisclosurePreviewUrl, getEventById, getLiveLoanOfficerSession, touchEvent } from '../../api/events.js?v=20260508-nys-pdf';
import { sendAgentCheckinSMS, sendBuyerConfirmationSMS, sendBuyerLoanOfficerIntroSMS, sendJaredFinancingAlert, sendLiveLoanOfficerFinancingAlert } from '../../api/notifications.js?v=20260503-lo-live';
import { getOpenHouseById } from '../../api/openHouses.js?v=20260427-3props';
import { state as appState } from '../../core/state.js';
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

const NY_DISCRIMINATION_DISCLOSURE = Object.freeze({
  form_name: 'New York State Housing and Anti-Discrimination Disclosure Form',
  form_code: 'DOS-2156',
  form_version: '11/25'
});

const NYS_AGENCY_DISCLOSURE_PDF_URL = 'https://nicanqrfqlbnlmnoernb.supabase.co/storage/v1/object/public/compliance/nysellerbuyerdisclosure.pdf';
const NYS_AGENCY_DISCLOSURE_VERSION = 'nys-dos-buyer-seller-disclosure-v1';
const NYS_AGENCY_DISCLOSURE_TYPE = 'seller_representation_open_house';

const pageState = {
  eventRow: null,
  house: null,
  agent: null,
  brand: null,
  loanOfficer: null,
  selectedPath: CHECKIN_PATHS.BUYER,
  mode: 'checkin',
  submitting: false,
  successMessage: '',
  errorMessage: '',
  lastCheckin: null,
  financingAlertSent: false,
  requiredDisclosures: {
    agency: null,
    housing: null,
    courtesy: null
  }
};

let disclosureEscapeHandlerBound = false;

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

function removeDisclosurePortals() {
  document.querySelectorAll('.rel8tion-disclosure-modal').forEach((modal) => {
    if (!document.getElementById('app')?.contains(modal)) modal.remove();
  });
  document.body.classList.remove('rel8tion-modal-open');
}

function shell(content) {
  removeDisclosurePortals();
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
    const graceEnd = end ? new Date(end.getTime() + 6 * 60 * 60 * 1000) : null;
    const today = start && start.toDateString() === now.toDateString();
    if (start && end && now >= start && (!graceEnd || now <= graceEnd)) return { label: 'Live Now', color: '#16a34a' };
    if (today) return { label: 'Open Today', color: '#16a34a' };
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

function safeColor(value, fallback) {
  const color = String(value || '').trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : fallback;
}

function eventTheme() {
  const brand = pageState.brand || appState.currentBrand || {};
  const primary = safeColor(brand.primary_color, '#1f2a5a');
  const accent = safeColor(brand.accent_color, '#2563eb');
  const text = safeColor(brand.text_color, '#0f172a');
  const font = String(brand.font_family || '').replace(/[";{}]/g, '').trim();
  return {
    primary,
    accent,
    text,
    gradient: `linear-gradient(90deg, ${primary}, ${accent})`,
    fontFamily: font ? `"${font}", Inter, sans-serif` : 'Inter, sans-serif'
  };
}

function themeStyle(extra = '') {
  const theme = eventTheme();
  return `--event-primary:${theme.primary};--event-accent:${theme.accent};--event-text:${theme.text};--event-gradient:${theme.gradient};font-family:${theme.fontFamily};${extra}`;
}

function primaryButtonClass() {
  return 'inline-flex items-center justify-center rounded-full px-5 py-4 text-center text-base font-black text-white shadow-[0_18px_40px_rgba(31,42,90,0.20)]';
}

function isOneKeyUrl(url) {
  try {
    return new URL(safeUrl(url)).hostname.replace(/^www\./, '') === 'onekeymls.com';
  } catch {
    return false;
  }
}

function oneKeyMlsNumber(house) {
  const raw = firstPresent(house?.mls_number, house?.mls_id, house?.listing_id, house?.id);
  const match = String(raw || '').match(/(\d{5,})$/);
  return match ? match[1] : '';
}

function oneKeyAddressSlug(address) {
  return String(address || '')
    .replace(/#/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

function oneKeyListingUrl(house) {
  if (house?.link && isOneKeyUrl(house.link)) return safeUrl(house.link);

  const source = String(house?.source || '').toLowerCase();
  const id = String(house?.id || '');
  const mlsNumber = oneKeyMlsNumber(house);
  const addressSlug = oneKeyAddressSlug(house?.address);
  const looksOneKey = source === 'onekey' || id.startsWith('M00000489-');

  if (!looksOneKey || !mlsNumber || !addressSlug) return '';
  return `https://www.onekeymls.com/address/${encodeURIComponent(addressSlug)}/${encodeURIComponent(mlsNumber)}`;
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

function vcardHref(agent) {
  if (!agent?.name && !agent?.phone && !agent?.email) return '#';
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${agent?.name || 'Host Agent'}`,
    agent?.brokerage ? `ORG:${agent.brokerage}` : '',
    agent?.phone ? `TEL;TYPE=CELL:${agent.phone}` : '',
    agent?.email ? `EMAIL:${agent.email}` : '',
    'END:VCARD'
  ].filter(Boolean);
  return `data:text/vcard;charset=utf-8,${encodeURIComponent(lines.join('\n'))}`;
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

function initials(name) {
  const parts = String(name || 'Host Agent').trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] || 'H'}${parts[1]?.[0] || 'A'}`.toUpperCase();
}

function propertyImageUrl(house) {
  return firstPresent(
    house?.image,
    house?.image_url,
    house?.listing_photo_url,
    house?.primary_photo_url,
    house?.photo_url,
    house?.thumbnail_url,
    house?.media_url,
    Array.isArray(house?.media) ? house.media[0]?.url || house.media[0]?.MediaURL : ''
  );
}

function renderPropertyImage(house, classes = 'h-24 w-24') {
  const image = propertyImageUrl(house);
  if (image) {
    return `<img src="${esc(image)}" onerror="this.style.display='none';" alt="${esc(house?.address || 'Open house property')}" class="${classes} rounded-[24px] border border-white/80 bg-white object-cover shadow-sm">`;
  }
  return `
    <div class="${classes} rounded-[24px] border border-white/80 bg-white/70 shadow-sm flex items-center justify-center text-center px-3 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
      Property
    </div>
  `;
}

function renderAgentImage(agent, classes = 'h-16 w-16') {
  const agentName = agent?.name || 'Host Agent';
  const image = agentPhotoUrl(agent);
  if (image) {
    return `<img src="${esc(image)}" onerror="this.outerHTML='<div class=&quot;${classes} flex shrink-0 items-center justify-center rounded-full bg-white/80 text-xl font-black text-slate-700 shadow-sm&quot;>${esc(initials(agentName))}</div>';" alt="${esc(agentName)}" class="${classes} shrink-0 rounded-full border border-white bg-white object-cover shadow-sm">`;
  }
  return `<div class="${classes} flex shrink-0 items-center justify-center rounded-full bg-white/80 text-xl font-black text-slate-700 shadow-sm">${esc(initials(agentName))}</div>`;
}

function eventAreaLabel(house) {
  const address = String(house?.address || '').split(',').map((part) => part.trim()).filter(Boolean);
  if (address.length >= 2) return address[1].replace(/\s+NY\b.*$/i, '').trim();
  return address[0] || '';
}

function agentBioText(agent, house) {
  const savedBio = firstPresent(
    agent?.bio,
    agent?.about,
    agent?.profile_bio,
    agent?.description,
    agent?.tagline,
    agent?.headline
  );
  if (savedBio) return savedBio;

  const agentName = agent?.name || 'The host agent';
  const brokerage = agent?.brokerage || house?.brokerage || '';
  const area = eventAreaLabel(house);
  return `${agentName}${brokerage ? ` with ${brokerage}` : ''} is hosting this open house and can help with questions about the property, the neighborhood, and next steps after your visit${area ? ` in ${area}` : ''}.`;
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
  const style = selected ? 'background:var(--event-gradient);' : '';
  return `
    <button type="button" data-path="${path}" class="path-button inline-flex min-h-[42px] items-center justify-center rounded-full px-3.5 py-2 text-center text-[12px] font-black leading-tight ${buttonClasses(selected)}" ${style ? `style="${style}"` : ''}>
      ${esc(label)}
    </button>
  `;
}

function renderPathSelector() {
  return `
    <div class="mb-5 rounded-[18px] border border-slate-200 bg-white/78 p-3">
      <div class="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Check-in path</div>
      <div class="grid grid-cols-3 gap-2">
        ${pathButton(CHECKIN_PATHS.BUYER, 'Buyer')}
        ${pathButton(CHECKIN_PATHS.BUYER_WITH_AGENT, 'With Agent')}
        ${pathButton(CHECKIN_PATHS.BUYER_AGENT, 'Agent')}
      </div>
    </div>
  `;
}

function inputAttrsFor(name, type) {
  const map = {
    visitor_name: 'name',
    visitor_phone: 'tel',
    visitor_email: 'email',
    buyer_agent_name: 'organization-title',
    buyer_agent_phone: 'tel',
    buyer_agent_email: 'email'
  };
  const attrs = [`autocomplete="${map[name] || 'on'}"`];
  if (type === 'tel') attrs.push('inputmode="tel"');
  if (type === 'email') attrs.push('inputmode="email"', 'autocapitalize="none"');
  if (type === 'text') attrs.push('autocapitalize="words"');
  return attrs.join(' ');
}

function requiredMarker(required) {
  return required ? '<span class="ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style="background:var(--event-accent)" title="Required" aria-label="Required"></span>' : '';
}

function field(label, name, type = 'text', placeholder = '', required = false) {
  return `
    <label class="block">
      <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">${esc(label)}${requiredMarker(required)}</div>
      <input name="${name}" type="${type}" ${inputAttrsFor(name, type)} ${required ? 'required aria-required="true"' : ''} placeholder="${esc(placeholder)}" class="w-full rounded-[18px] border border-slate-200 bg-white/92 px-4 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-[var(--event-accent)]">
    </label>
  `;
}

function todayDateValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function selectField(label, name, options, required = false) {
  return `
    <label class="block">
      <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">${esc(label)}${requiredMarker(required)}</div>
      <select name="${name}" ${required ? 'required aria-required="true"' : ''} class="w-full rounded-[18px] border border-slate-200 bg-white/92 px-4 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-[var(--event-accent)]">
        ${options.map((option) => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('')}
      </select>
    </label>
  `;
}

function getPathDescription(path) {
  if (path === CHECKIN_PATHS.BUYER) {
    return 'Check in quickly so the host can follow up with the right property details.';
  }
  if (path === CHECKIN_PATHS.BUYER_WITH_AGENT) {
    return 'Add your information and your agent so the host knows you are represented.';
  }
  return 'Check in on behalf of your buyer and keep the visit connected to your representation.';
}

function renderFormFields() {
  if (pageState.selectedPath === CHECKIN_PATHS.BUYER) {
    return `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${field('Your Name', 'visitor_name', 'text', 'Full name', true)}
        ${field('Phone', 'visitor_phone', 'tel', 'Mobile number', true)}
        <div class="md:col-span-2">
          ${field('Email', 'visitor_email', 'email', 'Email address')}
        </div>
        <div class="md:col-span-2">
          ${selectField('Pre-Approved', 'pre_approved', [
            { value: '', label: 'Select' },
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' }
          ], true)}
        </div>
      </div>
    `;
  }

  if (pageState.selectedPath === CHECKIN_PATHS.BUYER_WITH_AGENT) {
    return `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${field('Buyer Name', 'visitor_name', 'text', 'Full name', true)}
        ${field('Buyer Phone', 'visitor_phone', 'tel', 'Mobile number', true)}
        <div class="md:col-span-2">
          ${field('Buyer Email', 'visitor_email', 'email', 'Email address')}
        </div>
        ${field('Buyer Agent Name', 'buyer_agent_name', 'text', 'Agent name', true)}
        ${field('Buyer Agent Phone', 'buyer_agent_phone', 'tel', 'Agent phone', true)}
        <div class="md:col-span-2">
          ${field('Buyer Agent Email', 'buyer_agent_email', 'email', 'Agent email')}
        </div>
        <div class="md:col-span-2">
          ${selectField('Buyer Pre-Approved', 'pre_approved', [
            { value: '', label: 'Select' },
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' }
          ], true)}
        </div>
      </div>
    `;
  }

  return `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      ${field('Buyer Agent Name', 'buyer_agent_name', 'text', 'Agent name', true)}
      ${field('Buyer Agent Phone', 'buyer_agent_phone', 'tel', 'Agent phone', true)}
      <div class="md:col-span-2">
        ${field('Buyer Agent Email', 'buyer_agent_email', 'email', 'Agent email')}
      </div>
      ${field('Buyer Name', 'visitor_name', 'text', 'Buyer name', true)}
      ${field('Buyer Phone', 'visitor_phone', 'tel', 'Buyer phone', true)}
      <div class="md:col-span-2">
        ${field('Buyer Email', 'visitor_email', 'email', 'Buyer email')}
      </div>
      <label class="md:col-span-2 flex items-start gap-3 rounded-[18px] border border-slate-200 bg-white/80 px-4 py-4 text-slate-700 font-semibold">
        <input type="checkbox" name="represented_buyer_confirmed" value="true" class="mt-1 h-4 w-4 rounded border-slate-300">
        <span>I represent this buyer and want that relationship documented with this check-in.</span>
      </label>
    </div>
  `;
}

function disclosureContext() {
  const house = pageState.house || {};
  const setup = pageState.eventRow?.setup_context || {};
  return {
    agentName: firstPresent(pageState.agent?.name, setup.agent_name, pageState.eventRow?.host_agent_slug, 'Host Agent'),
    brokerage: firstPresent(pageState.agent?.brokerage, house?.brokerage, setup.detected_brokerage, setup.brokerage, ''),
    address: firstPresent(house?.address, setup.address, ''),
    eventId: pageState.eventRow?.id || '',
    openHouseSourceId: pageState.eventRow?.open_house_source_id || '',
    openWindow: formatEventWindow({
      open_start: firstPresent(house?.open_start, pageState.eventRow?.start_time),
      open_end: firstPresent(house?.open_end, pageState.eventRow?.end_time)
    })
  };
}

function renderDisclosureBlock() {
  const context = disclosureContext();
  const today = todayDateValue();
  const disclosureUrl = getDisclosurePreviewUrl(pageState.eventRow?.id) || NYS_HOUSING_ANTI_DISCRIMINATION_DISCLOSURE_PDF_URL;

  return `
    <div class="rounded-[22px] border border-sky-200 bg-white/90 p-5 space-y-4">
      <div>
        <div class="text-[11px] font-black uppercase tracking-[0.18em] text-sky-500 mb-2">Required Compliance</div>
        <h3 class="font-['Plus_Jakarta_Sans'] text-2xl font-extrabold tracking-tight text-slate-900">NYS Housing & Anti-Discrimination Disclosure</h3>
        <p class="mt-2 text-slate-600 font-medium leading-relaxed">
          Review the official form, then check the acknowledgement below. Your check-in name will be used as your electronic signature.
        </p>
      </div>

      <div class="grid grid-cols-1 gap-3 text-sm">
        <div class="rounded-[18px] border border-slate-100 bg-slate-50/90 p-4">
          <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Provided by</div>
          <div class="text-slate-900 font-black">${esc(context.agentName)}</div>
        </div>
        <div class="rounded-[18px] border border-slate-100 bg-slate-50/90 p-4">
          <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Brokerage</div>
          <div class="text-slate-900 font-black">${textOrDash(context.brokerage)}</div>
        </div>
        <div class="rounded-[18px] border border-slate-100 bg-slate-50/90 p-4">
          <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Date</div>
          <div class="text-slate-900 font-black">${esc(today)}</div>
        </div>
      </div>

      <input type="hidden" name="ny_disclosure_signed_date" value="${esc(today)}">
      <input type="hidden" id="ny-disclosure-signature-value" name="ny_disclosure_signature" value="">
      <a
        href="${esc(disclosureUrl)}"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex w-full items-center justify-center rounded-full px-5 py-4 text-center text-base font-black text-white shadow-[0_18px_40px_rgba(59,130,246,0.24)]"
        style="background:linear-gradient(90deg,#38bdf8,#2563eb);"
      >
        View Disclosure Form
      </a>

      <div class="rounded-[18px] border border-slate-200 bg-white/85 px-4 py-4">
        <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Electronic Signature</div>
        <div id="ny-disclosure-signature-preview" class="text-slate-900 font-black">Enter your name above</div>
      </div>

      <label class="flex items-start gap-3 rounded-[18px] border border-slate-200 bg-white/85 px-4 py-4 text-slate-700 font-semibold">
        <input type="checkbox" name="ny_disclosure_acknowledged" value="true" required class="mt-1 h-4 w-4 rounded border-slate-300">
        <span>I acknowledge that I received and reviewed the New York State Housing and Anti-Discrimination Disclosure Form, and I agree that my check-in name serves as my electronic signature for this acknowledgement.</span>
      </label>
    </div>
  `;
}

function disclosureSignedTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function disclosureStatusBlock(id, signedAt = '') {
  const signedTime = disclosureSignedTime(signedAt);
  const signedClasses = 'rounded-[16px] border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm font-black text-emerald-700';
  const unsignedClasses = 'rounded-[16px] border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm font-bold text-slate-500';
  return `
    <div id="${id}" class="${signedTime ? signedClasses : unsignedClasses}">
      ${signedTime ? `Accepted / Signed ${esc(signedTime)}` : 'Not signed yet'}
    </div>
  `;
}

function renderDisclosureActionCard({ key, title, description }) {
  const signedAt = pageState.requiredDisclosures?.[key]?.signed_at || '';
  return `
    <div class="rounded-[22px] border border-slate-200 bg-white/90 p-5 space-y-4">
      <div>
        <h4 class="font-['Plus_Jakarta_Sans'] text-xl font-extrabold tracking-tight text-slate-900">${esc(title)}</h4>
        <p class="mt-2 text-slate-600 font-medium leading-relaxed">${esc(description)}</p>
      </div>
      ${disclosureStatusBlock(`${key}-status`, signedAt)}
      <button
        type="button"
        data-disclosure-open="${esc(key)}"
        class="inline-flex w-full items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-4 text-center text-base font-black text-slate-800"
      >
        ${signedAt ? 'Review Again' : 'Review & Sign'}
      </button>
    </div>
  `;
}

function renderAgencyDisclosureModal() {
  return `
    <div id="agency-disclosure-modal" class="rel8tion-disclosure-modal hidden" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="agency-disclosure-title">
      <div class="rel8tion-disclosure-panel w-full max-w-xl rounded-[28px] border border-white/80 bg-white p-5 shadow-[0_28px_80px_rgba(15,23,42,0.28)]" tabindex="-1">
        <div class="mb-4 flex items-start justify-between gap-4">
          <div>
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-600 mb-2">Required Disclosure</div>
            <h3 id="agency-disclosure-title" class="font-['Plus_Jakarta_Sans'] text-2xl font-extrabold tracking-tight text-slate-900">New York State Agency Disclosure</h3>
          </div>
          <button type="button" data-disclosure-close class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600">Close</button>
        </div>
        <div class="space-y-4 text-slate-700 font-medium leading-relaxed">
          <p>At this open house, the listing agent may currently represent the seller. This disclosure is meant to make the agency relationship clear from the beginning.</p>
          <p>Please review the official New York State Agency Disclosure PDF before signing.</p>
        </div>
        <a
          href="${esc(NYS_AGENCY_DISCLOSURE_PDF_URL)}"
          target="_blank"
          rel="noopener noreferrer"
          class="mt-5 inline-flex w-full items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-4 text-center text-base font-black text-slate-800"
        >
          View NYS Agency Disclosure PDF
        </a>
        <button
          type="button"
          data-disclosure-accept="agency"
          class="mt-3 inline-flex w-full items-center justify-center rounded-full bg-emerald-600 px-5 py-4 text-center text-base font-black text-white shadow-[0_18px_40px_rgba(22,163,74,0.24)]"
        >
          Accept / Sign
        </button>
      </div>
    </div>
  `;
}

function renderCourtesyNoticeModal() {
  return `
    <div id="courtesy-disclosure-modal" class="rel8tion-disclosure-modal hidden" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="courtesy-disclosure-title">
      <div class="rel8tion-disclosure-panel w-full max-w-xl rounded-[28px] border border-white/80 bg-white p-5 shadow-[0_28px_80px_rgba(15,23,42,0.28)]" tabindex="-1">
        <div class="mb-4 flex items-start justify-between gap-4">
          <div>
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-600 mb-2">Courtesy Notice</div>
            <h3 id="courtesy-disclosure-title" class="font-['Plus_Jakarta_Sans'] text-2xl font-extrabold tracking-tight text-slate-900">Rel8tion Courtesy Notice</h3>
          </div>
          <button type="button" data-disclosure-close class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600">Close</button>
        </div>
        <div class="max-h-[58vh] space-y-4 overflow-y-auto pr-1 text-slate-700 font-medium leading-relaxed">
          <p>Rel8tion was created to make real estate interactions clearer, faster, and more transparent for everyone involved.</p>
          <p>At this open house, the listing agent may currently represent the seller. This does not mean you are alone, unwelcome, or unable to ask questions. It simply means the relationship is being disclosed clearly from the start.</p>
          <p>Rel8tion supports fair housing, equal treatment, clear communication, professional accountability, and informed decision-making.</p>
          <p>Rel8tion does not replace or modify any required agency disclosure. Rel8tion helps document and clarify the interaction, but does not create a buyer-agent, dual-agency, legal, lending, or fiduciary relationship unless separately agreed to in writing.</p>
          <p>You may choose your own real estate agent, attorney, lender, inspector, or other professional at any time.</p>
        </div>
        <button
          type="button"
          data-disclosure-accept="courtesy"
          class="mt-5 inline-flex w-full items-center justify-center rounded-full bg-emerald-600 px-5 py-4 text-center text-base font-black text-white shadow-[0_18px_40px_rgba(22,163,74,0.24)]"
        >
          Accept / Sign
        </button>
      </div>
    </div>
  `;
}

function renderDisclosureMiniPreview({ label, url }) {
  return `
    <button type="button" data-disclosure-preview-toggle class="mt-4 flex w-full items-center gap-3 rounded-[18px] border border-slate-200 bg-slate-50/90 p-3 text-left">
      <span class="flex h-16 w-12 shrink-0 items-center justify-center rounded-[10px] border border-slate-200 bg-white text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">PDF</span>
      <span class="min-w-0">
        <span class="block text-sm font-black text-slate-900">${esc(label)}</span>
        <span class="block text-xs font-semibold text-slate-500">Tap to expand preview</span>
      </span>
    </button>
    <div class="disclosure-pdf-preview mt-3 hidden overflow-hidden rounded-[18px] border border-slate-200 bg-white">
      <iframe src="${esc(url)}" title="${esc(label)}" class="h-[360px] w-full bg-white"></iframe>
      <a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="block border-t border-slate-200 px-4 py-3 text-center text-sm font-black text-[var(--event-accent)]">Open full PDF</a>
    </div>
  `;
}

function renderLendingDisclosureStep() {
  const liveLoanOfficer = pageState.loanOfficer;
  const officerName = firstPresent(liveLoanOfficer?.loan_officer_name, liveLoanOfficer?.name, 'a live loan officer');
  const hasLiveLoanOfficer = Boolean(liveLoanOfficer?.loan_officer_slug || liveLoanOfficer?.loan_officer_phone);

  return `
    <div data-guided-disclosure-panel="lending" class="guided-disclosure-panel hidden space-y-4">
      <div data-lending-mode="none" class="rounded-[18px] border border-amber-200 bg-amber-50/90 p-4 text-amber-950 font-semibold">
        Choose pre-approved status on the check-in form before finishing the required disclosures.
      </div>

      <div data-lending-mode="yes" class="hidden space-y-4">
        <div>
          <div class="text-[11px] font-black uppercase tracking-[0.18em] text-sky-500 mb-2">Financing Option</div>
          <p class="text-slate-700 font-medium leading-relaxed">
            Rel8tion strongly believes it is all about who you know. We have amazing professionals willing to give you a second opinion with no impact to your credit, potentially saving you thousands.
          </p>
        </div>
        <fieldset>
          <legend class="mb-3 text-slate-900 font-black">Ok to reach out?</legend>
          <div class="grid grid-cols-2 gap-3">
            <label class="flex items-center justify-center rounded-[18px] border border-slate-200 bg-white/90 px-4 py-4 font-black text-slate-800">
              <input form="checkin-form" type="radio" name="second_opinion_ok" value="yes" class="mr-2">
              Yes
            </label>
            <label class="flex items-center justify-center rounded-[18px] border border-slate-200 bg-white/90 px-4 py-4 font-black text-slate-800">
              <input form="checkin-form" type="radio" name="second_opinion_ok" value="no" class="mr-2">
              No
            </label>
          </div>
        </fieldset>
      </div>

      <div data-lending-mode="no" class="hidden rounded-[18px] border border-emerald-200 bg-emerald-50/90 p-4">
        <div class="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700 mb-2">
          ${hasLiveLoanOfficer ? 'Live Loan Officer Available' : 'Lending Specialist Available'}
        </div>
        <p class="text-emerald-950 font-semibold leading-relaxed">
          ${hasLiveLoanOfficer
            ? `${esc(officerName)} is assisting this open house and can be with you shortly after check-in.`
            : 'A lending specialist can follow up discreetly after check-in.'}
        </p>
        <label class="mt-3 flex items-start gap-3 text-emerald-950 font-black">
          <input form="checkin-form" type="checkbox" name="loan_officer_contact_ok" value="true" class="mt-1 h-4 w-4 rounded border-emerald-300">
          <span>Accept to speak discreetly about instant pre-approval.</span>
        </label>
      </div>

      <button type="button" data-guided-disclosure-accept="lending" class="${primaryButtonClass()} w-full" style="background:var(--event-gradient);">Continue</button>
    </div>
  `;
}

function renderGuidedDisclosuresModal() {
  const context = disclosureContext();
  const today = todayDateValue();
  const housingUrl = getDisclosurePreviewUrl(pageState.eventRow?.id) || NYS_HOUSING_ANTI_DISCRIMINATION_DISCLOSURE_PDF_URL;

  return `
    <div id="required-disclosures-modal" class="rel8tion-disclosure-modal hidden" style="${themeStyle()}" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="required-disclosure-title">
      <div class="rel8tion-disclosure-panel w-full max-w-xl rounded-[28px] border border-white/80 bg-white p-5 shadow-[0_28px_80px_rgba(15,23,42,0.28)]" tabindex="-1">
        <div class="mb-4 flex items-start justify-between gap-4">
          <div>
            <div id="required-disclosure-kicker" class="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-600 mb-2">Step 1 of 5</div>
            <h3 id="required-disclosure-title" class="font-['Plus_Jakarta_Sans'] text-2xl font-extrabold tracking-tight text-slate-900">New York State Agency Disclosure</h3>
          </div>
          <button type="button" data-disclosure-close class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600">Close</button>
        </div>
        <div id="guided-disclosure-error" class="mb-4 hidden rounded-[16px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-700"></div>

        <div data-guided-disclosure-panel="agency" class="guided-disclosure-panel space-y-4">
          <div class="space-y-4 text-slate-700 font-medium leading-relaxed">
            <p>At this open house, the listing agent may currently represent the seller. This disclosure is meant to make the agency relationship clear from the beginning.</p>
            <p>Please review the official New York State Agency Disclosure PDF before signing.</p>
          </div>
          <a href="${esc(NYS_AGENCY_DISCLOSURE_PDF_URL)}" target="_blank" rel="noopener noreferrer" class="inline-flex w-full items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-4 text-center text-base font-black text-slate-800">View NYS Agency Disclosure PDF</a>
          ${renderDisclosureMiniPreview({ label: 'NYS Agency Disclosure', url: NYS_AGENCY_DISCLOSURE_PDF_URL })}
          <button type="button" data-guided-disclosure-accept="agency" class="${primaryButtonClass()} w-full bg-emerald-600">Accept / Sign</button>
        </div>

        <div data-guided-disclosure-panel="housing" class="guided-disclosure-panel hidden space-y-4">
          <div class="space-y-4 text-slate-700 font-medium leading-relaxed">
            <p>Review the New York State Housing and Anti-Discrimination Disclosure Form before continuing.</p>
            <p>Your check-in name will be used as your electronic signature for the final acknowledgement.</p>
          </div>
          <div class="grid grid-cols-1 gap-3 text-sm">
            <div class="rounded-[18px] border border-slate-100 bg-slate-50/90 p-4">
              <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Provided by</div>
              <div class="text-slate-900 font-black">${esc(context.agentName)}</div>
            </div>
            <div class="rounded-[18px] border border-slate-100 bg-slate-50/90 p-4">
              <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Brokerage</div>
              <div class="text-slate-900 font-black">${textOrDash(context.brokerage)}</div>
            </div>
            <div class="rounded-[18px] border border-slate-100 bg-slate-50/90 p-4">
              <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Date</div>
              <div class="text-slate-900 font-black">${esc(today)}</div>
            </div>
          </div>
          <a href="${esc(housingUrl)}" target="_blank" rel="noopener noreferrer" class="inline-flex w-full items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-4 text-center text-base font-black text-slate-800">View Prefilled Disclosure Packet</a>
          ${renderDisclosureMiniPreview({ label: 'NYS Housing & Anti-Discrimination Disclosure', url: housingUrl })}
          <button type="button" data-guided-disclosure-accept="housing" class="${primaryButtonClass()} w-full bg-emerald-600">I Reviewed This Form</button>
        </div>

        <div data-guided-disclosure-panel="courtesy" class="guided-disclosure-panel hidden space-y-4">
          <div class="max-h-[52vh] space-y-4 overflow-y-auto pr-1 text-slate-700 font-medium leading-relaxed">
            <p>Rel8tion was created to make real estate interactions clearer, faster, and more transparent for everyone involved.</p>
            <p>At this open house, the listing agent may currently represent the seller. This does not mean you are alone, unwelcome, or unable to ask questions. It simply means the relationship is being disclosed clearly from the start.</p>
            <p>Rel8tion supports fair housing, equal treatment, clear communication, professional accountability, and informed decision-making.</p>
            <p>Rel8tion does not replace or modify any required agency disclosure. Rel8tion helps document and clarify the interaction, but does not create a buyer-agent, dual-agency, legal, lending, or fiduciary relationship unless separately agreed to in writing.</p>
            <p>You may choose your own real estate agent, attorney, lender, inspector, or other professional at any time.</p>
          </div>
          <button type="button" data-guided-disclosure-accept="courtesy" class="${primaryButtonClass()} w-full bg-emerald-600">Accept / Sign</button>
        </div>

        ${renderLendingDisclosureStep()}

        <div data-guided-disclosure-panel="final" class="guided-disclosure-panel hidden space-y-4">
          <div class="rounded-[18px] border border-slate-200 bg-white/85 px-4 py-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Electronic Signature</div>
            <div id="ny-disclosure-signature-preview" class="text-slate-900 font-black">Enter your name above</div>
          </div>
          <label class="flex items-start gap-3 rounded-[18px] border border-slate-200 bg-white/85 px-4 py-4 text-slate-700 font-semibold">
            <input type="checkbox" id="ny-disclosure-final-checkbox" form="checkin-form" name="ny_disclosure_acknowledged" value="true" class="mt-1 h-4 w-4 rounded border-slate-300">
            <span>I acknowledge that I received and reviewed the New York State Housing and Anti-Discrimination Disclosure Form, and I agree that my check-in name serves as my electronic signature for this acknowledgement.</span>
          </label>
          <button id="guided-complete-checkin" type="submit" form="checkin-form" class="${primaryButtonClass()} hidden w-full" style="background:var(--event-gradient);">Complete Check-In</button>
        </div>
      </div>
    </div>
  `;
}

function renderRequiredDisclosuresBlock() {
  const agency = pageState.requiredDisclosures.agency || {};
  const courtesy = pageState.requiredDisclosures.courtesy || {};
  const housing = pageState.requiredDisclosures.housing || {};
  const allSigned = agency.signed_at && courtesy.signed_at && housing.reviewed_at;
  return `
    <section class="rounded-[26px] border border-sky-100 bg-gradient-to-br from-sky-50/90 to-white p-5 space-y-4">
      <div>
        <div class="text-[11px] font-black uppercase tracking-[0.18em] text-sky-500 mb-2">Disclosures${requiredMarker(true)}</div>
        <h3 class="font-['Plus_Jakarta_Sans'] text-2xl font-extrabold tracking-tight text-slate-900">Please Review and Sign NY Disclosures</h3>
        <p class="mt-2 text-slate-600 font-medium leading-relaxed">One guided step covers agency, housing and anti-discrimination, the Rel8tion courtesy notice, and any lending follow-up consent.</p>
      </div>

      <input type="hidden" name="agency_disclosure_reviewed" value="${agency.signed_at ? 'true' : ''}">
      <input type="hidden" name="seller_representation_acknowledged" value="${agency.signed_at ? 'true' : ''}">
      <input type="hidden" name="agency_disclosure_signed_at" value="${esc(agency.signed_at || '')}">
      <input type="hidden" name="agency_disclosure_pdf_url" value="${esc(NYS_AGENCY_DISCLOSURE_PDF_URL)}">
      <input type="hidden" name="agency_disclosure_version" value="${esc(NYS_AGENCY_DISCLOSURE_VERSION)}">
      <input type="hidden" name="agency_disclosure_type" value="${esc(NYS_AGENCY_DISCLOSURE_TYPE)}">
      <input type="hidden" name="rel8tion_courtesy_acknowledged" value="${courtesy.signed_at ? 'true' : ''}">
      <input type="hidden" name="rel8tion_courtesy_signed_at" value="${esc(courtesy.signed_at || '')}">
      <input type="hidden" name="ny_housing_disclosure_reviewed" value="${housing.reviewed_at ? 'true' : ''}">
      <input type="hidden" name="ny_housing_disclosure_reviewed_at" value="${esc(housing.reviewed_at || '')}">
      <input type="hidden" name="ny_disclosure_signed_date" value="${esc(todayDateValue())}">
      <input type="hidden" id="ny-disclosure-signature-value" name="ny_disclosure_signature" value="">

      <div class="grid grid-cols-1 gap-3">
        <div>
          <div class="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Agency Disclosure</div>
          ${disclosureStatusBlock('agency-status', agency.signed_at)}
        </div>
        <div>
          <div class="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Housing & Anti-Discrimination</div>
          ${disclosureStatusBlock('housing-status', housing.reviewed_at)}
        </div>
        <div>
          <div class="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Rel8tion Courtesy Notice</div>
          ${disclosureStatusBlock('courtesy-status', courtesy.signed_at)}
        </div>
      </div>
      <button type="button" data-required-disclosures-open class="${primaryButtonClass()} w-full" style="background:var(--event-gradient);">
        ${allSigned ? 'Review / Complete Check-In' : 'Review & Sign Required Disclosures'}
      </button>
      <div id="disclosure-open-error" class="hidden rounded-[16px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-700"></div>
    </section>
    ${renderGuidedDisclosuresModal()}
  `;
}

function normalizeValue(value) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function validateCheckin(values) {
  if (!normalizeValue(values.visitor_name)) {
    throw new Error('Add the visitor name so this check-in stays tied to a real person.');
  }

  if (!normalizeValue(values.visitor_phone)) {
    throw new Error('Add the buyer phone number so the host has a real follow-up path after the visit.');
  }

  if (pageState.selectedPath !== CHECKIN_PATHS.BUYER) {
    if (!normalizeValue(values.buyer_agent_name)) {
      throw new Error('Add the buyer agent name so the represented relationship is clearly documented.');
    }

    if (!normalizeValue(values.buyer_agent_phone)) {
      throw new Error('Add the buyer agent phone number so the host has a real follow-up path.');
    }
  }

  if (pageState.selectedPath === CHECKIN_PATHS.BUYER_AGENT && values.represented_buyer_confirmed !== 'true') {
    throw new Error('Confirm that you represent this buyer before submitting the check-in.');
  }

  if (pageState.selectedPath !== CHECKIN_PATHS.BUYER_AGENT && !['yes', 'no'].includes(values.pre_approved)) {
    throw new Error('Choose whether the buyer is pre-approved before continuing.');
  }

  if (pageState.selectedPath !== CHECKIN_PATHS.BUYER_AGENT
    && values.pre_approved === 'yes'
    && !['yes', 'no'].includes(values.second_opinion_ok)) {
    throw new Error('Choose yes or no for the financing second-opinion option.');
  }

  if (pageState.selectedPath !== CHECKIN_PATHS.BUYER_AGENT && values.pre_approved === 'no' && values.loan_officer_contact_ok !== 'true') {
    throw new Error('Accept the discreet loan officer follow-up to continue without a pre-approval.');
  }

  if (pageState.selectedPath !== CHECKIN_PATHS.BUYER_AGENT) {
    if (values.agency_disclosure_reviewed !== 'true'
      || values.seller_representation_acknowledged !== 'true'
      || !normalizeValue(values.agency_disclosure_signed_at)) {
      throw new Error('Review and sign the New York State Agency Disclosure before submitting.');
    }

    if (values.rel8tion_courtesy_acknowledged !== 'true'
      || !normalizeValue(values.rel8tion_courtesy_signed_at)) {
      throw new Error('Review and sign the Rel8tion Courtesy Notice before submitting.');
    }

    if (values.ny_housing_disclosure_reviewed !== 'true'
      || !normalizeValue(values.ny_housing_disclosure_reviewed_at)) {
      throw new Error('Review the NYS Housing and Anti-Discrimination Disclosure before submitting.');
    }

    if (values.ny_disclosure_acknowledged !== 'true') {
      throw new Error('Acknowledge the required NYS disclosure before submitting.');
    }

    if (!normalizeValue(values.ny_disclosure_signature) && !normalizeValue(values.visitor_name)) {
      throw new Error('Add the buyer name so it can serve as the NYS disclosure electronic signature.');
    }
  }
}

function buildNyDisclosureMetadata(values, signedAt = new Date()) {
  const context = disclosureContext();
  const signedDate = normalizeValue(values.ny_disclosure_signed_date) || todayDateValue();
  const signatureValue = normalizeValue(values.ny_disclosure_signature) || normalizeValue(values.visitor_name);

  return {
    ...NY_DISCRIMINATION_DISCLOSURE,
    provided_by_agent_name: context.agentName,
    provided_by_brokerage: context.brokerage || '',
    consumer_role: PATH_LABELS[pageState.selectedPath] || pageState.selectedPath,
    acknowledged: true,
    reviewed: true,
    reviewed_at: normalizeValue(values.ny_housing_disclosure_reviewed_at) || signedAt.toISOString(),
    reviewed_pdf_url: getDisclosurePreviewUrl(pageState.eventRow?.id) || NYS_HOUSING_ANTI_DISCRIMINATION_DISCLOSURE_PDF_URL,
    esign_consent: true,
    e_signature_type: 'checkbox_plus_prefilled_name',
    e_signature_value: signatureValue,
    signed_date: signedDate,
    signed_at: signedAt.toISOString(),
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
  };
}

function buildAgencyDisclosureMetadata(values) {
  return {
    agency_disclosure_reviewed: values.agency_disclosure_reviewed === 'true',
    seller_representation_acknowledged: values.seller_representation_acknowledged === 'true',
    agency_disclosure_signed_at: normalizeValue(values.agency_disclosure_signed_at),
    agency_disclosure_pdf_url: normalizeValue(values.agency_disclosure_pdf_url) || NYS_AGENCY_DISCLOSURE_PDF_URL,
    agency_disclosure_version: normalizeValue(values.agency_disclosure_version) || NYS_AGENCY_DISCLOSURE_VERSION,
    agency_disclosure_type: normalizeValue(values.agency_disclosure_type) || NYS_AGENCY_DISCLOSURE_TYPE,
    e_signature_type: 'button_accept_sign',
    signed_by_name: normalizeValue(values.visitor_name),
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
  };
}

function buildCourtesyNoticeMetadata(values) {
  return {
    rel8tion_courtesy_acknowledged: values.rel8tion_courtesy_acknowledged === 'true',
    rel8tion_courtesy_signed_at: normalizeValue(values.rel8tion_courtesy_signed_at),
    e_signature_type: 'button_accept_sign',
    signed_by_name: normalizeValue(values.visitor_name),
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
  };
}

function buildCheckinPayload(formData) {
  const values = Object.fromEntries(formData.entries());
  validateCheckin(values);
  const signedAt = new Date();
  const disclosuresRequired = pageState.selectedPath !== CHECKIN_PATHS.BUYER_AGENT;
  const preApproved = disclosuresRequired
    ? (values.pre_approved === 'yes' ? true : (values.pre_approved === 'no' ? false : null))
    : null;
  const secondOpinionOk = values.second_opinion_ok === 'yes';
  const loanOfficerContactOk = values.loan_officer_contact_ok === 'true';
  const financingRequested = disclosuresRequired && (secondOpinionOk || loanOfficerContactOk || preApproved === false);
  const representedBuyerConfirmed = pageState.selectedPath === CHECKIN_PATHS.BUYER_WITH_AGENT
    ? true
    : values.represented_buyer_confirmed === 'true';
  const nyDiscriminationDisclosure = disclosuresRequired ? buildNyDisclosureMetadata(values, signedAt) : null;
  const agencyDisclosure = disclosuresRequired ? buildAgencyDisclosureMetadata(values) : null;
  const courtesyNotice = disclosuresRequired ? buildCourtesyNoticeMetadata(values) : null;

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
      disclosure_accepted: disclosuresRequired,
      signature_name: nyDiscriminationDisclosure?.e_signature_value || null,
      signature_date: nyDiscriminationDisclosure?.signed_date || null,
      signature_timestamp: nyDiscriminationDisclosure?.signed_at || null,
      agency_disclosure_reviewed: agencyDisclosure?.agency_disclosure_reviewed || false,
      seller_representation_acknowledged: agencyDisclosure?.seller_representation_acknowledged || false,
      agency_disclosure_signed_at: agencyDisclosure?.agency_disclosure_signed_at || null,
      agency_disclosure_pdf_url: agencyDisclosure?.agency_disclosure_pdf_url || null,
      agency_disclosure_version: agencyDisclosure?.agency_disclosure_version || null,
      agency_disclosure_type: agencyDisclosure?.agency_disclosure_type || null,
      rel8tion_courtesy_acknowledged: courtesyNotice?.rel8tion_courtesy_acknowledged || false,
      rel8tion_courtesy_signed_at: courtesyNotice?.rel8tion_courtesy_signed_at || null,
      nys_agency_disclosure: agencyDisclosure,
      rel8tion_courtesy_notice: courtesyNotice,
      ny_discrimination_disclosure: nyDiscriminationDisclosure,
      financing_requested: financingRequested,
      second_opinion_ok: values.second_opinion_ok || null,
      loan_officer_contact_ok: loanOfficerContactOk
    }
  };
}

function nextStepCards() {
  const house = pageState.house;
  const agent = pageState.agent;
  const subjectAddress = house?.address || 'this property';
  const listingUrl = oneKeyListingUrl(house);
  const contactHref = vcardHref(agent);
  const askQuestionBody = `Hi${agent?.name ? ` ${agent.name}` : ''}, I just checked in through Rel8tion for ${subjectAddress} and had a quick question.`;
  const loanOfficer = pageState.loanOfficer;
  const loanOfficerName = firstPresent(loanOfficer?.loan_officer_name, 'Lending Specialist');
  const loanOfficerCompany = firstPresent(loanOfficer?.loan_officer_company, 'NMB');
  const loanOfficerPhoto = firstPresent(loanOfficer?.loan_officer_photo_url, 'https://nicanqrfqlbnlmnoernb.supabase.co/storage/v1/object/public/verified-assets/company-logos/nationwide.png');
  const loanOfficerPhone = loanOfficer?.loan_officer_phone || '';
  const loanOfficerBody = `Hi ${loanOfficerName}, I just checked in at ${subjectAddress} through Rel8tion and would like to talk about pre-approval.`;
  const financingCopy = pageState.lastCheckin?.metadata?.financing_requested
    ? 'Financing follow-up was requested from this visit.'
    : 'If financing comes up later, the host has the visit details needed to follow up.';

  return `
    <section class="grid grid-cols-1 xl:grid-cols-[1.05fr_.95fr] gap-5 mb-5">
      <article class="rounded-[28px] border border-white/70 bg-white/78 p-6 shadow-[0_18px_40px_rgba(31,42,90,0.08)]">
        <div class="inline-flex items-center px-4 py-2 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700 mb-4">Checked In</div>
        <h2 class="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mb-3">Thanks for checking in</h2>
        <p class="text-slate-600 font-medium leading-relaxed mb-5">
          Your visit was sent to the host. Save the agent contact or message the agent if a question comes up during the open house.
        </p>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          <a href="${esc(listingUrl || '#')}" ${listingUrl ? 'target="_blank" rel="noopener noreferrer"' : ''} class="inline-flex items-center justify-center px-5 py-4 rounded-full font-bold text-sm md:text-base text-white shadow-[0_18px_40px_rgba(59,130,246,0.28)] ${listingUrl ? '' : 'pointer-events-none opacity-60'}" style="background:linear-gradient(90deg,#38bdf8,#2563eb);">
            View OneKey Listing
          </a>
          <a href="${esc(smsHref(agent?.phone || '', askQuestionBody))}" class="inline-flex items-center justify-center px-5 py-4 rounded-full font-bold text-sm md:text-base bg-white/80 border border-slate-200 text-slate-700 ${agent?.phone ? '' : 'pointer-events-none opacity-60'}">
            Message Agent
          </a>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Check-In Type</div>
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
        <h2 class="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mb-3">Loan Officer Support</h2>
        <div class="rounded-[22px] bg-slate-50 border border-slate-100 p-4 mb-4">
          <div class="flex items-center gap-4">
            <img src="${esc(loanOfficerPhoto)}" onerror="this.style.display='none';" alt="${esc(loanOfficerName)}" class="h-14 w-14 rounded-full object-cover bg-white border border-white">
            <div>
              <div class="font-black text-slate-900">${esc(loanOfficerName)}</div>
              <div class="text-sm font-semibold text-slate-500">${esc(loanOfficerCompany)}</div>
            </div>
          </div>
        </div>
        <div class="space-y-4 text-slate-600 font-medium leading-relaxed">
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            ${esc(financingCopy)}
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a href="${esc(smsHref(loanOfficerPhone, loanOfficerBody))}" class="inline-flex items-center justify-center rounded-full px-5 py-4 text-sm font-black text-white ${loanOfficerPhone ? '' : 'pointer-events-none opacity-60'}" style="background:var(--event-gradient);">
              Start Pre-Approval Chat
            </a>
            <a href="${esc(telHref(loanOfficerPhone))}" class="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-4 text-sm font-black text-slate-700 ${loanOfficerPhone ? '' : 'pointer-events-none opacity-60'}">
              Call Specialist
            </a>
          </div>
        </div>
      </article>
    </section>

    <section class="grid grid-cols-1 lg:grid-cols-[1.05fr_.95fr] gap-5 mb-5">
      <article class="rounded-[28px] border border-white/70 bg-white/78 p-6 shadow-[0_18px_40px_rgba(31,42,90,0.08)]">
        <h2 class="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mb-4">Property Snapshot</h2>
        <div class="mb-4 overflow-hidden rounded-[24px] border border-white/80 bg-slate-100">
          ${propertyImageUrl(house)
            ? `<img src="${esc(propertyImageUrl(house))}" alt="${esc(house?.address || 'Open house property')}" class="aspect-[16/10] w-full object-cover">`
            : `<div class="flex aspect-[16/10] w-full items-center justify-center text-sm font-black uppercase tracking-[0.16em] text-slate-400">Property Media</div>`}
        </div>
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
          <div class="flex items-start gap-4">
            ${renderAgentImage(agent, 'h-16 w-16')}
            <div class="min-w-0">
              <div class="text-slate-900 font-black text-xl mb-1">${esc(agent?.name || 'Host Agent')}</div>
              <div class="text-slate-600 font-semibold mb-3">${textOrDash(agent?.brokerage || house?.brokerage)}</div>
              <p class="text-slate-700 font-medium leading-relaxed">${esc(agentBioText(agent, house))}</p>
            </div>
          </div>
          <div class="mt-4 space-y-1 text-slate-700 font-medium">
            <div>${textOrDash(agent?.phone)}</div>
            <div class="break-all">${textOrDash(agent?.email)}</div>
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a href="${esc(contactHref)}" download="${esc((agent?.name || 'host-agent').replace(/[^a-z0-9]+/gi, '-').toLowerCase())}.vcf" class="inline-flex items-center justify-center px-4 py-4 rounded-full font-bold text-sm bg-white/80 border border-slate-200 text-slate-700 ${contactHref === '#' ? 'pointer-events-none opacity-60' : ''}">Save Contact</a>
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
      pageState.requiredDisclosures = { agency: null, housing: null, courtesy: null };
      setPathInUrl(nextPath);
      renderEventShell();
    });
  });

  const form = document.getElementById('checkin-form');
  const visitorNameInput = form?.querySelector('[name="visitor_name"]');
  const preApprovalSelect = form?.querySelector('[name="pre_approved"]');
  const signatureInput = document.getElementById('ny-disclosure-signature-value');
  const signaturePreview = document.getElementById('ny-disclosure-signature-preview');
  const syncDisclosureSignature = () => {
    const signature = normalizeValue(visitorNameInput?.value);
    if (signatureInput) signatureInput.value = signature || '';
    if (signaturePreview) signaturePreview.textContent = signature || 'Enter your name above';
  };

  visitorNameInput?.addEventListener('input', syncDisclosureSignature);
  syncDisclosureSignature();

  const prepareDisclosurePortals = () => {
    document.querySelectorAll('.rel8tion-disclosure-modal').forEach((modal) => {
      if (modal.parentElement !== document.body) document.body.appendChild(modal);
    });
  };

  prepareDisclosurePortals();

  const closeDisclosureModals = () => {
    document.querySelectorAll('.rel8tion-disclosure-modal').forEach((modal) => {
      modal.classList.add('hidden');
      modal.classList.remove('flex', 'is-open');
      modal.setAttribute('aria-hidden', 'true');
    });
    document.body.classList.remove('rel8tion-modal-open');
  };

  const setGuidedDisclosureError = (message = '') => {
    const error = document.getElementById('guided-disclosure-error');
    if (error) {
      error.textContent = message;
      error.classList.toggle('hidden', !message);
    }
    const openError = document.getElementById('disclosure-open-error');
    if (openError) {
      openError.textContent = message;
      openError.classList.toggle('hidden', !message);
    }
  };

  const showGuidedDisclosureStep = (step) => {
    const labels = {
      agency: ['Step 1 of 5', 'New York State Agency Disclosure'],
      housing: ['Step 2 of 5', 'NYS Housing & Anti-Discrimination Disclosure'],
      courtesy: ['Step 3 of 5', 'Rel8tion Courtesy Notice'],
      lending: ['Step 4 of 5', 'Financing Follow-Up'],
      final: ['Step 5 of 5', 'Acknowledge & Complete Check-In']
    };
    document.querySelectorAll('.guided-disclosure-panel').forEach((panel) => {
      panel.classList.toggle('hidden', panel.getAttribute('data-guided-disclosure-panel') !== step);
    });
    const [kicker, title] = labels[step] || labels.agency;
    const kickerEl = document.getElementById('required-disclosure-kicker');
    const titleEl = document.getElementById('required-disclosure-title');
    if (kickerEl) kickerEl.textContent = kicker;
    if (titleEl) titleEl.textContent = title;
    setGuidedDisclosureError('');
    if (step === 'lending') syncLendingPromptMode();
    const panel = document.querySelector(`[data-guided-disclosure-panel="${step}"]`);
    if (panel) panel.scrollTop = 0;
  };

  const openGuidedDisclosuresModal = (step = 'agency') => {
    prepareDisclosurePortals();
    const modal = document.getElementById('required-disclosures-modal');
    if (!modal) return;
    closeDisclosureModals();
    modal.classList.remove('hidden');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('rel8tion-modal-open');
    showGuidedDisclosureStep(step);
    const panel = modal.querySelector('.rel8tion-disclosure-panel');
    if (panel) {
      panel.scrollTop = 0;
      window.requestAnimationFrame(() => panel.focus({ preventScroll: true }));
    }
  };

  const updateDisclosureStatus = (id, text) => {
    const status = document.getElementById(id);
    if (!status) return;
    status.className = 'rounded-[16px] border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm font-black text-emerald-700';
    status.textContent = text;
  };

  const requireVisitorNameForSignature = () => {
    const signature = normalizeValue(visitorNameInput?.value);
    if (signature) {
      setGuidedDisclosureError('');
      return signature;
    }
    setGuidedDisclosureError('Enter your full name before signing disclosures.');
    visitorNameInput?.focus({ preventScroll: false });
    return null;
  };

  const requirePreApprovalBeforeDisclosure = () => {
    if (pageState.selectedPath === CHECKIN_PATHS.BUYER_AGENT) return true;
    if (['yes', 'no'].includes(preApprovalSelect?.value)) {
      setGuidedDisclosureError('');
      return true;
    }
    setGuidedDisclosureError('Choose pre-approved status before reviewing disclosures.');
    preApprovalSelect?.focus({ preventScroll: false });
    return false;
  };

  const syncLendingPromptMode = () => {
    const value = preApprovalSelect?.value || 'none';
    document.querySelectorAll('[data-lending-mode]').forEach((node) => {
      node.classList.toggle('hidden', node.getAttribute('data-lending-mode') !== value);
    });
  };

  const isLendingStepComplete = () => {
    if (pageState.selectedPath === CHECKIN_PATHS.BUYER_AGENT) return true;
    const value = preApprovalSelect?.value;
    if (value === 'yes') {
      return Boolean(document.querySelector('[name="second_opinion_ok"]:checked'));
    }
    if (value === 'no') {
      return document.querySelector('[name="loan_officer_contact_ok"]')?.checked === true;
    }
    return false;
  };

  document.querySelectorAll('[data-required-disclosures-open]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!requireVisitorNameForSignature()) return;
      if (!requirePreApprovalBeforeDisclosure()) return;
      if (!pageState.requiredDisclosures.agency?.signed_at) return openGuidedDisclosuresModal('agency');
      if (!pageState.requiredDisclosures.housing?.reviewed_at) return openGuidedDisclosuresModal('housing');
      if (!pageState.requiredDisclosures.courtesy?.signed_at) return openGuidedDisclosuresModal('courtesy');
      if (!isLendingStepComplete()) return openGuidedDisclosuresModal('lending');
      openGuidedDisclosuresModal('final');
    });
  });

  document.querySelectorAll('[data-disclosure-preview-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const preview = button.nextElementSibling;
      if (!preview) return;
      preview.classList.toggle('hidden');
    });
  });

  document.querySelectorAll('[data-guided-disclosure-accept]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!requireVisitorNameForSignature()) return;
      const key = button.getAttribute('data-guided-disclosure-accept');
      if (key === 'lending') {
        if (!requirePreApprovalBeforeDisclosure()) return;
        if (preApprovalSelect?.value === 'yes' && !document.querySelector('[name="second_opinion_ok"]:checked')) {
          setGuidedDisclosureError('Choose yes or no before continuing.');
          return;
        }
        if (preApprovalSelect?.value === 'no' && document.querySelector('[name="loan_officer_contact_ok"]')?.checked !== true) {
          setGuidedDisclosureError('Accept the discreet loan officer follow-up before continuing.');
          return;
        }
        showGuidedDisclosureStep('final');
        return;
      }
      const signedAt = new Date();
      const signedAtIso = signedAt.toISOString();
      const displayTime = signedAt.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

      if (key === 'agency') {
        pageState.requiredDisclosures.agency = { signed_at: signedAtIso };
        form.querySelector('[name="agency_disclosure_reviewed"]').value = 'true';
        form.querySelector('[name="seller_representation_acknowledged"]').value = 'true';
        form.querySelector('[name="agency_disclosure_signed_at"]').value = signedAtIso;
        updateDisclosureStatus('agency-status', `Agency Disclosure signed ${displayTime}`);
        showGuidedDisclosureStep('housing');
        return;
      }

      if (key === 'housing') {
        pageState.requiredDisclosures.housing = { reviewed_at: signedAtIso };
        form.querySelector('[name="ny_housing_disclosure_reviewed"]').value = 'true';
        form.querySelector('[name="ny_housing_disclosure_reviewed_at"]').value = signedAtIso;
        updateDisclosureStatus('housing-status', `Housing Disclosure reviewed ${displayTime}`);
        showGuidedDisclosureStep('courtesy');
        return;
      }

      if (key === 'courtesy') {
        pageState.requiredDisclosures.courtesy = { signed_at: signedAtIso };
        form.querySelector('[name="rel8tion_courtesy_acknowledged"]').value = 'true';
        form.querySelector('[name="rel8tion_courtesy_signed_at"]').value = signedAtIso;
        updateDisclosureStatus('courtesy-status', `Courtesy Notice signed ${displayTime}`);
        showGuidedDisclosureStep('lending');
      }
    });
  });

  const finalDisclosureCheckbox = document.getElementById('ny-disclosure-final-checkbox');
  const completeCheckinButton = document.getElementById('guided-complete-checkin');
  finalDisclosureCheckbox?.addEventListener('change', () => {
    if (completeCheckinButton) completeCheckinButton.classList.toggle('hidden', !finalDisclosureCheckbox.checked);
  });

  preApprovalSelect?.addEventListener('change', () => {
    document.querySelectorAll('[name="second_opinion_ok"]').forEach((radio) => {
      radio.checked = false;
    });
    const loanOfficerConsent = document.querySelector('[name="loan_officer_contact_ok"]');
    if (loanOfficerConsent) loanOfficerConsent.checked = false;
    syncLendingPromptMode();
  });
  syncLendingPromptMode();

  document.querySelectorAll('[data-disclosure-open]').forEach((button) => {
    button.addEventListener('click', () => {
      prepareDisclosurePortals();
      const key = button.getAttribute('data-disclosure-open');
      const modal = document.getElementById(`${key}-disclosure-modal`);
      if (!modal) return;
      closeDisclosureModals();
      modal.classList.remove('hidden');
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('rel8tion-modal-open');
      const panel = modal.querySelector('.rel8tion-disclosure-panel');
      if (panel) {
        panel.scrollTop = 0;
        window.requestAnimationFrame(() => panel.focus({ preventScroll: true }));
      }
    });
  });

  document.querySelectorAll('.rel8tion-disclosure-modal').forEach((modal) => {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeDisclosureModals();
    });
  });

  if (!disclosureEscapeHandlerBound) {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeDisclosureModals();
    });
    disclosureEscapeHandlerBound = true;
  }

  document.querySelectorAll('[data-disclosure-close]').forEach((button) => {
    button.addEventListener('click', closeDisclosureModals);
  });

  document.querySelectorAll('[data-disclosure-accept]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.getAttribute('data-disclosure-accept');
      const signedAt = new Date();
      const signedAtIso = signedAt.toISOString();
      const status = document.getElementById(`${key}-status`);
      const displayTime = signedAt.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

      if (key === 'agency') {
        pageState.requiredDisclosures.agency = { signed_at: signedAtIso };
        form.querySelector('[name="agency_disclosure_reviewed"]').value = 'true';
        form.querySelector('[name="seller_representation_acknowledged"]').value = 'true';
        form.querySelector('[name="agency_disclosure_signed_at"]').value = signedAtIso;
      }

      if (key === 'courtesy') {
        pageState.requiredDisclosures.courtesy = { signed_at: signedAtIso };
        form.querySelector('[name="rel8tion_courtesy_acknowledged"]').value = 'true';
        form.querySelector('[name="rel8tion_courtesy_signed_at"]').value = signedAtIso;
      }

      if (status) {
        status.className = 'rounded-[16px] border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm font-black text-emerald-700';
        status.textContent = `Accepted / Signed ${displayTime}`;
      }
      button.textContent = 'Accepted / Signed';
      closeDisclosureModals();
    });
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pageState.submitting) return;

    pageState.submitting = true;
    pageState.successMessage = '';
    pageState.errorMessage = '';
    pageState.financingAlertSent = false;

    let payload;
    try {
      payload = buildCheckinPayload(new FormData(form));
    } catch (error) {
      pageState.submitting = false;
      pageState.errorMessage = error.message || 'Complete the required disclosure acknowledgement.';
      renderEventShell();
      return;
    }

    renderEventShell();

    try {
      let createdCheckin = await createCheckin(payload);
      try {
        await touchEvent(pageState.eventRow.id);
      } catch (error) {
        console.log('touchEvent after checkin skipped', error);
      }

      if (payload.metadata?.disclosure_accepted) {
        try {
          const signedDisclosureResult = await generateSignedDisclosurePdf(createdCheckin?.id);
          if (signedDisclosureResult?.checkin) {
            createdCheckin = signedDisclosureResult.checkin;
          } else if (signedDisclosureResult?.signed_pdf) {
            payload.metadata = {
              ...payload.metadata,
              ny_discrimination_disclosure: {
                ...(payload.metadata?.ny_discrimination_disclosure || {}),
                signed_pdf: signedDisclosureResult.signed_pdf
              }
            };
          }
        } catch (error) {
          console.log('Signed NYS disclosure PDF generation skipped', error);
        }
      }

      const financingRequested = payload.metadata?.financing_requested === true;
      await sendBuyerConfirmationSMS({
        buyerPhone: payload.visitor_phone || '',
        buyerName: payload.visitor_name || '',
        agentName: pageState.agent?.name || 'Host Agent',
        agentBrokerage: pageState.agent?.brokerage || pageState.house?.brokerage || pageState.eventRow?.setup_context?.detected_brokerage || '',
        agentPhone: pageState.agent?.phone || '',
        propertyAddress: pageState.house?.address || pageState.eventRow?.setup_context?.address || ''
      });

      await sendAgentCheckinSMS({
        agentPhone: pageState.agent?.phone || '',
        buyerName: payload.visitor_name || '',
        buyerPhone: payload.visitor_phone || '',
        buyerEmail: payload.visitor_email || '',
        propertyAddress: pageState.house?.address || pageState.eventRow?.setup_context?.address || '',
        preapproved: payload.pre_approved,
        buyerAgentName: payload.buyer_agent_name || '',
        buyerAgentPhone: payload.buyer_agent_phone || ''
      });

      if (financingRequested) {
        const liveLoanOfficer = pageState.loanOfficer || await getLiveLoanOfficerSession(pageState.eventRow.id).catch(() => null);
        pageState.loanOfficer = liveLoanOfficer;
        const address = pageState.house?.address || pageState.eventRow?.setup_context?.address || 'Open House Visitor';
        const price = pageState.house?.price ? money(pageState.house.price) : '';
        if (liveLoanOfficer?.loan_officer_phone) {
          await sendLiveLoanOfficerFinancingAlert({
            loanOfficer: liveLoanOfficer,
            agentName: pageState.agent?.name || pageState.eventRow?.host_agent_slug || '',
            buyerPhone: payload.visitor_phone || '',
            buyerName: payload.visitor_name || 'Buyer',
            buyerEmail: payload.visitor_email || '',
            address,
            price,
            preapproved: payload.pre_approved === true ? 'yes' : 'no'
          });
          await sendBuyerLoanOfficerIntroSMS({
            buyerPhone: payload.visitor_phone || '',
            buyerName: payload.visitor_name || 'Buyer',
            loanOfficer: liveLoanOfficer,
            propertyAddress: address
          });
        } else {
          await sendJaredFinancingAlert({
            buyerPhone: payload.visitor_phone || '',
            buyerName: payload.visitor_name || 'Buyer',
            address,
            price,
            preapproved: payload.pre_approved === true ? 'yes' : 'no'
          });
        }
      }

      pageState.lastCheckin = {
        ...payload,
        ...(createdCheckin || {}),
        id: createdCheckin?.id || null,
        metadata: createdCheckin?.metadata || payload.metadata
      };
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
  const contextHouse = house || {
    address: eventRow?.setup_context?.address || '',
    brokerage: eventRow?.setup_context?.detected_brokerage || '',
    price: eventRow?.setup_context?.price || null,
    beds: eventRow?.setup_context?.beds || null,
    baths: eventRow?.setup_context?.baths || null,
    sqft: eventRow?.setup_context?.sqft || null,
    open_start: eventRow?.start_time || null,
    open_end: eventRow?.end_time || null
  };
  const listingUrl = oneKeyListingUrl(contextHouse);
  const status = houseStatus(contextHouse);
  const agentName = agent?.name || 'Host Agent';
  const brokerageName = agent?.brokerage || contextHouse?.brokerage || eventRow?.setup_context?.detected_brokerage || '';

  const lastCheckinNeedsFinancing = pageState.lastCheckin?.metadata?.financing_requested === true;

  shell(`
    <div style="${themeStyle()}">
    <section class="rounded-[30px] border border-white/70 bg-white/86 p-5 md:p-7 shadow-[0_18px_40px_rgba(31,42,90,0.08)] mb-5">
      <div class="grid grid-cols-[1fr_auto] items-center gap-4">
        <div class="min-w-0">
          <div class="inline-flex items-center rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white" style="background:${status.color}">${esc(status.label)}</div>
          <h1 class="mt-3 font-['Plus_Jakarta_Sans'] text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">Welcome to ${esc(contextHouse?.address || 'this open house')}</h1>
        </div>
        ${renderPropertyImage(contextHouse, 'h-24 w-24 md:h-32 md:w-32')}
      </div>

      <div class="mt-5 grid grid-cols-[auto_1fr] items-center gap-4 rounded-[24px] border border-slate-100 bg-slate-50/90 p-4">
        ${renderAgentImage(agent, 'h-16 w-16 md:h-20 md:w-20')}
        <div class="min-w-0">
          <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Hosted by</div>
          <div class="mt-1 text-xl font-black text-slate-900">${esc(agentName)}</div>
          <div class="text-sm font-semibold text-slate-500">${textOrDash(brokerageName)}</div>
        </div>
      </div>
    </section>

    <section class="mb-5">
      <article class="rounded-[28px] border border-sky-100 bg-white/82 p-6 shadow-[0_18px_40px_rgba(31,42,90,0.08)]">
        ${pageState.mode === 'checkin' ? renderPathSelector() : ''}
        <div class="mb-5">
          <div class="inline-flex items-center px-4 py-2 rounded-full bg-sky-50 border border-sky-200 text-[11px] font-black uppercase tracking-[0.18em] text-sky-600 mb-3">CHECK IN HERE</div>
          <h2 class="font-['Plus_Jakarta_Sans'] text-3xl font-extrabold tracking-tight text-slate-900 mb-2">Enjoy Your Stay!</h2>
          <p class="text-slate-600 font-semibold leading-relaxed">Please enter your info to begin.</p>
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
            ${selectedPath !== CHECKIN_PATHS.BUYER_AGENT ? renderRequiredDisclosuresBlock() : `
              <button type="submit" class="${primaryButtonClass()} w-full" style="background:var(--event-gradient);">Complete Agent Check-In</button>
            `}
            ${selectedPath !== CHECKIN_PATHS.BUYER_AGENT ? `
              <div class="rounded-[18px] border border-slate-200 bg-white/80 px-4 py-4 text-center text-sm font-bold text-slate-500">
                Complete Check-In appears after the disclosure acknowledgement.
              </div>
            ` : ''}
            ${pageState.errorMessage ? `<div class="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-4 text-rose-700 font-semibold">${esc(pageState.errorMessage)}</div>` : ''}
          </form>
        ` : `
          <div class="space-y-4">
            <div class="rounded-[22px] border border-slate-200 bg-white/85 p-5">
              <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">What Happens Next</div>
              <p class="text-slate-700 font-medium leading-relaxed">This visit is tied to the active event and ready for the guided experience below.</p>
            </div>
            <button type="button" id="new-checkin-button" class="inline-flex items-center justify-center w-full px-8 py-4 rounded-full font-bold text-base md:text-lg bg-white/85 border border-slate-200 text-slate-700">
              Start Another Check-In
            </button>
          </div>
        `}
      </article>
      ${lastCheckinNeedsFinancing ? `
        <div class="rounded-[20px] bg-sky-50 border border-sky-200 p-4 mt-4 text-sky-900 font-semibold">
          Financing follow-up was requested for this check-in.
        </div>
      ` : ''}
    </section>

    ${pageState.mode === 'guest' ? nextStepCards() : ''}

    <section class="${pageState.mode === 'guest' ? 'grid' : 'hidden'} grid-cols-1 md:grid-cols-2 gap-5">
      <article class="rounded-[28px] border border-white/70 bg-white/75 p-6 shadow-[0_18px_40px_rgba(31,42,90,0.08)]">
        <h2 class="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mb-3">Property Details</h2>
        <div class="grid grid-cols-1 gap-3 text-sm">
          <div class="rounded-[18px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Address</div>
            <div class="text-slate-900 font-bold">${esc(contextHouse?.address || 'Open House')}</div>
          </div>
          <div class="rounded-[18px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Price</div>
            <div class="text-slate-900 font-bold">${contextHouse?.price ? money(contextHouse.price) : '&mdash;'}</div>
          </div>
          <div class="rounded-[18px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Open House</div>
            <div class="text-slate-900 font-bold">${esc(formatEventWindow(contextHouse))}</div>
          </div>
          <div class="rounded-[18px] bg-slate-50 border border-slate-100 p-4">
            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">Listing Link</div>
            <div class="text-slate-900 font-bold">${listingUrl ? `<a class="text-sky-600 underline" href="${esc(listingUrl)}" target="_blank" rel="noopener noreferrer">Open OneKey Listing</a>` : '&mdash;'}</div>
          </div>
        </div>
      </article>

      <article class="rounded-[28px] border border-white/70 bg-white/75 p-6 shadow-[0_18px_40px_rgba(31,42,90,0.08)]">
        <h2 class="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mb-3">After You Check In</h2>
        <div class="space-y-4 text-slate-600 font-medium leading-relaxed">
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            The host agent receives your check-in details by text.
          </div>
          <div class="rounded-[20px] bg-slate-50 border border-slate-100 p-4">
            If you are not pre-approved yet, financing follow-up is flagged right away.
          </div>
        </div>
      </article>
    </section>
    </div>
  `);

  attachEventHandlers();

  const newCheckinButton = document.getElementById('new-checkin-button');
  newCheckinButton?.addEventListener('click', () => {
    pageState.mode = 'checkin';
    pageState.successMessage = '';
    pageState.errorMessage = '';
    pageState.requiredDisclosures = { agency: null, housing: null, courtesy: null };
    renderEventShell();
  });
}

export async function initEventShellPage() {
  const eventId = getEventIdFromUrl();
  if (!eventId) {
    errorView(
      'Event Not Found',
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
  pageState.requiredDisclosures = { agency: null, housing: null, courtesy: null };
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
    pageState.loanOfficer = await getLiveLoanOfficerSession(eventId).catch(() => null);
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

    try {
      const brokerageForBrand = firstPresent(
        pageState.agent?.brokerage,
        pageState.house?.brokerage,
        eventRow?.setup_context?.detected_brokerage,
        eventRow?.setup_context?.brokerage
      );
      pageState.brand = await applyBranding(brokerageForBrand);
    } catch (error) {
      console.log('applyBranding skipped', error);
      pageState.brand = null;
    }

    renderEventShell();
  } catch (error) {
    console.error(error);
    errorView('Event Could Not Load', error.message || 'Something went wrong while loading this open house check-in.');
  }
}
