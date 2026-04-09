import { CHECKIN_PATHS } from "./config.js";

function esc(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getBranding(event) {
  const branding = event?.branding_snapshot || {};
  return {
    logo: branding.logo || "https://rel8tion.info/wp-content/uploads/2026/04/logo150x100trans.png",
    primaryColor: branding.primary_color || "#1f2a5a",
    accentColor: branding.accent_color || "#2563eb",
    brokerageName: branding.brokerage_name || event?.brokerage_name || "Hosted by Rel8tion"
  };
}

function pathButton(path, label, selectedPath, eventId, accentColor) {
  const selected = path === selectedPath;
  const style = selected
    ? `background:${accentColor};color:white;border-color:${accentColor};`
    : "background:white;color:#1f2a5a;border-color:#cbd5e1;";

  return `
    <a href="?event=${encodeURIComponent(eventId)}&path=${encodeURIComponent(path)}"
       class="px-4 py-3 rounded-full border font-semibold text-sm"
       style="${style}">
      ${esc(label)}
    </a>
  `;
}

function formFieldsByPath(path) {
  if (path === CHECKIN_PATHS.BUYER) {
    return `
      <input name="visitor_name" required placeholder="Your name" class="field" />
      <input name="visitor_phone" placeholder="Your phone" class="field" />
      <input name="visitor_email" type="email" placeholder="Your email" class="field" />
      <label class="text-sm font-medium text-slate-700">Pre-approved?</label>
      <select name="pre_approved" class="field">
        <option value="">Select</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    `;
  }

  if (path === CHECKIN_PATHS.BUYER_WITH_AGENT) {
    return `
      <input name="visitor_name" required placeholder="Buyer name" class="field" />
      <input name="visitor_phone" placeholder="Buyer phone" class="field" />
      <input name="visitor_email" type="email" placeholder="Buyer email" class="field" />
      <input name="buyer_agent_name" required placeholder="Agent name" class="field" />
      <input name="buyer_agent_phone" placeholder="Agent phone" class="field" />
      <input name="buyer_agent_email" type="email" placeholder="Agent email" class="field" />
    `;
  }

  return `
    <input name="buyer_agent_name" required placeholder="Agent name" class="field" />
    <input name="buyer_agent_phone" placeholder="Agent phone" class="field" />
    <input name="buyer_agent_email" type="email" placeholder="Agent email" class="field" />
    <input name="visitor_name" required placeholder="Buyer name" class="field" />
    <label class="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" name="represented_buyer_confirmed" value="true" />
      I represent this buyer
    </label>
  `;
}

export function renderEventPage({ root, event, selectedPath, onSubmit }) {
  const branding = getBranding(event);

  root.innerHTML = `
    <style>
      body { margin:0; font-family: Inter, system-ui, sans-serif; background: linear-gradient(180deg, #eaf4ff 0%, #eef2ff 100%); }
      .shell { max-width: 900px; margin: 24px auto; background: white; border-radius: 24px; border: 1px solid #e2e8f0; box-shadow: 0 20px 60px rgba(30,41,59,.10); overflow: hidden; }
      .field { width:100%; border:1px solid #cbd5e1; border-radius: 12px; padding: 12px 14px; font-size:14px; }
      .module { border:1px dashed #cbd5e1; border-radius: 14px; padding: 14px; color: #475569; background: #f8fafc; }
    </style>

    <div class="shell">
      <header style="padding:20px 24px; border-bottom:1px solid #e2e8f0; background: ${branding.primaryColor}10;">
        <div style="display:flex; gap:16px; align-items:center; justify-content:space-between; flex-wrap: wrap;">
          <div style="display:flex;align-items:center;gap:12px;">
            <img src="${esc(branding.logo)}" alt="Brand logo" style="height:44px; width:auto; object-fit:contain;">
            <div>
              <div style="font-size:18px; font-weight:700; color:${branding.primaryColor};">Smart Sign Event</div>
              <div style="font-size:13px; color:#475569;">${esc(branding.brokerageName)}</div>
            </div>
          </div>
          <div style="font-size:12px; color:#64748b;">Event #${esc(event.id || "")}</div>
        </div>
      </header>

      <main style="padding:24px; display:grid; gap:18px;">
        <section>
          <h2 style="margin:0 0 8px 0; color:${branding.primaryColor};">Choose check-in path</h2>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            ${pathButton(CHECKIN_PATHS.BUYER, "Buyer", selectedPath, event.id, branding.accentColor)}
            ${pathButton(CHECKIN_PATHS.BUYER_WITH_AGENT, "Buyer with agent", selectedPath, event.id, branding.accentColor)}
            ${pathButton(CHECKIN_PATHS.BUYER_AGENT, "Buyer agent", selectedPath, event.id, branding.accentColor)}
          </div>
        </section>

        <section style="border:1px solid #e2e8f0; border-radius:16px; padding:18px;">
          <h3 style="margin-top:0; color:${branding.primaryColor};">Check-in</h3>
          <form id="checkin-form" style="display:grid; gap:10px;">
            ${formFieldsByPath(selectedPath)}
            <button type="submit" style="border:0; border-radius:12px; padding:12px 14px; font-weight:700; color:white; background:${branding.accentColor}; cursor:pointer;">
              Submit check-in
            </button>
            <div id="form-status" style="font-size:13px; color:#475569;"></div>
          </form>
        </section>

        <section style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px;">
          <div class="module">Images / Media module<br><strong>Coming soon</strong></div>
          <div class="module">Virtual tour module<br><strong>Coming soon</strong></div>
          <div class="module">Report card module<br><strong>Coming soon</strong></div>
          <div class="module">Compliance forms module<br><strong>Coming soon</strong></div>
        </section>
      </main>
    </div>
  `;

  const form = root.querySelector("#checkin-form");
  const status = root.querySelector("#form-status");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.textContent = "Submitting...";
    const values = Object.fromEntries(new FormData(form).entries());
    values.represented_buyer_confirmed = Boolean(values.represented_buyer_confirmed);

    try {
      await onSubmit(values);
      form.reset();
      status.textContent = "Check-in saved. Thank you.";
    } catch (error) {
      status.textContent = `Unable to save check-in: ${error.message}`;
    }
  });
}
