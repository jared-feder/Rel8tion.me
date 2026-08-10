const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');

const PAUSE_KEY = 'outreach_send_paused';
const GUARDRAILS_KEY = 'outreach_guardrails';
const RELEASE_WINDOW_KEY = 'outreach_release_window';
const TIME_ZONE = 'America/New_York';
const CONFIRMATION = 'REL8TION';

const DEFAULT_GUARDRAILS = Object.freeze({
  max_per_run: 7,
  max_per_hour: 20,
  max_per_day: 150,
  duplicate_phone_cooldown_days: 30,
  missed_open_house_max_age_days: 7,
  health_window_days: 7,
  health_min_sends: 20,
  max_opt_out_rate: 0.01
});

const GUARDRAIL_RULES = Object.freeze({
  max_per_run: { min: 1, max: 7, integer: true },
  max_per_hour: { min: 1, max: 20, integer: true },
  max_per_day: { min: 1, max: 150, integer: true },
  duplicate_phone_cooldown_days: { min: 1, max: 365, integer: true },
  missed_open_house_max_age_days: { min: 1, max: 30, integer: true },
  health_window_days: { min: 1, max: 30, integer: true },
  health_min_sends: { min: 1, max: 1000, integer: true },
  max_opt_out_rate: { min: 0.001, max: 1, integer: false }
});

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

function truthySetting(value) {
  if (value === true) return true;
  if (value && typeof value === 'object') {
    return truthySetting(value.paused ?? value.enabled ?? value.value);
  }
  return ['1', 'true', 'yes', 'on', 'paused'].includes(String(value || '').trim().toLowerCase());
}

function cleanIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeGuardrails(value, fallback = DEFAULT_GUARDRAILS, strict = false) {
  const source = value && typeof value === 'object' ? value : {};
  const normalized = {};
  for (const [key, rule] of Object.entries(GUARDRAIL_RULES)) {
    const supplied = source[key];
    const parsed = Number(supplied);
    if (!Number.isFinite(parsed)) {
      if (strict) throw Object.assign(new Error(`Guardrail ${key} must be a number.`), { status: 400 });
      normalized[key] = fallback[key];
      continue;
    }
    const bounded = Math.max(rule.min, Math.min(parsed, rule.max));
    normalized[key] = rule.integer ? Math.floor(bounded) : Number(bounded.toFixed(4));
  }

  if (strict && normalized.max_per_run > normalized.max_per_hour) {
    throw Object.assign(new Error('Per-run limit cannot exceed the hourly limit.'), { status: 400 });
  }
  if (strict && normalized.max_per_hour > normalized.max_per_day) {
    throw Object.assign(new Error('Hourly limit cannot exceed the 24-hour limit.'), { status: 400 });
  }
  return normalized;
}

function isLooseningGuardrails(current, next) {
  return next.max_per_run > current.max_per_run
    || next.max_per_hour > current.max_per_hour
    || next.max_per_day > current.max_per_day
    || next.duplicate_phone_cooldown_days < current.duplicate_phone_cooldown_days
    || next.missed_open_house_max_age_days > current.missed_open_house_max_age_days
    || next.health_window_days < current.health_window_days
    || next.health_min_sends > current.health_min_sends
    || next.max_opt_out_rate > current.max_opt_out_rate;
}

function normalizeReleaseWindow(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    enabled: truthySetting(source.enabled ?? source.active),
    from_open_start: cleanIso(source.from_open_start),
    through_open_start: cleanIso(source.through_open_start),
    expires_at: cleanIso(source.expires_at),
    reason: String(source.reason || '').trim()
  };
}

function validateReleaseWindow(value) {
  const normalized = normalizeReleaseWindow(value);
  if (!normalized.enabled) return { ...normalized, enabled: false };
  if (!normalized.through_open_start || !normalized.expires_at) {
    throw Object.assign(new Error('An enabled override needs both a through date and an expiration.'), { status: 400 });
  }
  const now = Date.now();
  if (new Date(normalized.through_open_start).getTime() <= now || new Date(normalized.expires_at).getTime() <= now) {
    throw Object.assign(new Error('The release window and its expiration must be in the future.'), { status: 400 });
  }
  if (normalized.from_open_start && normalized.from_open_start >= normalized.through_open_start) {
    throw Object.assign(new Error('The release start must be earlier than the through date.'), { status: 400 });
  }
  return normalized;
}

async function readSetting(key) {
  const rows = await supabaseRest(`rel8tion_runtime_settings?key=eq.${encodeURIComponent(key)}&select=key,value,updated_at,updated_by&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

function assertCurrentVersion(row, expectedUpdatedAt) {
  const expected = String(expectedUpdatedAt || '').trim();
  if (!expected) return;
  if (String(row?.updated_at || '') !== expected) {
    throw Object.assign(new Error('This outreach setting changed in another session. Refresh COMMAND before saving.'), { status: 409 });
  }
}

async function writeSetting(key, value, updatedBy) {
  const rows = await supabaseRest('rel8tion_runtime_settings', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ key, value, updated_by: updatedBy || 'admin' })
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

function parseCount(response) {
  const header = String(response.headers?.get?.('content-range') || '');
  const match = header.match(/\/(\d+|\*)$/);
  return match && match[1] !== '*' ? Number(match[1]) : 0;
}

async function countRows(path) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/${path}`, {
    method: 'HEAD',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: 'count=exact',
      Range: '0-0'
    }
  });
  if (!response.ok) throw new Error(`Count query failed: ${response.status}`);
  return parseCount(response);
}

function timeZoneOffsetMinutes(date, timeZone = TIME_ZONE) {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit'
  }).formatToParts(date).find((item) => item.type === 'timeZoneName')?.value || 'GMT-5';
  const match = part.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
  if (!match) return -300;
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === '-' ? -minutes : minutes;
}

function easternWeekBounds(reference = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short'
  }).formatToParts(reference).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const mondayDelta = weekday === 0 ? -6 : 1 - weekday;
  const localMonday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + mondayDelta));
  const localNextMonday = new Date(localMonday.getTime() + 7 * 24 * 60 * 60 * 1000);
  const toEasternMidnight = (localDate) => {
    const nominalUtc = Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate());
    const offset = timeZoneOffsetMinutes(new Date(nominalUtc + 12 * 60 * 60 * 1000));
    return new Date(nominalUtc - offset * 60 * 1000).toISOString();
  };
  return { start: toEasternMidnight(localMonday), end: toEasternMidnight(localNextMonday) };
}

async function senderDiagnostic() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/send-agent-outreach`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ dry_run: true, limit: 1 })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Sender diagnostic failed: ${response.status}`);
  }
  return payload;
}

async function loadStats() {
  const now = new Date();
  const nowIso = now.toISOString();
  const week = easternWeekBounds(now);
  const readyFilter = `select=id&send_mode=eq.automatic&generation_status=eq.generated&mockup_status=eq.rendered&listing_photo_url=not.is.null&open_start=gt.${encodeURIComponent(nowIso)}&initial_send_status=eq.pending&initial_send_at=lte.${encodeURIComponent(nowIso)}`;
  const [queueTotal, queuePending, queueReady, queueManual, queueBlocked, weekOpenHouses, weekEnrichedOpenHouses] = await Promise.all([
    countRows('agent_outreach_queue?select=id'),
    countRows('agent_outreach_queue?select=id&initial_sent_at=is.null&initial_send_status=eq.pending'),
    countRows(`agent_outreach_queue?${readyFilter}`),
    countRows('agent_outreach_queue?select=id&send_mode=neq.automatic&initial_sent_at=is.null&initial_send_status=eq.pending'),
    countRows('agent_outreach_queue?select=id&initial_send_status=in.(blocked,failed)'),
    countRows(`open_houses?select=id&open_start=gte.${encodeURIComponent(week.start)}&open_start=lt.${encodeURIComponent(week.end)}`),
    countRows(`open_houses?select=id&agent_enriched=eq.true&open_start=gte.${encodeURIComponent(week.start)}&open_start=lt.${encodeURIComponent(week.end)}`)
  ]);
  return {
    queue_total: queueTotal,
    queue_pending: queuePending,
    queue_automatic_due: queueReady,
    queue_manual_hold: queueManual,
    queue_blocked_or_failed: queueBlocked,
    week_open_houses: weekOpenHouses,
    week_enriched_open_houses: weekEnrichedOpenHouses,
    week_start: week.start,
    week_end: week.end
  };
}

async function loadControl() {
  const warnings = [];
  const [pauseResult, guardrailResult, releaseResult, statsResult, diagnosticResult] = await Promise.allSettled([
    readSetting(PAUSE_KEY),
    readSetting(GUARDRAILS_KEY),
    readSetting(RELEASE_WINDOW_KEY),
    loadStats(),
    senderDiagnostic()
  ]);

  for (const [label, result] of [
    ['pause setting', pauseResult],
    ['guardrail setting', guardrailResult],
    ['release window', releaseResult],
    ['outreach stats', statsResult],
    ['sender diagnostic', diagnosticResult]
  ]) {
    if (result.status === 'rejected') warnings.push(`${label}: ${result.reason?.message || result.reason}`);
  }

  const pauseRow = pauseResult.status === 'fulfilled' ? pauseResult.value : null;
  const guardrailRow = guardrailResult.status === 'fulfilled' ? guardrailResult.value : null;
  const releaseRow = releaseResult.status === 'fulfilled' ? releaseResult.value : null;
  const diagnostic = diagnosticResult.status === 'fulfilled' ? diagnosticResult.value : {};
  const diagnosticGuardrails = normalizeGuardrails({
    max_per_run: diagnostic.max_per_run,
    max_per_hour: diagnostic.max_per_hour,
    max_per_day: diagnostic.max_per_day,
    duplicate_phone_cooldown_days: diagnostic.duplicate_phone_cooldown_days,
    missed_open_house_max_age_days: diagnostic.missed_open_house_max_age_days,
    health_window_days: diagnostic.health_window_days,
    health_min_sends: diagnostic.health_min_sends,
    max_opt_out_rate: diagnostic.max_opt_out_rate
  });
  const guardrails = normalizeGuardrails(guardrailRow?.value, diagnosticGuardrails);

  return {
    paused: diagnostic.paused === true || truthySetting(pauseRow?.value),
    pause_setting: {
      value: pauseRow?.value || null,
      updated_at: pauseRow?.updated_at || null,
      updated_by: pauseRow?.updated_by || null
    },
    guardrails: {
      value: guardrails,
      source: guardrailRow ? 'runtime' : diagnosticResult.status === 'fulfilled' ? 'sender_environment' : 'code_defaults',
      updated_at: guardrailRow?.updated_at || null,
      updated_by: guardrailRow?.updated_by || null,
      hard_caps: {
        max_per_run: GUARDRAIL_RULES.max_per_run.max,
        max_per_hour: GUARDRAIL_RULES.max_per_hour.max,
        max_per_day: GUARDRAIL_RULES.max_per_day.max
      }
    },
    release_window: {
      value: normalizeReleaseWindow(releaseRow?.value),
      active: diagnostic.outreach_release_window?.active === true,
      updated_at: releaseRow?.updated_at || null,
      updated_by: releaseRow?.updated_by || null
    },
    sender: {
      health_blocked: diagnostic.health_blocked === true,
      health_gate_override: diagnostic.health_gate_override === true,
      health_outreach_sends: Number(diagnostic.health_outreach_sends || 0),
      health_opt_outs: Number(diagnostic.health_opt_outs || 0),
      health_opt_out_rate: Number(diagnostic.health_opt_out_rate || 0),
      recent_outreach_sends_1h: Number(diagnostic.recent_outreach_sends_1h || 0),
      recent_outreach_sends_24h: Number(diagnostic.recent_outreach_sends_24h || 0),
      hourly_remaining: Number(diagnostic.hourly_remaining ?? guardrails.max_per_hour),
      daily_remaining: Number(diagnostic.daily_remaining ?? guardrails.max_per_day),
      candidate_rows: Number(diagnostic.candidate_rows || 0),
      operator_mode: diagnostic.outreach_operator_mode || 'live'
    },
    stats: statsResult.status === 'fulfilled' ? statsResult.value : {},
    locked_protections: [
      'STOP and opt-out suppression',
      'valid mobile phone requirement',
      '8:00 AM-9:00 PM Eastern quiet hours',
      'future open-house requirement',
      'generated copy, rendered image, and listing-photo readiness',
      'terminal delivery and duplicate-recipient checks'
    ],
    warnings,
    loaded_at: new Date().toISOString()
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    assertAdminConfig();
    const auth = adminAuthorized(req);
    if (!auth.ok) {
      sendJson(res, 401, { ok: false, error: auth.error });
      return;
    }

    if (req.method === 'GET') {
      sendJson(res, 200, { ok: true, ...(await loadControl()) });
      return;
    }

    const body = parseBody(req);
    const action = String(body.action || '').trim();
    const updatedBy = auth.uid || auth.method || 'admin';

    if (action === 'set_pause') {
      const current = await readSetting(PAUSE_KEY);
      assertCurrentVersion(current, body.expected_updated_at);
      const paused = body.paused === true;
      await writeSetting(PAUSE_KEY, {
        paused,
        reason: String(body.reason || (paused ? 'paused_from_command' : 'resumed_from_command')).trim(),
        changed_at: new Date().toISOString()
      }, updatedBy);
    } else if (action === 'update_guardrails') {
      const current = await readSetting(GUARDRAILS_KEY);
      assertCurrentVersion(current, body.expected_updated_at);
      const previous = normalizeGuardrails(current?.value, DEFAULT_GUARDRAILS);
      const next = normalizeGuardrails(body.guardrails, previous, true);
      if (isLooseningGuardrails(previous, next) && String(body.confirmation || '').trim() !== CONFIRMATION) {
        throw Object.assign(new Error('Type REL8TION to confirm a less restrictive outreach configuration.'), { status: 400 });
      }
      await writeSetting(GUARDRAILS_KEY, next, updatedBy);
    } else if (action === 'update_release_window') {
      const current = await readSetting(RELEASE_WINDOW_KEY);
      assertCurrentVersion(current, body.expected_updated_at);
      const next = validateReleaseWindow(body.release_window);
      if (next.enabled && String(body.confirmation || '').trim() !== CONFIRMATION) {
        throw Object.assign(new Error('Type REL8TION to enable a health-gate override window.'), { status: 400 });
      }
      await writeSetting(RELEASE_WINDOW_KEY, next, updatedBy);
    } else {
      throw Object.assign(new Error('Unknown outreach control action.'), { status: 400 });
    }

    sendJson(res, 200, { ok: true, ...(await loadControl()) });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to update outreach controls.',
      details: error.payload || null
    });
  }
};

module.exports.__test = {
  DEFAULT_GUARDRAILS,
  easternWeekBounds,
  isLooseningGuardrails,
  normalizeGuardrails,
  normalizeReleaseWindow,
  validateReleaseWindow
};
