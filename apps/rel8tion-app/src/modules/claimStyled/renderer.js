import { ASSETS, ROUTES } from '../../core/config.js';
import { state, setCurrentBrand, setSelectedBrokerage } from '../../core/state.js';
import { esc, getStatus, money, normalizePhone } from '../../core/utils.js';
import { applyBranding } from '../../api/brokerages.js';

function getBrandColors() {
  return {
    primary: state.currentBrand?.primary_color || '#38bdf8',
    accent: state.currentBrand?.accent_color || '#2563eb'
  };
}

function setAppBackground() {
  const app = document.getElementById('app');
  app.className = 'claim-app-layer';
}

function primaryButtonStyle() {
  const c = getBrandColors();
  return `background:linear-gradient(90deg, ${c.primary}, ${c.accent}); color:white;`;
}

function render(content) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="w-full max-w-xl rounded-[38px] md:rounded-[46px] border border-white/70 bg-white/20 backdrop-blur-[10px] p-6 md:p-10 text-center transition-all duration-500 shadow-[0_25px_60px_rgba(31,42,90,0.12),inset_0_1px_1px_rgba(255,255,255,0.35)]">
      <div class="mb-8">
        <img src="${ASSETS.rel8tionLogo}" class="h-16 md:h-20 mx-auto drop-shadow-sm" alt="Rel8tion">
      </div>
      ${content}
    </div>
  `;
  setAppBackground();
}

function getBrokerageOptions() {
  return [
    '',
    'Douglas Elliman',
    'Compass',
    'Signature Premier Properties',
    'Keller Williams Realty',
    "Daniel Gale Sotheby's International Realty",
    'Coldwell Banker American Homes',
    'Howard Hanna Coach',
    'eXp Realty',
    'Realty Connect USA',
    'EXIT Realty',
    'Century 21',
    'RE/MAX',
    '__other__'
  ];
}

function isKnownBrokerage(name) {
  if (!name) return false;
  return getBrokerageOptions().includes(name) && name !== '' && name !== '__other__';
}

function attachBrokerageStepHandlers() {
  const select = document.getElementById('brokerage_step_select');
  const custom = document.getElementById('brokerage_step_custom');

  if (!select || !custom) return;

  select.onchange = async () => {
    const selectedValue = select.value;

    if (selectedValue === '__other__') {
      custom.classList.remove('hidden');
      custom.focus();
      setSelectedBrokerage('');
      setCurrentBrand(null);
      return;
    }

    custom.classList.add('hidden');
    custom.value = '';
    setSelectedBrokerage(selectedValue || '');

    if (selectedValue) await applyBranding(selectedValue);
    else setCurrentBrand(null);
  };
}

function attachFullProfileHandlers() {
  const photo = document.getElementById('full_photo');
  if (photo) {
    photo.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const preview = document.getElementById('full_preview');
      preview.src = URL.createObjectURL(file);
      preview.classList.remove('hidden');
      preview.classList.add('block');
    };
  }

  const brokerageSelect = document.getElementById('full_brokerage_select');
  const brokerageCustom = document.getElementById('full_brokerage_custom');
  if (!brokerageSelect || !brokerageCustom) return;

  brokerageSelect.onchange = async () => {
    const selected = brokerageSelect.value;

    if (selected === '__other__') {
      brokerageCustom.classList.remove('hidden');
      brokerageCustom.focus();
      setCurrentBrand(null);
      return;
    }

    brokerageCustom.classList.add('hidden');
    brokerageCustom.value = '';
    if (selected) {
      setSelectedBrokerage(selected);
      await applyBranding(selected);
    } else {
      setSelectedBrokerage('');
      setCurrentBrand(null);
    }
  };
}

export function showLoading(msg = 'Preparing your setup') {
  render(`
    <div class="py-10 md:py-14">
      <div class="w-20 h-20 border-8 border-slate-100/80 border-t-blue-600 rounded-full animate-spin mx-auto mb-8"></div>
      <h2 class="text-2xl md:text-3xl font-black mb-2 tracking-tight text-[#1f2a5a]">Preparing Your Setup</h2>
      <p id="loaderText" class="text-slate-500 text-lg font-bold animate-pulse">${esc(msg)}</p>
      <div class="mt-8 w-full h-3 rounded-full bg-slate-100/80 overflow-hidden">
        <div class="h-full rounded-full animate-[progressMove_1.3s_ease-in-out_infinite_alternate]" style="width:42%;background:linear-gradient(90deg,#38bdf8,#2563eb);"></div>
      </div>
    </div>
  `);
}

export function showError(title, message) {
  render(`
    <div>
      <h1 class="font-['Poppins'] text-[30px] md:text-[40px] leading-[0.98] font-black tracking-[-0.04em] text-slate-900 mb-3 uppercase">${esc(title || 'Something Went Wrong')}</h1>
      <p class="text-slate-500 text-[17px] md:text-[18px] leading-relaxed font-medium max-w-md mx-auto mb-6">${esc(message || 'Please try again.')}</p>
      <div class="space-y-3">
        <button onclick="init()" class="w-full py-5 rounded-full font-black text-[18px] md:text-[20px] uppercase tracking-[-0.02em] shadow-[0_18px_40px_rgba(59,130,246,0.28)] active:scale-[0.99] transition-all" style="${primaryButtonStyle()}">Try Again</button>
        <button onclick="showBrokerageStep()" class="w-full py-5 rounded-full bg-white/85 border border-slate-200 text-slate-700 font-black text-[17px] uppercase tracking-[-0.02em] shadow-sm active:scale-[0.99] transition-all">Set Up Manually</button>
      </div>
    </div>
  `);
}

export function showIntro(notice = '') {
  render(`
    <div class="text-center">
      <div class="inline-flex items-center justify-center mb-6">
        <div class="px-4 py-2 rounded-full bg-white/60 border border-white/80 shadow-sm text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Private Access</div>
      </div>
      <h1 class="font-['Poppins'] text-[34px] md:text-[48px] leading-[0.95] font-black tracking-[-0.04em] text-slate-900 mb-4">Activate Your<br>REL8TIONCHIP</h1>
      <p class="text-slate-500 text-[16px] md:text-[18px] leading-relaxed font-medium max-w-xl mx-auto mb-8">Choose how you want to set up your profile.</p>
      ${notice ? `<div class="mb-6 rounded-[22px] border border-blue-100 bg-blue-50/70 backdrop-blur-sm text-blue-700 px-5 py-4 text-sm font-semibold">${esc(notice)}</div>` : ''}
      <div class="space-y-3">
        <button onclick="startFieldFlow()" class="w-full py-5 rounded-full font-black text-[18px] md:text-[20px] uppercase tracking-[-0.02em] shadow-[0_18px_40px_rgba(59,130,246,0.28)] active:scale-[0.99] transition-all" style="${primaryButtonStyle()}">At a Listing or Open House</button>
        <button onclick="startOfficeFlow()" class="w-full py-5 rounded-full bg-white/85 border border-slate-200 text-slate-700 font-black text-[17px] md:text-[18px] uppercase tracking-[-0.02em] shadow-sm active:scale-[0.99] transition-all">At Home or In the Office</button>
      </div>
    </div>
  `);
}

export function showBrokerageStep(notice = '') {
  const selected = state.selectedBrokerage || state.prefilledAgent?.brokerage || state.detectedHouse?.brokerage || '';

  render(`
    <div>
      <h1 class="font-['Poppins'] text-[28px] md:text-[38px] leading-[0.98] font-black tracking-[-0.04em] text-slate-900 mb-3 uppercase">Select Brokerage</h1>
      <p class="text-slate-500 text-[16px] md:text-[18px] leading-relaxed font-medium max-w-md mx-auto mb-6">Choose your brokerage to continue.</p>
      ${notice ? `<div class="mb-6 rounded-[22px] border border-blue-100 bg-blue-50/70 backdrop-blur-sm text-blue-700 px-5 py-4 text-sm font-semibold">${esc(notice)}</div>` : ''}
      <div class="space-y-4 text-left">
        <select id="brokerage_step_select" class="w-full rounded-[20px] border border-slate-200 bg-white/80 px-5 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-blue-400">
          ${getBrokerageOptions().map((opt) => {
            const label = opt === '' ? 'Select Brokerage' : (opt === '__other__' ? "Other / My Brokerage Isn't Listed" : opt);
            const selectedAttr = (opt === selected || (opt === '__other__' && selected && !isKnownBrokerage(selected))) ? 'selected' : '';
            return `<option value="${esc(opt)}" ${selectedAttr}>${esc(label)}</option>`;
          }).join('')}
        </select>
        <input id="brokerage_step_custom" value="${esc(selected && !isKnownBrokerage(selected) ? selected : '')}" placeholder="Enter Brokerage Name" class="w-full rounded-[20px] border border-slate-200 bg-white/80 px-5 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-blue-400 ${(selected && !isKnownBrokerage(selected)) ? '' : 'hidden'}">
      </div>
      <div class="mt-6 space-y-3">
        <button onclick="continueFromBrokerageStep()" class="w-full py-5 rounded-full font-black text-[18px] md:text-[20px] uppercase tracking-[-0.02em] shadow-[0_18px_40px_rgba(59,130,246,0.28)] active:scale-[0.99] transition-all" style="${primaryButtonStyle()}">Continue</button>
        <button onclick="showIntro()" class="w-full py-5 rounded-full bg-white/85 border border-slate-200 text-slate-700 font-black text-[17px] uppercase tracking-[-0.02em] shadow-sm active:scale-[0.99] transition-all">Back</button>
      </div>
    </div>
  `);

  attachBrokerageStepHandlers();
}

export function showDetection() {
  const h = state.detectedHouse;
  const s = getStatus(h);

  render(`
    <div>
      <h1 class="font-['Poppins'] text-3xl md:text-4xl font-black mb-4 uppercase text-[#1f2a5a]">Is This Your Listing?</h1>
      <p class="text-slate-500 text-lg mb-8">Confirm the listing to continue.</p>
      <div class="rounded-[34px] overflow-hidden shadow-2xl mb-8 text-left border border-white/70 bg-white/80 backdrop-blur-sm">
        ${h?.image ? `<img src="${esc(h.image)}" class="h-64 w-full object-cover">` : ''}
        <div class="p-6 md:p-8">
          <div class="inline-block px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest mb-4 shadow-lg text-white" style="background:${s.color}">${esc(s.label)}</div>
          <h3 class="text-2xl md:text-3xl font-black text-[#1F2A5A] leading-tight mb-2">${esc(h?.address || 'Open House')}</h3>
          ${h?.price ? `<div class="text-xl font-black text-blue-600 mb-2">${money(h.price)}</div>` : ''}
          <p class="text-slate-500 text-sm font-black uppercase tracking-widest">${esc(h?.brokerage || '')}</p>
        </div>
      </div>
      <div class="space-y-3">
        <button onclick="confirmListing()" class="w-full py-5 rounded-full font-black text-[18px] md:text-[20px] uppercase tracking-[-0.02em] shadow-[0_18px_40px_rgba(59,130,246,0.28)] active:scale-[0.99] transition-all" style="${primaryButtonStyle()}">Yes - Continue</button>
        <button onclick="showOtherListings()" class="w-full py-5 rounded-full bg-white/85 border border-slate-200 text-slate-700 font-black text-[17px] uppercase tracking-[-0.02em] shadow-sm active:scale-[0.99] transition-all">Show Other Listings</button>
        <button onclick="routeUnknownAgentFlow('', 'Complete your setup manually.')" class="text-slate-400 text-sm font-bold uppercase tracking-widest mt-2">Set Up Manually</button>
      </div>
    </div>
  `);
}

export function showOtherListings() {
  const unique = [...new Map((state.nearbyHouses || []).map((h) => [h.id, h])).values()].slice(0, 10);
  render(`
    <div>
      <h1 class="font-['Poppins'] text-2xl md:text-3xl font-black mb-6 uppercase text-[#1f2a5a]">Select Your Listing</h1>
      <div class="space-y-4 mb-8 max-h-[480px] overflow-y-auto pr-2">
        ${unique.map((h) => {
          const s = getStatus(h);
          return `
            <div onclick="selectHouse('${esc(h.id)}')" class="flex items-start gap-4 p-4 rounded-[28px] border-2 border-white/70 hover:border-blue-400 bg-white/80 backdrop-blur-sm shadow-sm hover:shadow-xl transition-all cursor-pointer">
              ${h.image ? `<img src="${esc(h.image)}" class="w-20 h-20 rounded-2xl object-cover bg-slate-100 shadow-inner">` : `<div class="w-20 h-20 rounded-2xl bg-slate-100 shadow-inner flex items-center justify-center text-slate-400 text-xs font-bold">No Image</div>`}
              <div class="text-left flex-1 min-w-0">
                <div class="text-[10px] font-black mb-1" style="color:${s.color}">${esc(s.label)}</div>
                <div class="font-black text-base text-[#1F2A5A] leading-tight mb-1">${esc(h.address || '')}</div>
                ${h.price ? `<div class="text-blue-600 text-sm font-black mb-1">${money(h.price)}</div>` : ''}
                <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${esc(h.brokerage || '')}</div>
              </div>
            </div>`;
        }).join('')}
      </div>
      <button onclick="routeUnknownAgentFlow('', 'Complete your setup manually.')" class="text-slate-400 text-sm font-bold uppercase tracking-widest">None of These</button>
    </div>
  `);
}

export function showVerifyAgent() {
  const h = state.detectedHouse;
  const verifyPhoto = state.prefilledAgent?.image_url || state.detectedAgentPhoto || '';
  const displayName = state.prefilledAgent?.name || h?.agent || 'Agent';
  const displayPhone = state.prefilledAgent?.phone || h?.agent_phone || '';
  const displayEmail = state.prefilledAgent?.email || h?.agent_email || '';
  const displayBrokerage = state.prefilledAgent?.brokerage || h?.brokerage || '';

  render(`
    <div>
      ${state.currentBrand?.logo_url ? `<img src="${esc(state.currentBrand.logo_url)}?v=${Date.now()}" class="max-h-28 md:max-h-36 max-w-[280px] md:max-w-[380px] object-contain mx-auto mb-6">` : ''}
      <h1 class="font-['Poppins'] text-4xl font-black mb-4 leading-tight uppercase text-[#1f2a5a]">Is This You?</h1>
      <p class="text-slate-500 text-lg mb-6">Confirm your information to continue.</p>
      <div class="bg-blue-50/70 backdrop-blur-sm p-8 md:p-10 rounded-[34px] border-2 border-blue-100 mb-6 shadow-inner">
        ${verifyPhoto ? `<img src="${esc(verifyPhoto)}" class="w-28 h-28 rounded-full object-cover mx-auto shadow-[0_18px_40px_rgba(31,42,90,0.16)] mb-5 bg-white" alt="${esc(displayName)}">` : `<div class="w-28 h-28 rounded-full bg-white border border-blue-100 mx-auto mb-5 shadow-inner flex items-center justify-center text-slate-400 font-black">AGENT</div>`}
        <h3 class="text-3xl md:text-4xl font-black text-blue-900 leading-tight mb-2">${esc(displayName)}</h3>
        <p class="text-blue-600 font-black text-sm uppercase tracking-[0.2em] mb-2">${esc(displayBrokerage)}</p>
        ${displayPhone ? `<div class="text-slate-500 font-semibold">${esc(normalizePhone(displayPhone))}</div>` : ''}
        ${displayEmail ? `<div class="text-slate-500 font-semibold">${esc(displayEmail)}</div>` : ''}
      </div>
      <div class="space-y-3">
        <button onclick="autoActivate()" class="w-full py-5 rounded-full font-black text-[18px] md:text-[20px] uppercase tracking-[-0.02em] shadow-[0_18px_40px_rgba(59,130,246,0.28)] active:scale-[0.99] transition-all" style="${primaryButtonStyle()}">Activate Now</button>
        <button onclick="showFullProfileForm(state.detectedHouse?.brokerage || state.prefilledAgent?.brokerage || '', 'Update or complete your profile below.')" class="w-full py-5 rounded-full bg-white/85 border border-slate-200 text-slate-700 font-black text-[17px] uppercase tracking-[-0.02em] shadow-sm active:scale-[0.99] transition-all">Edit Profile</button>
      </div>
    </div>
  `);
}

export function showAlreadyClaimed(agent) {
  const onboardingUrl = new URL(ROUTES.onboarding, window.location.origin);
  onboardingUrl.searchParams.set('agent', agent.slug || '');
  if (state.uid) onboardingUrl.searchParams.set('uid', state.uid);
  const activateUrl = new URL('/sign-demo-activate.html', window.location.origin);
  activateUrl.searchParams.set('agent', agent.slug || '');
  if (state.uid) activateUrl.searchParams.set('uid', state.uid);

  render(`
    <div>
      <h1 class="font-['Poppins'] text-[34px] md:text-[44px] leading-[0.95] font-black tracking-[-0.04em] text-slate-900 mb-4">This Chip Is Already Active</h1>
      <p class="text-slate-500 text-[17px] md:text-[19px] leading-relaxed font-medium max-w-md mx-auto mb-8">We found an existing agent connected to this Rel8tion chip.</p>
      <div class="rounded-[30px] border border-white/70 bg-white/60 backdrop-blur-sm p-6 text-left mb-8">
        <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Connected Agent</div>
        <div class="text-slate-900 font-black text-2xl mb-1">${esc(agent.name || '')}</div>
        ${agent.brokerage ? `<div class="text-slate-500 font-bold uppercase tracking-[0.14em] text-xs mb-3">${esc(agent.brokerage)}</div>` : ''}
        ${agent.phone ? `<div class="text-slate-600 font-semibold">${esc(normalizePhone(agent.phone))}</div>` : ''}
        ${agent.email ? `<div class="text-slate-600 font-semibold">${esc(agent.email)}</div>` : ''}
      </div>
      <div class="space-y-3">
        <a href="${esc(`${activateUrl.pathname}${activateUrl.search}`)}" class="block w-full py-5 rounded-full font-black text-[18px] md:text-[20px] uppercase tracking-[-0.02em] shadow-[0_18px_40px_rgba(59,130,246,0.28)] transition-all text-center" style="${primaryButtonStyle()}">Activate Smart Sign</a>
        <a href="${esc(`${onboardingUrl.pathname}${onboardingUrl.search}`)}" class="block w-full py-4 rounded-full bg-white/85 border border-slate-200 text-slate-700 font-black text-[17px] uppercase tracking-[-0.02em] shadow-sm transition-all text-center">Open Existing Setup</a>
      </div>
    </div>
  `);
}

export function showMissingChipNotice() {
  showIntro('This preview was opened without a chip uid. You can review the flow here, but live activation requires a real Rel8tionChip link.');
}

export function showForm(prefillBrokerage = '', notice = '') {
  const brokerage = prefillBrokerage || state.selectedBrokerage || state.prefilledAgent?.brokerage || state.detectedHouse?.brokerage || '';
  if (isKnownBrokerage(brokerage)) {
    showFullProfileForm(brokerage, notice || 'Complete your profile to activate your Rel8tionchip.');
    return;
  }
  showBrokerageStep(notice || 'Select your brokerage to continue.');
}

export function showFullProfileForm(prefillBrokerage = '', notice = '') {
  const p = state.prefilledAgent || {};
  const h = state.detectedHouse || {};
  const name = p.name || h.agent || '';
  const phone = p.phone || h.agent_phone || '';
  const email = p.email || h.agent_email || '';
  const brokerage = prefillBrokerage || p.brokerage || h.brokerage || state.selectedBrokerage || '';
  const bio = p.bio || '';
  const storedImage = p.image_url || state.detectedAgentPhoto || '';

  render(`
    <div>
      ${state.currentBrand?.logo_url ? `<img src="${esc(state.currentBrand.logo_url)}?v=${Date.now()}" class="max-h-28 md:max-h-36 max-w-[280px] md:max-w-[380px] object-contain mx-auto mb-6">` : ''}
      <h1 class="font-['Poppins'] text-[28px] md:text-[38px] leading-[0.98] font-black tracking-[-0.04em] text-slate-900 mb-3 uppercase">Complete Your Profile</h1>
      <p class="text-slate-500 text-[16px] md:text-[18px] leading-relaxed font-medium max-w-md mx-auto mb-6">Enter your details to activate your Rel8tionchip.</p>
      ${notice ? `<div class="mb-6 rounded-[22px] border border-blue-100 bg-blue-50/70 backdrop-blur-sm text-blue-700 px-5 py-4 text-sm font-semibold">${esc(notice)}</div>` : ''}
      <div class="space-y-4 text-left">
        <input id="full_name" value="${esc(name)}" placeholder="Full Name *" class="w-full rounded-[20px] border border-slate-200 bg-white/80 px-5 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-blue-400">
        <input id="full_phone" value="${esc(phone)}" placeholder="Phone Number *" class="w-full rounded-[20px] border border-slate-200 bg-white/80 px-5 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-blue-400">
        <input id="full_email" value="${esc(email)}" placeholder="Email" class="w-full rounded-[20px] border border-slate-200 bg-white/80 px-5 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-blue-400">
        <select id="full_brokerage_select" class="w-full rounded-[20px] border border-slate-200 bg-white/80 px-5 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-blue-400">
          ${getBrokerageOptions().map((opt) => {
            const selected = ((opt !== '__other__' && opt === brokerage) || (opt === '__other__' && brokerage && !isKnownBrokerage(brokerage))) ? 'selected' : '';
            const label = opt === '' ? 'Select Brokerage' : (opt === '__other__' ? "Other / My Brokerage Isn't Listed" : opt);
            return `<option value="${esc(opt)}" ${selected}>${esc(label)}</option>`;
          }).join('')}
        </select>
        <input id="full_brokerage_custom" value="${esc(isKnownBrokerage(brokerage) ? '' : brokerage)}" placeholder="Enter Brokerage Name" class="w-full rounded-[20px] border border-slate-200 bg-white/80 px-5 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-blue-400 ${(brokerage && !isKnownBrokerage(brokerage)) ? '' : 'hidden'}">
        <label class="block rounded-[24px] border-2 border-dashed border-indigo-200 bg-gradient-to-br from-indigo-50/90 to-slate-50/90 px-5 py-5 text-center cursor-pointer hover:scale-[1.01] transition-all backdrop-blur-sm">
          <div class="text-slate-900 font-black text-lg mb-1">Add or Update Photo</div>
          <div class="text-slate-500 text-sm font-semibold">Tap to upload</div>
          <input type="file" id="full_photo" accept="image/*" hidden>
        </label>
        <img id="full_preview" src="${esc(storedImage)}" class="${storedImage ? 'block' : 'hidden'} w-full rounded-[24px] max-h-[280px] object-cover shadow-sm bg-white">
        <textarea id="full_bio" placeholder="Short Bio" class="w-full rounded-[20px] border border-slate-200 bg-white/80 px-5 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-blue-400 min-h-[120px] resize-y">${esc(bio)}</textarea>
      </div>
      <div class="mt-6 space-y-3">
        <button onclick="saveFullProfile()" class="w-full py-5 rounded-full font-black text-[18px] md:text-[20px] uppercase tracking-[-0.02em] shadow-[0_18px_40px_rgba(59,130,246,0.28)] active:scale-[0.99] transition-all" style="${primaryButtonStyle()}">Save and Activate</button>
      </div>
    </div>
  `);

  attachFullProfileHandlers();
}
