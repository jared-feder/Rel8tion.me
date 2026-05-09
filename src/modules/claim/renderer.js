import { ASSETS } from '../../core/config.js';
import { state } from '../../core/state.js';
import { esc, getStatus, money, normalizePhone } from '../../core/utils.js';

export function getBrandColors() {
  return {
    primary: state.currentBrand?.primary_color || '#38bdf8',
    accent: state.currentBrand?.accent_color || '#2563eb'
  };
}

export function setAppBackground() {
  const app = document.getElementById('app');
  app.className = 'min-h-screen flex items-center justify-center p-4 md:p-6 transition-all duration-700';
  app.style.background = `
    radial-gradient(circle at top left, rgba(96,165,250,0.32), transparent 35%),
    radial-gradient(circle at bottom right, rgba(59,130,246,0.20), transparent 35%),
    linear-gradient(180deg, #eaf4ff 0%, #dceeff 45%, #eef6ff 100%)
  `;
}

export function primaryButtonStyle() {
  const c = getBrandColors();
  return `background:linear-gradient(90deg, ${c.primary}, ${c.accent}); color:white;`;
}

export function render(content) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="w-full max-w-xl rounded-[38px] md:rounded-[46px] border border-white/90 bg-white p-6 md:p-10 shadow-[0_35px_90px_rgba(31,42,90,0.12)] text-center transition-all duration-500">
      <div class="mb-8">
        <img src="${ASSETS.rel8tionLogo}" class="h-16 md:h-20 mx-auto drop-shadow-sm" alt="Rel8tion">
      </div>
      ${content}
    </div>
  `;
  setAppBackground();
}

export function showLoading(msg = 'Finding Your Listing ✨') {
  render(`
    <div class="py-10 md:py-14">
      <div class="w-20 h-20 border-8 border-slate-100 border-t-blue-600 rounded-full animate-spin mx-auto mb-8"></div>
      <h2 class="text-2xl md:text-3xl font-black mb-2 tracking-tight text-[#1f2a5a]">Finding Your Listing ✨</h2>
      <p id="loaderText" class="text-slate-500 text-lg font-bold animate-pulse">${esc(msg)}</p>
      <div class="mt-8 w-full h-3 rounded-full bg-slate-100 overflow-hidden">
        <div class="h-full rounded-full animate-[progressMove_1.3s_ease-in-out_infinite_alternate]" style="width:42%;background:linear-gradient(90deg,#38bdf8,#2563eb);"></div>
      </div>
      <p class="mt-4 text-xs text-slate-400 font-bold uppercase tracking-[0.22em]">⚡ This only takes a second...</p>
    </div>
  `);
}

export function showError(title, message) {
  render(`
    <div>
      <h1 class="font-['Poppins'] text-[30px] md:text-[40px] leading-[0.98] font-black tracking-[-0.04em] text-slate-900 mb-3 uppercase">
        ${esc(title || 'Something Went Wrong')}
      </h1>
      <p class="text-slate-500 text-[17px] md:text-[18px] leading-relaxed font-medium max-w-md mx-auto mb-6">
        ${esc(message || 'Please try again.')}
      </p>
      <div class="space-y-3">
        <button onclick="init()" class="w-full py-5 rounded-full font-black text-[18px] md:text-[20px] uppercase tracking-[-0.02em] shadow-[0_18px_40px_rgba(59,130,246,0.28)] active:scale-[0.99] transition-all" style="${primaryButtonStyle()}">Try Again</button>
        <button onclick="showForm()" class="w-full py-5 rounded-full bg-white border border-slate-200 text-slate-700 font-black text-[17px] uppercase tracking-[-0.02em] shadow-sm active:scale-[0.99] transition-all">Set Up Manually</button>
      </div>
    </div>
  `);
}

export function showIntro() {
  render(`
    <div class="text-center">
      <div class="inline-flex items-center justify-center mb-6">
        <div class="px-4 py-2 rounded-full bg-slate-50 border border-slate-200 shadow-sm text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Agent Activation</div>
      </div>
      <h1 class="font-['Poppins'] text-[38px] md:text-[52px] leading-[0.95] font-black tracking-[-0.04em] text-slate-900 mb-4">Meet Your<br>Rel8tionchip ✨</h1>
      <p class="text-slate-500 text-[17px] md:text-[19px] leading-relaxed font-medium max-w-md mx-auto mb-8">Every tap = a new lead. We handle the relationship until closing.</p>
      <div class="rounded-[34px] border border-slate-100 bg-white shadow-[0_20px_60px_rgba(31,42,90,0.08)] p-5 md:p-6 mb-7 text-left">
        <div class="flex items-center gap-4">
          <div class="shrink-0">
            <div class="relative w-[110px] h-[110px] md:w-[128px] md:h-[128px] floating-chip">
              <div class="absolute inset-0 rounded-full blur-2xl opacity-40 bg-[radial-gradient(circle,#60a5fa_0%,#a855f7_45%,transparent_75%)]"></div>
              <img src="${ASSETS.floatingChip}" class="relative w-full h-full object-contain drop-shadow-[0_22px_45px_rgba(64,200,255,0.28)]" alt="Rel8tion Floating Chip">
            </div>
          </div>
          <div class="min-w-0">
            <div class="text-slate-900 text-[24px] md:text-[26px] leading-[1.0] font-black tracking-[-0.03em] mb-2">From Tap To<br>Closing Table</div>
            <p class="text-slate-500 text-[15px] md:text-[17px] leading-relaxed font-medium">We capture, follow up, and nurture the smart way.</p>
          </div>
        </div>
      </div>
      <div class="rounded-[28px] border border-blue-100 bg-slate-50 px-6 py-6 shadow-inner mb-7">
        <div class="text-slate-900 text-[19px] md:text-[20px] font-black tracking-[-0.02em]">Put it on your keychain and use it everyday.</div>
      </div>
      <div class="space-y-3">
        <button onclick="startDetection()" class="w-full py-5 rounded-full font-black text-[18px] md:text-[20px] uppercase tracking-[-0.02em] shadow-[0_18px_40px_rgba(59,130,246,0.28)] active:scale-[0.99] transition-all" style="${primaryButtonStyle()}">🟢 Yes — Detect My Listing</button>
        <button onclick="skipToForm()" class="w-full py-5 rounded-full bg-white border border-slate-200 text-slate-700 font-black text-[17px] md:text-[18px] uppercase tracking-[-0.02em] shadow-sm active:scale-[0.99] transition-all">🔵 No — Set Up Manually</button>
      </div>
    </div>
  `);
}

export function showDetection() {
  const h = state.detectedHouse;
  const s = getStatus(h);
  render(`
    <div>
      <h1 class="font-['Poppins'] text-3xl md:text-4xl font-black mb-4 uppercase text-[#1f2a5a]">Is This Your Open House?</h1>
      <p class="text-slate-500 text-lg mb-8">If this is the right listing, we can preload your setup and speed things up.</p>
      <div class="rounded-[34px] overflow-hidden shadow-2xl mb-8 text-left border border-slate-100 bg-white">
        ${h?.image ? `<img src="${esc(h.image)}" class="h-64 w-full object-cover">` : ''}
        <div class="p-6 md:p-8">
          <div class="inline-block px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest mb-4 shadow-lg text-white" style="background:${s.color}">${s.icon} ${s.label}</div>
          <h3 class="text-2xl md:text-3xl font-black text-[#1F2A5A] leading-tight mb-2">${esc(h?.address || 'Open House')}</h3>
          ${h?.price ? `<div class="text-xl font-black text-blue-600 mb-2">${money(h.price)}</div>` : ''}
          <p class="text-slate-500 text-sm font-black uppercase tracking-widest">${esc(h?.brokerage || '')}</p>
        </div>
      </div>
      <div class="space-y-3">
        <button onclick="confirmListing()" class="w-full py-5 rounded-full font-black text-[18px] md:text-[20px] uppercase tracking-[-0.02em] shadow-[0_18px_40px_rgba(59,130,246,0.28)] active:scale-[0.99] transition-all" style="${primaryButtonStyle()}">💯 Yes — Activate This Listing</button>
        <button onclick="showOtherListings()" class="w-full py-5 rounded-full bg-white border border-slate-200 text-slate-700 font-black text-[17px] uppercase tracking-[-0.02em] shadow-sm active:scale-[0.99] transition-all">Show Other Listings Nearby</button>
        <button onclick="showForm()" class="text-slate-400 text-sm font-bold uppercase tracking-widest mt-2">Skip — Set Up Manually</button>
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
            <div onclick="selectHouse('${esc(h.id)}')" class="flex items-start gap-4 p-4 rounded-[28px] border-2 border-slate-100 hover:border-blue-400 bg-white shadow-sm hover:shadow-xl transition-all cursor-pointer">
              ${h.image ? `<img src="${esc(h.image)}" class="w-20 h-20 rounded-2xl object-cover bg-slate-100 shadow-inner">` : `<div class="w-20 h-20 rounded-2xl bg-slate-100 shadow-inner flex items-center justify-center text-slate-400 text-xs font-bold">No Image</div>`}
              <div class="text-left flex-1 min-w-0">
                <div class="text-[10px] font-black mb-1" style="color:${s.color}">${s.icon} ${s.label}</div>
                <div class="font-black text-base text-[#1F2A5A] leading-tight mb-1">${esc(h.address || '')}</div>
                ${h.price ? `<div class="text-blue-600 text-sm font-black mb-1">${money(h.price)}</div>` : ''}
                <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${esc(h.brokerage || '')}</div>
              </div>
            </div>`;
        }).join('')}
      </div>
      <button onclick="showForm()" class="text-slate-400 text-sm font-bold uppercase tracking-widest">None of These — Set Up Manually</button>
    </div>
  `);
}

export function showVerifyAgent() {
  const h = state.detectedHouse;
  const hasAnyDetectedInfo = !!(h?.agent || h?.agent_phone || h?.agent_email);
  render(`
    <div>
      ${state.currentBrand?.logo_url ? `<img src="${esc(state.currentBrand.logo_url)}?v=${Date.now()}" class="max-h-16 max-w-[170px] object-contain mx-auto mb-6">` : ''}
      <h1 class="font-['Poppins'] text-4xl font-black mb-4 leading-tight uppercase text-[#1f2a5a]">Wait — Is This You?</h1>
      <p class="text-slate-500 text-lg mb-6">We found profile details attached to this listing. Go live now or finish your profile first.</p>
      <div class="bg-blue-50/50 p-8 md:p-10 rounded-[34px] border-2 border-blue-100 mb-6 shadow-inner">
        <h3 class="text-3xl md:text-4xl font-black text-blue-900 leading-tight mb-2">${esc(h?.agent || 'Profile info found')}</h3>
        <p class="text-blue-600 font-black text-sm uppercase tracking-[0.2em] mb-2">${esc(h?.brokerage || '')}</p>
        ${h?.agent_phone ? `<div class="text-slate-500 font-semibold">${esc(normalizePhone(h.agent_phone))}</div>` : ''}
        ${h?.agent_email ? `<div class="text-slate-500 font-semibold">${esc(h.agent_email)}</div>` : ''}
      </div>
      ${hasAnyDetectedInfo ? `<div class="rounded-[22px] border border-slate-100 bg-slate-50 px-5 py-4 text-left mb-6"><div class="text-slate-900 font-black text-base mb-1">Would you like to complete your profile now?</div><div class="text-slate-500 text-sm font-medium">Add photo, email, bio, social links, and website now, or do it later after onboarding.</div></div>` : ''}
      <div class="space-y-3">
        <button onclick="autoActivate()" class="w-full py-5 rounded-full font-black text-[18px] md:text-[20px] uppercase tracking-[-0.02em] shadow-[0_18px_40px_rgba(59,130,246,0.28)] active:scale-[0.99] transition-all" style="${primaryButtonStyle()}">✅ Activate Now</button>
        <button onclick="showFullProfileForm()" class="w-full py-5 rounded-full bg-white border border-slate-200 text-slate-700 font-black text-[17px] uppercase tracking-[-0.02em] shadow-sm active:scale-[0.99] transition-all">✍️ Complete Profile Now</button>
        <button onclick="showForm(state.detectedHouse?.brokerage || '')" class="w-full py-5 rounded-full bg-white border border-slate-200 text-slate-700 font-black text-[17px] uppercase tracking-[-0.02em] shadow-sm active:scale-[0.99] transition-all">No — Let Me Edit My Info</button>
      </div>
    </div>
  `);
}

export function showAlreadyClaimed(agent) {
  render(`
    <div>
      ${state.currentBrand?.logo_url ? `<img src="${esc(state.currentBrand.logo_url)}?v=${Date.now()}" class="max-h-16 max-w-[170px] object-contain mx-auto mb-6">` : ''}
      <h1 class="font-['Poppins'] text-[34px] md:text-[44px] leading-[0.95] font-black tracking-[-0.04em] text-slate-900 mb-4">This Chip Is Already Active</h1>
      <p class="text-slate-500 text-[17px] md:text-[19px] leading-relaxed font-medium max-w-md mx-auto mb-8">We found an existing agent connected to this Rel8tion chip.</p>
      <div class="rounded-[30px] border border-slate-100 bg-slate-50/90 p-6 text-left mb-8">
        <div class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Connected Agent</div>
        <div class="text-slate-900 font-black text-2xl mb-1">${esc(agent.name || '')}</div>
        ${agent.brokerage ? `<div class="text-slate-500 font-bold uppercase tracking-[0.14em] text-xs mb-3">${esc(agent.brokerage)}</div>` : ''}
        ${agent.phone ? `<div class="text-slate-600 font-semibold">${esc(normalizePhone(agent.phone))}</div>` : ''}
        ${agent.email ? `<div class="text-slate-600 font-semibold">${esc(agent.email)}</div>` : ''}
      </div>
      <div class="space-y-3">
        <a href="/onboarding?agent=${encodeURIComponent(agent.slug || '')}" class="block w-full py-5 rounded-full font-black text-[18px] md:text-[20px] uppercase tracking-[-0.02em] shadow-[0_18px_40px_rgba(59,130,246,0.28)] transition-all text-center" style="${primaryButtonStyle()}">Open Existing Setup</a>
        <button onclick="showFullProfileForm('${esc(agent.brokerage || '')}', 'Update your full profile anytime below.')" class="w-full py-5 rounded-full bg-white border border-slate-200 text-slate-700 font-black text-[17px] uppercase tracking-[-0.02em] shadow-sm transition-all">Complete / Update Full Profile</button>
      </div>
    </div>
  `);
}

export function showForm(prefillBrokerage = '', notice = '') {
  const p = state.prefilledAgent || {};
  const brokerage = prefillBrokerage || p.brokerage || state.detectedHouse?.brokerage || '';
  const loveLine = brokerage ? `Get your ${brokerage} profile live in seconds.` : 'Fast setup. Big results.';
  render(`
    <div>
      ${state.currentBrand?.logo_url ? `<img src="${esc(state.currentBrand.logo_url)}?v=${Date.now()}" class="max-h-16 max-w-[170px] object-contain mx-auto mb-6">` : ''}
      <h1 class="font-['Poppins'] text-[30px] md:text-[40px] leading-[0.98] font-black tracking-[-0.04em] text-slate-900 mb-3 uppercase">Activate Your REL8TIONCHIP</h1>
      <p class="text-slate-500 text-[17px] md:text-[18px] leading-relaxed font-medium max-w-md mx-auto mb-6">${esc(loveLine)}</p>
      ${notice ? `<div class="mb-6 rounded-[22px] border border-blue-100 bg-blue-50 text-blue-700 px-5 py-4 text-sm font-semibold">${esc(notice)}</div>` : ''}
      <div class="space-y-4 text-left">
        <input id="name" value="${esc(p.name || '')}" placeholder="Full Name *" class="w-full rounded-[20px] border border-slate-200 bg-slate-50 px-5 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-blue-400">
        <input id="phone" value="${esc(p.phone || '')}" placeholder="Phone Number *" class="w-full rounded-[20px] border border-slate-200 bg-slate-50 px-5 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-blue-400">
      </div>
      <div class="mt-6 space-y-3">
        <button onclick="activate()" class="w-full py-5 rounded-full font-black text-[18px] md:text-[20px] uppercase tracking-[-0.02em] shadow-[0_18px_40px_rgba(59,130,246,0.28)] active:scale-[0.99] transition-all" style="${primaryButtonStyle()}">Activate My Profile</button>
        <button onclick="startDetection()" class="w-full py-5 rounded-full bg-white border border-slate-200 text-slate-700 font-black text-[17px] uppercase tracking-[-0.02em] shadow-sm active:scale-[0.99] transition-all">Try Detection Again</button>
      </div>
    </div>
  `);
}

export function showFullProfileForm(prefillBrokerage = '', notice = '') {
  const p = state.prefilledAgent || {};
  const h = state.detectedHouse || {};
  const name = p.name || h.agent || '';
  const phone = p.phone || h.agent_phone || '';
  const email = p.email || h.agent_email || '';
  const brokerage = prefillBrokerage || p.brokerage || h.brokerage || '';
  const instagram = p.instagram || '';
  const website = p.website || '';
  const facebook = p.facebook || '';
  const bio = p.bio || '';
  const image_url = p.image_url || '';
  render(`
    <div>
      ${state.currentBrand?.logo_url ? `<img src="${esc(state.currentBrand.logo_url)}?v=${Date.now()}" class="max-h-16 max-w-[170px] object-contain mx-auto mb-6">` : ''}
      <h1 class="font-['Poppins'] text-[28px] md:text-[38px] leading-[0.98] font-black tracking-[-0.04em] text-slate-900 mb-3 uppercase">Complete Your Profile</h1>
      <p class="text-slate-500 text-[16px] md:text-[18px] leading-relaxed font-medium max-w-md mx-auto mb-6">Add the rest of your details now so your live profile looks polished instead of half-awake.</p>
      ${notice ? `<div class="mb-6 rounded-[22px] border border-blue-100 bg-blue-50 text-blue-700 px-5 py-4 text-sm font-semibold">${esc(notice)}</div>` : ''}
      <div class="space-y-4 text-left">
        <input id="full_name" value="${esc(name)}" placeholder="Full Name *" class="w-full rounded-[20px] border border-slate-200 bg-slate-50 px-5 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-blue-400">
        <input id="full_phone" value="${esc(phone)}" placeholder="Phone Number *" class="w-full rounded-[20px] border border-slate-200 bg-slate-50 px-5 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-blue-400">
        <input id="full_email" value="${esc(email)}" placeholder="Email" class="w-full rounded-[20px] border border-slate-200 bg-slate-50 px-5 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-blue-400">
        <input id="full_brokerage" value="${esc(brokerage)}" placeholder="Brokerage" class="w-full rounded-[20px] border border-slate-200 bg-slate-50 px-5 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-blue-400">
        <label class="block rounded-[24px] border-2 border-dashed border-indigo-200 bg-gradient-to-br from-indigo-50 to-slate-50 px-5 py-5 text-center cursor-pointer hover:scale-[1.01] transition-all">
          <div class="text-slate-900 font-black text-lg mb-1">📸 Add Profile Photo</div>
          <div class="text-slate-500 text-sm font-semibold">Tap to upload</div>
          <input type="file" id="full_photo" accept="image/*" hidden>
        </label>
        <img id="full_preview" src="${esc(image_url)}" class="${image_url ? 'block' : 'hidden'} w-full rounded-[24px] max-h-[280px] object-cover shadow-sm">
        <input id="full_instagram" value="${esc(instagram)}" placeholder="Instagram" class="w-full rounded-[20px] border border-slate-200 bg-slate-50 px-5 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-blue-400">
        <input id="full_website" value="${esc(website)}" placeholder="Website" class="w-full rounded-[20px] border border-slate-200 bg-slate-50 px-5 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-blue-400">
        <input id="full_facebook" value="${esc(facebook)}" placeholder="Facebook" class="w-full rounded-[20px] border border-slate-200 bg-slate-50 px-5 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-blue-400">
        <textarea id="full_bio" placeholder="Bio" class="w-full rounded-[20px] border border-slate-200 bg-slate-50 px-5 py-4 text-[16px] font-semibold text-slate-900 outline-none focus:border-blue-400 min-h-[120px] resize-y">${esc(bio)}</textarea>
      </div>
      <div class="mt-6 space-y-3">
        <button onclick="saveFullProfile()" class="w-full py-5 rounded-full font-black text-[18px] md:text-[20px] uppercase tracking-[-0.02em] shadow-[0_18px_40px_rgba(59,130,246,0.28)] active:scale-[0.99] transition-all" style="${primaryButtonStyle()}">Save Full Profile</button>
        <button onclick="autoActivate()" class="w-full py-5 rounded-full bg-white border border-slate-200 text-slate-700 font-black text-[17px] uppercase tracking-[-0.02em] shadow-sm active:scale-[0.99] transition-all">Do This Later</button>
      </div>
    </div>
  `);

  const photo = document.getElementById('full_photo');
  if (photo) {
    photo.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const preview = document.getElementById('full_preview');
        preview.src = URL.createObjectURL(file);
        preview.classList.remove('hidden');
        preview.classList.add('block');
      }
    };
  }
}