const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const readline = require("readline");
const path = require("path");
const { parseListingContacts: parseSafeContacts, createStore, fileJournal, acquireRunLock } = require("./trulia-safe-store.cjs");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const { createTelegramApprovalGate } = require("./trulia-phone-approval.cjs");

puppeteer.use(StealthPlugin());

const SUPABASE_URL = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || key;
const LIMIT = Number(process.env.LIMIT || 50);
const HEADLESS = String(process.env.HEADLESS || "false").toLowerCase() === "true";
const CHROME_USER_DATA_DIR = process.env.CHROME_USER_DATA_DIR || "./chrome-profile";

// Same radius-style targeting as your working file.
// Override in PowerShell for Oceanside, Shirley, etc.
const CENTER_LAT = Number(process.env.CENTER_LAT || 40.79343);
const CENTER_LNG = Number(process.env.CENTER_LNG || -73.41512);
const RADIUS_MILES = Number(process.env.RADIUS_MILES || 15);

// IMPORTANT:
// Default keeps your OLD FILE behavior: it does NOT filter out already-scraped rows.
// Once you confirm this file works, set SKIP_AGENT_SCRAPED=true to stop repeats.
const SKIP_AGENT_SCRAPED = String(process.env.SKIP_AGENT_SCRAPED || "false").toLowerCase() === "true";
const SKIP_EXISTING_LISTING_AGENTS = String(process.env.SKIP_EXISTING_LISTING_AGENTS || "false").toLowerCase() === "true";
const MARK_NO_DATA_ATTEMPTS = String(process.env.MARK_NO_DATA_ATTEMPTS || "true").toLowerCase() === "true";
const MANUAL_VERIFY = String(process.env.MANUAL_VERIFY || "true").toLowerCase() === "true";
const phoneApprovalGate = createTelegramApprovalGate({ env: process.env, logger: console });
const PULL_POOL = Number(process.env.PULL_POOL || 2000);

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars");
  process.exit(1);
}

// =========================
// HELPERS
// =========================
function delay(min = 2500, max = 5500) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEnter(message = "Press ENTER to continue...") {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${message}\n`, () => {
      rl.close();
      resolve();
    });
  });
}

function normalizeText(str = "") {
  return String(str)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "")
    .trim();
}

function normalizePhone(phone = "") {
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

function shouldSkipAddress(address = "") {
  const a = String(address).toLowerCase().trim();
  return (
    !a ||
    a.includes("undisclosed address") ||
    a.includes("address not disclosed") ||
    a.includes("hidden address") ||
    a.includes("unknown")
  );
}

function isBlockedText(text = "") {
  const t = String(text || "").toLowerCase();
  return (
    t.includes("px-captcha") ||
    t.includes("access to this page has been denied") ||
    t.includes("press and hold") ||
    t.includes("verify you are human") ||
    t.includes("are you a human")
  );
}

function hasListingBlock(text = "") {
  return /Listing by:/i.test(text) && /Source:/i.test(text);
}

function extractPhone(line = "") {
  const match = line.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  return match ? match[0] : null;
}

function removePhone(line = "") {
  return normalizeText(
    line
      .replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/, "")
      .replace(/,\s*$/, "")
  );
}

function looksLikeBrokerage(name = "") {
  const n = name.toLowerCase();
  const words = [
    "real estate",
    "realty",
    "properties",
    "property",
    "group",
    "inc",
    "llc",
    "brokerage",
    "associates",
    "homes",
    "fortune",
    "premier",
    "coldwell banker",
    "keller williams",
    "compass",
    "sotheby",
    "elliman",
    "nest seekers",
    "re/max",
    "remax",
    "century 21",
    "signature",
    "corcoran",
    "exit",
    "brown harris",
    "modern spaces"
  ];
  return words.some((w) => n.includes(w));
}

function extractListingBlock(text = "") {
  const match = text.match(/Listing by:(.*?)(Source:|Home Details|Property Information|$)/is);
  return match ? match[1] : "";
}

function splitListingLines(block = "") {
  return String(block)
    .split("\n")
    .map((s) => normalizeText(s))
    .filter(Boolean);
}

function parseListingContacts(text = "") {
  return parseSafeContacts(text);
}

// Haversine distance in miles
function distanceMiles(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 3958.8;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.asin(Math.sqrt(a));
  return R * c;
}

// =========================
// SUPABASE REST HELPERS
// =========================
async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`
    }
  });

  const txt = await res.text();
  if (!res.ok) throw new Error(`GET failed ${res.status}: ${txt}`);
  return txt ? JSON.parse(txt) : [];
}

async function supabasePost(path, body) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: "resolution=ignore-duplicates,return=representation"
    },
    body: JSON.stringify(body)
  });

  const txt = await res.text();
  if (!res.ok) throw new Error(`POST failed ${res.status}: ${txt}`);
  return txt ? JSON.parse(txt) : [];
}

async function supabasePatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: "return=representation"
    },
    body: JSON.stringify(body)
  });

  const txt = await res.text();
  if (!res.ok) throw new Error(`PATCH failed ${res.status}: ${txt}`);
  return txt ? JSON.parse(txt) : [];
}

// =========================
// GET LISTINGS — based on your old working file
// =========================

function isUpcomingOpenHouse(row, now = Date.now()) {
  const start = Date.parse(row.open_start || '');
  if (!Number.isFinite(start) || start <= now) return false;
  if (row.open_end) {
    const end = Date.parse(row.open_end);
    if (!Number.isFinite(end) || end <= start) return false;
  }
  return true;
}

function normalizePropertyAddress(value) {
  const aliases = { street: 'st', avenue: 'ave', road: 'rd', drive: 'dr', court: 'ct', boulevard: 'blvd', lane: 'ln', place: 'pl', terrace: 'ter', highway: 'hwy', north: 'n', south: 's', east: 'e', west: 'w' };
  return String(value || '').toLowerCase().replace(/\b(?:apt|apartment|unit)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).map(token => aliases[token] || token).join(' ');
}

function matchesTruliaAddress(address, resultUrl) {
  let url;
  try { url = new URL(resultUrl); } catch { return false; }
  if (!/(^|\.)trulia\.com$/i.test(url.hostname) || !/^\/(home|p|property)\//i.test(url.pathname)) return false;
  const expected = normalizePropertyAddress(address);
  if (!/^\d/.test(expected)) return false;
  let actual;
  try { actual = normalizePropertyAddress(decodeURIComponent(url.pathname)); } catch { return false; }
  return (' ' + actual + ' ').includes(' ' + expected + ' ');
}

function isUnavailableProperty(text) {
  const value = String(text || '');
  const listingAt = value.search(/Listing by:/i);
  const primaryText = value.slice(0, listingAt >= 0 ? listingAt : 4000);
  return /\boff[\s-]*market\b|\bnot (?:currently )?for sale\b|\bno longer (?:available|for sale|on the market)\b|\b(?:sold|closed)\s+(?:on|for)\b/i.test(primaryText);
}

async function getListings() {
  // Only future scheduled events are eligible for contact enrichment.
  const now = Date.now();
  const query =
    `/rest/v1/open_houses` +
    `?select=id,address,source,lat,lng,agent,agent_phone,agent_email,open_start,open_end,agent_scraped,agent_enriched` +
    `&source=eq.onekey` +
    `&open_start=gt.${encodeURIComponent(new Date(now).toISOString())}` +
    `&lat=not.is.null` +
    `&lng=not.is.null` +
    `&order=open_start.asc.nullslast` +
    `&limit=500`;

  const [rows, existingListingAgents] = await Promise.all([
    supabaseGet(query),
    supabaseGet(`/rest/v1/listing_agents?select=open_house_id`)
  ]);

  console.log(`Upcoming OneKey rows from Supabase: ${rows.length}`);

  const existingIds = new Set(
    (existingListingAgents || [])
      .map((x) => String(x.open_house_id || "").trim())
      .filter(Boolean)
  );

  const filtered = rows
    .map((row) => {
      if (!isUpcomingOpenHouse(row, now)) return null;
      const lat = Number(row.lat);
      const lng = Number(row.lng);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      const miles = distanceMiles(CENTER_LAT, CENTER_LNG, lat, lng);
      if (miles > RADIUS_MILES) return null;

      if (SKIP_AGENT_SCRAPED && row.agent_scraped === true) return null;
      if (SKIP_EXISTING_LISTING_AGENTS && existingIds.has(String(row.id))) return null;

      return {
        ...row,
        distance_miles: miles
      };
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.open_start) - Date.parse(b.open_start) || a.distance_miles - b.distance_miles)
    .slice(0, LIMIT);

  return filtered;
}

const auditDirectory = path.join(__dirname, 'logs');
acquireRunLock(auditDirectory);
const safeStore = createStore({
  get: supabaseGet,
  post: supabasePost,
  patch: supabasePatch,
  journal: fileJournal(auditDirectory)
});
async function saveListingAgents(openHouseId, parsed) {
  return safeStore.saveListingAgents(openHouseId, parsed);
}
async function patchOpenHouseSuccess(openHouseId, primaryAgent, parsed) {
  return safeStore.patchOpenHouseSuccess(openHouseId, primaryAgent, parsed);
}
async function markOpenHouseAttempted(openHouseId) {
  // A failed lookup is not proof that existing enrichment is invalid.
  console.log('No-data lookup recorded in run log; existing database flags preserved:', openHouseId);
  return null;
}

// =========================
// PAGE HELPERS
// =========================
async function dismissPopups(page) {
  const selectors = [
    'button[aria-label*="Close"]',
    'button[aria-label*="close"]',
    'button[data-testid*="close"]',
    'button[title*="Close"]'
  ];

  for (const selector of selectors) {
    try {
      const btn = await page.$(selector);
      if (btn) {
        await btn.click({ delay: 50 }).catch(() => {});
        await delay(300, 700);
      }
    } catch (_) {}
  }
}

async function getBodyText(page) {
  return page.evaluate(() => document.body.innerText || "");
}

async function handleVerificationIfPresent(page, context = "page") {
  const text = await getBodyText(page).catch(() => "");
  if (!isBlockedText(text)) return false;

  console.log(`🛑 Verification / block detected on ${context}.`);

  if (phoneApprovalGate.enabled) {
    console.log("📲 Waiting for one-time phone approval.");
    await phoneApprovalGate.requestAndSolve({
      page,
      context,
      isStillBlocked: async () => {
        const currentText = await getBodyText(page).catch(() => "");
        return isBlockedText(currentText);
      }
    });
    return true;
  }

  if (!MANUAL_VERIFY) {
    throw new Error("TRULIA_VERIFICATION_DETECTED");
  }

  console.log("Solve it manually in the browser window, then come back here.");
  await waitForEnter("Press ENTER after you complete the verification.");
  await delay(1500, 2500);

  const after = await getBodyText(page).catch(() => "");
  if (isBlockedText(after)) {
    throw new Error("TRULIA_VERIFICATION_STILL_PRESENT");
  }

  console.log("✅ Verification cleared. Continuing.");
  return true;
}

// =========================
// SAME TRULIA SEARCH FLOW AS YOUR OLD FILE
// =========================
async function searchTrulia(page, address) {
  const query = normalizeText(address);
  console.log(`🔎 Trulia search: ${query}`);

  await page.goto("https://www.trulia.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await delay(1500, 2500);
  await dismissPopups(page);
  await handleVerificationIfPresent(page, "Trulia home/search start");

  const inputSelectors = [
    'input[type="search"]',
    'input[placeholder*="Search"]',
    'input[aria-label*="Search"]',
    'input[name="search"]'
  ];

  let typed = false;

  for (const sel of inputSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 4000 });
      await page.click(sel, { clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.type(sel, query, { delay: 40 });
      typed = true;
      break;
    } catch (_) {}
  }

  if (!typed) {
    throw new Error("Could not find Trulia search input");
  }

  await delay(800, 1200);
  await page.keyboard.press("Enter");
  await page.waitForNavigation({
    waitUntil: "domcontentloaded",
    timeout: 25000
  }).catch(() => {});

  await delay(2500, 4000);
  await dismissPopups(page);
  await handleVerificationIfPresent(page, "Trulia search results");

  let text = await getBodyText(page);

  if (hasListingBlock(text)) {
    return { found: true, url: page.url(), text };
  }

  const propertyLinkSelectors = [
    'a[href*="/home/"]',
    'a[href*="/p/"]',
    'a[href*="/property/"]',
    'a[data-testid*="property"]'
  ];

  let clicked = false;

  for (const sel of propertyLinkSelectors) {
    try {
      const links = await page.$$(sel);
      if (links.length) {
        await links[0].click({ delay: 50 }).catch(() => {});
        clicked = true;
        break;
      }
    } catch (_) {}
  }

  if (!clicked) {
    return { found: false, url: page.url(), text: null };
  }

  await page.waitForNavigation({
    waitUntil: "domcontentloaded",
    timeout: 25000
  }).catch(() => {});

  await delay(2500, 4000);
  await dismissPopups(page);
  await handleVerificationIfPresent(page, "Trulia property page");

  text = await getBodyText(page);

  if (hasListingBlock(text)) {
    return { found: true, url: page.url(), text };
  }

  return { found: false, url: page.url(), text };
}

// =========================
// MAIN
// =========================
(async () => {
  let total = 0;
  let skipped = 0;
  let foundPage = 0;
  let parsedOk = 0;
  let savedRows = 0;
  let patchedRows = 0;
  let markedAttempts = 0;
  let failed = 0;

   const CONNECT_TO_EXISTING_CHROME =
  String(process.env.CONNECT_TO_EXISTING_CHROME || "false").toLowerCase() === "true";

const CHROME_DEBUG_URL = process.env.CHROME_DEBUG_URL || "http://127.0.0.1:9222";

let browser;
let connectedToExistingChrome = false;

if (CONNECT_TO_EXISTING_CHROME) {
  console.log(`🔌 Connecting to existing Chrome at ${CHROME_DEBUG_URL}`);
  browser = await puppeteer.connect({
    browserURL: CHROME_DEBUG_URL,
    defaultViewport: null
  });
  connectedToExistingChrome = true;
} else {
  browser = await puppeteer.launch({
    headless: HEADLESS,
    userDataDir: CHROME_USER_DATA_DIR,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
}

  try {
    const page = (await browser.pages())[0] || await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1440, height: 1100 });

    const listings = await getListings();

    console.log(`📦 Pulled ${listings.length} targeted open houses`);
    console.log(`📍 Center: ${CENTER_LAT}, ${CENTER_LNG}`);
    console.log(`📏 Radius: ${RADIUS_MILES} miles`);
    console.log(`🔁 Skip agent_scraped: ${SKIP_AGENT_SCRAPED}`);
    console.log(`🔁 Skip existing listing_agents: ${SKIP_EXISTING_LISTING_AGENTS}`);
    console.log(`🧍 Manual verification pause: ${MANUAL_VERIFY}`);
    console.log(`📲 Phone approval enabled: ${phoneApprovalGate.enabled}`);

    for (const row of listings) {
      total++;

      console.log("\n==============================");
      console.log(`🏠 ${row.id}`);
      console.log(`📍 ${row.address}`);
      console.log(`Scheduled open house: ${row.open_start} to ${row.open_end || "not supplied"}`);
      console.log(`📏 ${row.distance_miles.toFixed(2)} miles from center`);

      if (shouldSkipAddress(row.address)) {
        console.log("⏭️ Skipping hidden/undisclosed address");
        skipped++;
        continue;
      }

      try {
        const searchResult = await searchTrulia(page, row.address);

        if (!searchResult.found || !searchResult.text) {
          console.log("⚠️ No Trulia property page with listing block found");
          await markOpenHouseAttempted(row.id);
          markedAttempts++;
          await delay(2000, 3500);
          continue;
        }

        // Reject uncertain identity/status before saving contacts or marking attempts.
        if (!matchesTruliaAddress(row.address, searchResult.url)) {
          console.log('Skipping mismatched or unverifiable property URL:', searchResult.url);
          skipped++;
          continue;
        }
        if (isUnavailableProperty(searchResult.text)) {
          console.log('Skipping property explicitly marked unavailable:', searchResult.url);
          skipped++;
          continue;
        }

        foundPage++;
        console.log(`🔗 ${searchResult.url}`);

        const parsed = parseListingContacts(searchResult.text);

        if (!parsed?.agents?.length) {
          console.log("⚠️ Listing block found, but no phone-backed agents parsed");
          await markOpenHouseAttempted(row.id);
          markedAttempts++;
          await delay(2000, 3500);
          continue;
        }

        parsedOk++;
        console.log("🏢 Brokerage:", parsed.brokerage || "(none)");
        console.log("👥 Agents:", parsed.agents);

        const saved = await saveListingAgents(row.id, parsed);
        console.log(`Verified ${saved.length} listing-agent row(s); existing values preserved.`);
        savedRows += saved.length;

        if (!saved.length) {
          console.log('No verified agent saved; primary attribution and flags preserved.');
          continue;
        }
        const primary = saved[0];
        const patched = await patchOpenHouseSuccess(row.id, primary, parsed);
        if (!patched) {
          console.log('Existing primary agent preserved; attribution needs review.');
          continue;
        }
        console.log(`Verified open-house contact and enrichment flags for ${row.id}`);
        patchedRows++;
      } catch (err) {
        failed++;
        console.log("❌ ERROR:", err.message);

        if (String(err.message || "").startsWith("TRULIA_VERIFICATION_")) {
          process.exitCode = 42;
          console.log("🛑 Stopping run because Trulia verification is active.");
          break;
        }
      }

      await delay(2500, 5000);
    }

    console.log("\n========== FINAL SUMMARY ==========");
    console.log("Total rows processed:", total);
    console.log("Skipped:", skipped);
    console.log("Property pages found:", foundPage);
    console.log("Parsed with agents:", parsedOk);
    console.log("Rows saved/merged:", savedRows);
    console.log("Open houses patched:", patchedRows);
    console.log("No-data lookups (existing database flags preserved):", markedAttempts);
    console.log("Failed:", failed);
  } finally {
    if (connectedToExistingChrome) {
  console.log("🔌 Leaving existing Chrome open.");
  await browser.disconnect();
} else {
  await browser.close();
}
  }
})();
