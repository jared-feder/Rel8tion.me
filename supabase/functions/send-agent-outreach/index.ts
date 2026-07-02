import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendSMS } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUSINESS_CARD_URL =
  Deno.env.get("NMB_BUSINESS_CARD_URL") ||
  "https://nicanqrfqlbnlmnoernb.supabase.co/storage/v1/object/public/outreach-mockups/mynmb.jpg";
const PUBLIC_APP_BASE_URL =
  (Deno.env.get("REL8TION_PUBLIC_BASE_URL") || Deno.env.get("PUBLIC_APP_URL") || "https://app.rel8tion.me")
    .replace(/\/$/, "");
const DEFAULT_SEND_MAX_PER_RUN = 7;
const SEND_MAX_PER_RUN_HARD_CAP = 7;
const DEFAULT_SEND_MAX_PER_HOUR = 20;
const DEFAULT_SEND_MAX_PER_DAY = 150;
const FOLLOWUPS_DISABLED = true;

type OutreachRow = {
  id?: string | null;
  outreach_code?: string | null;
  open_house_id?: string | null;
  agent_first_name?: string | null;
  agent_name?: string | null;
  agent_phone?: string | null;
  agent_phone_normalized?: string | null;
  brokerage?: string | null;
  address?: string | null;
  listing_photo_url?: string | null;
  mockup_image_url?: string | null;
  open_start?: string | null;
  open_end?: string | null;
  selected_sms?: string | null;
  followup_sms?: string | null;
  review_status?: string | null;
  template_key?: string | null;
};

type OutreachOperatorMode = "live" | "away";

function normalizePhone(phone: string | null): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

function toE164(phone: string | null): string {
  const digits = normalizePhone(phone);
  if (!digits) return "";
  return digits.startsWith("1") ? `+${digits}` : `+1${digits}`;
}

function firstNameSafe(name: string | null): string {
  if (!name?.trim()) return "there";
  const first = name.trim().split(/\s+/)[0].replace(/[:;,]+$/, "");
  if (/^(agent|listing|unknown|phone)$/i.test(first)) return "there";
  return first;
}

function shortAddress(address: string | null): string {
  if (!address?.trim()) return "your open house";
  const withoutStateZip = address.replace(/,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$/i, "").trim();
  const parts = withoutStateZip.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[0] : withoutStateZip;
}

function formatOpenHouse(openStart: string | null): string {
  if (!openStart) return "this weekend";

  try {
    const dt = new Date(openStart);

    const day = dt.toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "America/New_York",
    });

    const time = dt.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    }).replace(":00", "");

    return `${day} at ${time}`;
  } catch {
    return "this weekend";
  }
}

function buildSmsLink(phone: string | null, body: string): string {
  const clean = normalizePhone(phone);
  return `sms:${clean}?body=${encodeURIComponent(body)}`;
}

function usesAndroidGateway(): boolean {
  const outreachProvider = String(Deno.env.get("SMS_OUTREACH_PROVIDER") || "").trim().toLowerCase();
  if (outreachProvider) return outreachProvider === "android_gateway";
  return String(Deno.env.get("SMS_PROVIDER") || "").trim().toLowerCase() === "android_gateway";
}

function twilioOutreachBrokeragePatterns(): string[] {
  return String(Deno.env.get("SMS_TWILIO_OUTREACH_BROKERAGES") || "douglas elliman")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function outreachProviderOverrideForRow(row: OutreachRow): "twilio" | null {
  const brokerage = String(row.brokerage || "").toLowerCase();
  if (!brokerage) return null;
  return twilioOutreachBrokeragePatterns().some((pattern) => brokerage.includes(pattern))
    ? "twilio"
    : null;
}

function normalizeOperatorMode(value: unknown, fallback: OutreachOperatorMode = "live"): OutreachOperatorMode {
  return String(value || "").trim().toLowerCase() === "away" ? "away" : fallback;
}

function truthySetting(value: unknown): boolean {
  if (value === true) return true;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return truthySetting(record.paused ?? record.enabled ?? record.value);
  }
  return ["1", "true", "yes", "on", "paused"].includes(String(value || "").trim().toLowerCase());
}

async function loadOutreachOperatorMode(supabase: any): Promise<OutreachOperatorMode> {
  const fallback = normalizeOperatorMode(Deno.env.get("OUTREACH_OPERATOR_MODE"), "live");
  try {
    const { data, error } = await supabase
      .from("rel8tion_runtime_settings")
      .select("value")
      .eq("key", "outreach_operator_mode")
      .maybeSingle();

    if (error) {
      console.warn("[send-agent-outreach] outreach operator mode lookup failed", error.message || error);
      return fallback;
    }

    return normalizeOperatorMode(data?.value?.mode || data?.value, fallback);
  } catch (error) {
    console.warn("[send-agent-outreach] outreach operator mode lookup failed", error);
    return fallback;
  }
}

async function loadOutreachSendPaused(supabase: any): Promise<boolean> {
  if (truthySetting(Deno.env.get("OUTREACH_SEND_PAUSED"))) return true;
  try {
    const { data, error } = await supabase
      .from("rel8tion_runtime_settings")
      .select("value")
      .eq("key", "outreach_send_paused")
      .maybeSingle();

    if (error) {
      console.warn("[send-agent-outreach] outreach send pause lookup failed", error.message || error);
      return false;
    }

    return truthySetting(data?.value);
  } catch (error) {
    console.warn("[send-agent-outreach] outreach send pause lookup failed", error);
    return false;
  }
}

function positiveIntEnv(name: string, fallback: number, max: number): number {
  const parsed = Number(Deno.env.get(name) || "");
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), max));
}

async function recentOutreachSendCount(supabase: any, sinceIso: string): Promise<number> {
  const { count, error } = await supabase
    .from("sms_message_log")
    .select("id", { count: "exact", head: true })
    .gte("created_at", sinceIso)
    .in("status", ["sent", "queued"])
    .or("route.eq.outreach,category.eq.outreach,category.eq.outreach_followup,category.eq.manual_outreach");

  if (error) throw error;
  return count || 0;
}

function buildOutreachPreviewUrl(
  selectedProvider: string,
  rowId?: string | null,
  outreachCode?: string | null,
  mockupImageUrl?: string | null,
): string {
  if (selectedProvider !== "android_gateway") return "";
  const token = outreachCode || rowId;
  if (!token || !mockupImageUrl) return "";
  return `${PUBLIC_APP_BASE_URL}/o/${encodeURIComponent(token)}`;
}

function addPreviewLinkBeforeStop(message: string, previewUrl: string): string {
  const cleanMessage = String(message || "").trim();
  const cleanPreviewUrl = String(previewUrl || "").trim();
  if (!cleanMessage || !cleanPreviewUrl || cleanMessage.includes(cleanPreviewUrl)) return cleanMessage;

  const stopPattern = /(?:\s*\n*)?Reply STOP to opt out\.?\s*$/i;
  if (stopPattern.test(cleanMessage)) {
    return `${cleanMessage.replace(stopPattern, "").trim()}\n\n${cleanPreviewUrl}\n\nReply STOP to opt out.`;
  }

  return `${cleanMessage}\n\n${cleanPreviewUrl}`;
}

function shouldRebuildRel8tionCopy(row: OutreachRow): boolean {
  if (row.template_key === "future_open_house" || row.template_key === "missed_open_house") return true;

  const storedCopy = `${row.selected_sms || ""} ${row.followup_sms || ""}`.toLowerCase();
  return (
    storedCopy.includes("custom check-in sign") ||
    storedCopy.includes("rel8tion beta") ||
    storedCopy.includes("sponsored beta setup") ||
    storedCopy.includes("paperless check-in")
  );
}

function buildInitialOutreachBody(row: OutreachRow): string {
  if (!shouldRebuildRel8tionCopy(row)) return row.selected_sms || "";

  const firstName = firstNameSafe(row.agent_first_name || row.agent_name || null);
  const addr = shortAddress(row.address || null);

  if (row.template_key === "missed_open_house") {
    return (
      `Hey ${firstName} 👋 Sorry I missed your open house at ${addr}. ` +
      `I’d still love to support your next one with quick pre-approval help and sponsor a Rel8tion Event Pass — paperless check-in, e-sign disclosures, and lead capture with no app needed. Reply STOP to opt out.`
    );
  }

  const when = formatOpenHouse(row.open_start || null);
  return (
    `Hey ${firstName} 👋 I’d love to stop by your open house at ${addr} ${when} to provide quick pre-approval support.\n\n` +
    `I’m also sponsoring a Rel8tion Event Pass for you — paperless check-in, e-sign disclosures, and lead capture with no app needed.\n\n` +
    `Looking forward to meeting you. Reply STOP to opt out.`
  );
}

function buildFollowupOutreachBody(row: OutreachRow): string | null {
  if (row.review_status === "drip_scheduled") return row.followup_sms || null;
  if (row.template_key === "missed_open_house") return row.followup_sms || null;
  if (!shouldRebuildRel8tionCopy(row)) return row.followup_sms || null;

  const firstName = firstNameSafe(row.agent_first_name || row.agent_name || null);
  const addr = shortAddress(row.address || null);
  const when = formatOpenHouse(row.open_start || null);

  return (
    `Hey ${firstName} 👋 Just circling back before your open house at ${addr} ${when}. ` +
    `I’d still love to stop by with quick pre-approval support and sponsor a Rel8tion Event Pass for paperless check-in, e-sign disclosures, and lead capture. Reply STOP to opt out.`
  );
}

function isWithinAllowedSendWindow(): boolean {
  const now = new Date();

  const nyHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );

  const nyMinute = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      minute: "numeric",
    }).format(now),
  );

  const minutes = nyHour * 60 + nyMinute;
  const start = 8 * 60;
  const endExclusive = 21 * 60;

  return minutes >= start && minutes < endExclusive;
}

function isBlockedReviewStatus(reviewStatus: string | null): boolean {
  return reviewStatus === "opted_out" || reviewStatus === "android_opted_out";
}

function getTerminalSmsBlock(
  message: string,
  provider: string,
): { status: string; reason: string; reviewStatus?: string } | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("sms_suppressed") || normalized.includes("suppression list")) {
    return {
      status: "blocked_opted_out",
      reason: "sms_suppressed",
      reviewStatus: provider === "android_gateway" ? "android_opted_out" : "opted_out",
    };
  }

  if (
    normalized.includes("not a mobile number") ||
    normalized.includes("not mobile phone number") ||
    normalized.includes("not a mobile phone")
  ) {
    return { status: "blocked_invalid_mobile", reason: "twilio_not_mobile" };
  }

  if (normalized.includes("unsubscribed recipient") || normalized.includes("21610")) {
    return { status: "blocked_opted_out", reason: "twilio_unsubscribed", reviewStatus: "opted_out" };
  }

  return null;
}

function buildStatusCallbackUrl(supabaseUrl: string, queueId: string, step: "initial" | "followup"): string {
  const override = Deno.env.get("TWILIO_STATUS_CALLBACK_URL");
  const token = Deno.env.get("TWILIO_STATUS_CALLBACK_TOKEN") || "";
  const base = override || `${supabaseUrl.replace(/\/$/, "")}/functions/v1/twilio-message-status`;
  const url = new URL(base);
  url.searchParams.set("queue_id", queueId);
  url.searchParams.set("step", step);
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

async function recordOutboundReply(
  supabase: any,
  row: Record<string, any>,
  body: string,
  smsRes: Record<string, any>,
  step: "initial" | "followup",
  sentAt: string,
) {
  const messageSid = smsRes.externalId || smsRes.sid || `auto-${step}-${row.id}-${sentAt}`;

  const { data: existing, error: lookupError } = await supabase
    .from("agent_outreach_replies")
    .select("id")
    .eq("message_sid", messageSid)
    .limit(1);

  if (lookupError) throw lookupError;
  if (existing?.length) return;

  const fromPhone = smsRes.from || smsRes.deviceId || smsRes.provider || "android_gateway";

  const { error: insertError } = await supabase
    .from("agent_outreach_replies")
    .insert({
      queue_row_id: row.id,
      open_house_id: row.open_house_id || null,
      from_phone: fromPhone,
      from_phone_normalized: normalizePhone(String(smsRes.from || "")),
      to_phone: toE164(row.agent_phone || row.agent_phone_normalized || ""),
      body,
      message_sid: messageSid,
      account_sid: smsRes.provider || "sms",
      direction: "outbound",
      opt_out: false,
      raw_payload: {
        provider: smsRes.provider || null,
        route: smsRes.route || null,
        status: smsRes.status || null,
        device_id: smsRes.deviceId || null,
        raw: smsRes.raw || null,
        source: "send-agent-outreach",
        step,
      },
      received_at: sentAt,
    });

  if (insertError) throw insertError;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "Missing required secrets: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      );
    }

    const maxPerRun = positiveIntEnv("OUTREACH_SEND_MAX_PER_RUN", DEFAULT_SEND_MAX_PER_RUN, SEND_MAX_PER_RUN_HARD_CAP);
    const maxPerHour = positiveIntEnv("OUTREACH_SEND_MAX_PER_HOUR", DEFAULT_SEND_MAX_PER_HOUR, 200);
    const maxPerDay = positiveIntEnv("OUTREACH_SEND_MAX_PER_DAY", DEFAULT_SEND_MAX_PER_DAY, 150);

    if (!isWithinAllowedSendWindow()) {
      return new Response(
        JSON.stringify(
          {
            ok: true,
            processed: 0,
            quiet_hours: true,
            timezone: "America/New_York",
            max_per_run: maxPerRun,
            max_per_hour: maxPerHour,
            max_per_day: maxPerDay,
            message: "Current time is outside allowed send window (8:00 AM-9:00 PM ET). No messages sent.",
          },
          null,
          2,
        ),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const outreachSendPaused = await loadOutreachSendPaused(supabase);
    const outreachOperatorMode = await loadOutreachOperatorMode(supabase);
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true || body.mode === "dry_run" || body.mode === "diagnostic_no_send";
    const requestedLimit = Number(body.limit ?? maxPerRun);
    const normalizedRequestedLimit = Math.max(
      0,
      Math.min(Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : maxPerRun, 50),
    );
    const hourlyWindowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const dailyWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentHourlySendCount = await recentOutreachSendCount(supabase, hourlyWindowStart);
    const recentDailySendCount = await recentOutreachSendCount(supabase, dailyWindowStart);
    const hourlyRemaining = Math.max(0, maxPerHour - recentHourlySendCount);
    const dailyRemaining = Math.max(0, maxPerDay - recentDailySendCount);
    const limit = dryRun
      ? Math.min(normalizedRequestedLimit, maxPerRun)
      : Math.min(normalizedRequestedLimit, maxPerRun, hourlyRemaining, dailyRemaining);
    const inspectionLimit = dryRun ? Math.max(1, limit || 25) : limit;
    const fetchLimit = Math.min(Math.max(inspectionLimit * 200, 250), 1000);
    const now = new Date();
    const nowIso = now.toISOString();

    if (outreachSendPaused) {
      return new Response(
        JSON.stringify(
          {
            ok: true,
            processed: 0,
            dry_run: dryRun,
            paused: true,
            requested_limit: normalizedRequestedLimit,
            effective_limit: 0,
            max_per_run: maxPerRun,
            max_per_hour: maxPerHour,
            max_per_day: maxPerDay,
            outreach_operator_mode: outreachOperatorMode,
            message: "Outbound outreach sending is paused. No messages sent this run.",
            results: [],
          },
          null,
          2,
        ),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!dryRun && limit <= 0) {
      return new Response(
        JSON.stringify(
          {
            ok: true,
            processed: 0,
            dry_run: false,
            throttled: true,
            requested_limit: normalizedRequestedLimit,
            effective_limit: limit,
            max_per_run: maxPerRun,
            max_per_hour: maxPerHour,
            max_per_day: maxPerDay,
            recent_outreach_sends_1h: recentHourlySendCount,
            recent_outreach_sends_24h: recentDailySendCount,
            hourly_remaining: hourlyRemaining,
            daily_remaining: dailyRemaining,
            outreach_operator_mode: outreachOperatorMode,
            message: "Outreach send throttle is active. No messages sent this run.",
            results: [],
          },
          null,
          2,
        ),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let query = supabase
      .from("agent_outreach_queue")
      .select(`
        id,
        outreach_code,
        open_house_id,
        agent_first_name,
        agent_name,
        agent_phone,
        agent_phone_normalized,
        brokerage,
        address,
        selected_sms,
        followup_sms,
        listing_photo_url,
        mockup_image_url,
        open_start,
        open_end,
        initial_send_at,
        followup_send_at,
        initial_send_status,
        followup_send_status,
        initial_sent_at,
        approved_for_send,
        send_mode,
        generation_status,
        review_status,
        mockup_status,
        template_key
      `)
      .eq("send_mode", "automatic")
      .eq("generation_status", "generated")
      .eq("mockup_status", "rendered")
      .not("listing_photo_url", "is", null)
      .or(FOLLOWUPS_DISABLED
        ? `and(initial_send_status.eq.pending,initial_send_at.lte.${nowIso})`
        : `and(initial_send_status.eq.pending,initial_send_at.lte.${nowIso}),and(followup_send_status.eq.pending,followup_send_at.lte.${nowIso})`)
      .order("initial_send_at", { ascending: true, nullsFirst: false })
      .order("followup_send_at", { ascending: true, nullsFirst: false })
      .limit(fetchLimit);

    if (usesAndroidGateway()) {
      query = query.neq("review_status", "android_opted_out");
    }

    const { data: rows, error } = await query;

    if (error) throw error;

    const results: Array<Record<string, unknown>> = [];
    let sendAttempts = 0;

    for (const row of rows || []) {
      if (!dryRun && sendAttempts >= limit) break;
      if (dryRun && results.length >= inspectionLimit) break;

      let attemptedStep: "initial" | "followup" | null = null;
      let attemptedProvider: string | null = null;

      try {
        const phoneNormalized = row.agent_phone_normalized || normalizePhone(row.agent_phone);
        const to = toE164(row.agent_phone);

        if (!phoneNormalized || !to) {
          await supabase
            .from("agent_outreach_queue")
            .update({
              send_error: "Missing or invalid phone",
              initial_block_reason: "missing_phone",
              followup_block_reason: "missing_phone",
            })
            .eq("id", row.id);

          results.push({
            id: row.id,
            agent_name: row.agent_name,
            ok: false,
            error: "Missing or invalid phone",
          });
          continue;
        }

        const openStart = row.open_start ? new Date(row.open_start) : null;
        const openEnd = row.open_end ? new Date(row.open_end) : null;

        const isMissedOpenHouseCampaign = row.template_key === "missed_open_house";
        const isAdminScheduledDrip = row.review_status === "drip_scheduled";
        const initialStale = !isMissedOpenHouseCampaign && !!openEnd && openEnd <= now;
        const followupStale = !FOLLOWUPS_DISABLED && !isAdminScheduledDrip && !!openStart && openStart <= now;

        if (dryRun && (initialStale || followupStale)) {
          results.push({
            id: row.id,
            agent_name: row.agent_name,
            step: initialStale ? "initial" : "followup",
            ok: true,
            dry_run: true,
            would_skip: true,
            reason: initialStale ? "Open house already ended" : "Open house already started",
          });
          continue;
        }

        if (row.initial_send_status === "pending" && initialStale) {
          await supabase
            .from("agent_outreach_queue")
            .update({
              initial_send_status: "skipped_expired",
              initial_block_reason: "open_house_ended",
              send_error: null,
            })
            .eq("id", row.id);

          results.push({
            id: row.id,
            agent_name: row.agent_name,
            step: "initial",
            ok: true,
            skipped: true,
            reason: "Open house already ended",
          });
          continue;
        }

        if (row.followup_send_status === "pending" && followupStale) {
          await supabase
            .from("agent_outreach_queue")
            .update({
              followup_send_status: "skipped_started",
              followup_block_reason: "open_house_started",
              send_error: null,
            })
            .eq("id", row.id);

          results.push({
            id: row.id,
            agent_name: row.agent_name,
            step: "followup",
            ok: true,
            skipped: true,
            reason: "Open house already started",
          });
          continue;
        }

        const initialDue =
          row.initial_send_status === "pending" &&
          row.initial_send_at &&
          row.initial_send_at <= nowIso &&
          row.selected_sms &&
          (isMissedOpenHouseCampaign || !openEnd || openEnd > now);

        const followupDue =
          !FOLLOWUPS_DISABLED &&
          row.followup_send_status === "pending" &&
          row.followup_send_at &&
          row.followup_send_at <= nowIso &&
          row.followup_sms &&
          row.initial_send_status === "sent" &&
          row.initial_sent_at &&
          (isAdminScheduledDrip || !openStart || openStart > now);

        if (!initialDue && !followupDue) {
          continue;
        }

        const twilioBrokerageOverride = outreachProviderOverrideForRow(row) === "twilio";
        const selectedProvider = twilioBrokerageOverride
          ? "twilio"
          : outreachOperatorMode === "away"
            ? "android_gateway"
            : "manual";
        const providerOverride = selectedProvider === "manual"
          ? null
          : selectedProvider as "twilio" | "android_gateway";
        attemptedProvider = selectedProvider;
        const previewUrl = buildOutreachPreviewUrl(selectedProvider, row.id, row.outreach_code, row.mockup_image_url);
        const initialBody = initialDue
          ? addPreviewLinkBeforeStop(buildInitialOutreachBody(row), previewUrl)
          : "";
        const followupBody = followupDue
          ? addPreviewLinkBeforeStop(buildFollowupOutreachBody(row) || "", previewUrl)
          : null;
        const storedFollowupBody = FOLLOWUPS_DISABLED
          ? null
          : addPreviewLinkBeforeStop(buildFollowupOutreachBody(row) || "", previewUrl) || null;

        if (dryRun) {
          results.push({
            id: row.id,
            agent_name: row.agent_name,
            step: initialDue ? "initial" : followupDue ? "followup" : null,
            ok: true,
            dry_run: true,
            would_send: initialDue || followupDue,
            initial_send_status: row.initial_send_status,
            followup_send_status: row.followup_send_status,
            initial_send_at: row.initial_send_at,
            followup_send_at: row.followup_send_at,
            open_start: row.open_start,
            open_end: row.open_end,
            review_status: row.review_status,
            brokerage: row.brokerage || null,
            provider: selectedProvider,
            provider_override: providerOverride,
            outreach_operator_mode: outreachOperatorMode,
            manual_ready: selectedProvider === "manual",
            preview_url: previewUrl || null,
            message_preview: (initialDue ? initialBody : followupBody || "").slice(0, 360),
          });
          continue;
        }

        if (selectedProvider === "manual") {
          if (row.review_status !== "manual_ready") {
            await supabase
              .from("agent_outreach_queue")
              .update({
                review_status: "manual_ready",
                send_error: null,
              })
              .eq("id", row.id);
          }

          results.push({
            id: row.id,
            agent_name: row.agent_name,
            step: initialDue ? "initial" : followupDue ? "followup" : null,
            ok: true,
            skipped: true,
            manual_ready: true,
            reason: "Operator is live; non-Douglas Elliman outreach is waiting for manual send.",
            outreach_operator_mode: outreachOperatorMode,
            provider: "manual",
          });
          continue;
        }

        if (isBlockedReviewStatus(row.review_status)) {
          await supabase
            .from("agent_outreach_queue")
            .update({
              initial_send_status: initialDue ? "blocked_opted_out" : row.initial_send_status,
              followup_send_status: followupDue ? "blocked_opted_out" : row.followup_send_status,
              initial_block_reason: initialDue ? "contact_opted_out" : row.initial_block_reason,
              followup_block_reason: followupDue ? "contact_opted_out" : row.followup_block_reason,
              send_error: null,
            })
            .eq("id", row.id);

          results.push({
            id: row.id,
            agent_name: row.agent_name,
            ok: true,
            skipped: true,
            reason: "Contact opted out",
          });
          continue;
        }

        if (initialDue) {
          sendAttempts += 1;
          attemptedStep = "initial";
          const smsRes = await sendSMS({
            supabase,
            to,
            body: initialBody,
            category: row.template_key === "missed_open_house" ? "outreach_followup" : "outreach",
            providerOverride: providerOverride || undefined,
            mediaUrls: [row.mockup_image_url, BUSINESS_CARD_URL].filter(Boolean),
            statusCallback: buildStatusCallbackUrl(supabaseUrl, row.id, "initial"),
            metadata: {
              queue_row_id: row.id,
              open_house_id: row.open_house_id || null,
              brokerage: row.brokerage || null,
              step: "initial",
              template_key: row.template_key || null,
              provider_override: providerOverride,
              outreach_operator_mode: outreachOperatorMode,
              mockup_image_url: row.mockup_image_url || null,
              outreach_preview_url: previewUrl || null,
            },
          });

          const sentAt = new Date().toISOString();
          const initialDeliveryStatus = String(smsRes.status || "queued").toLowerCase();
          await recordOutboundReply(supabase, row, initialBody, smsRes, "initial", sentAt).catch((error) => {
            console.error("[send-agent-outreach] outbound reply mirror failed", error);
          });

          const { error: updateError } = await supabase
            .from("agent_outreach_queue")
            .update({
              selected_sms: initialBody,
              sms_variant_1: initialBody,
              sms_link: buildSmsLink(row.agent_phone, initialBody),
              followup_sms: storedFollowupBody,
              followup_sms_link: null,
              followup_send_status: "not_scheduled",
              followup_send_at: null,
              followup_block_reason: "followups_disabled",
              initial_send_status: "sent",
              initial_sent_at: sentAt,
              twilio_sid_initial: smsRes.externalId || smsRes.sid || null,
              initial_delivery_status: initialDeliveryStatus,
              initial_delivery_status_updated_at: sentAt,
              initial_delivery_error_code: null,
              initial_delivery_error_message: null,
              last_delivery_status: initialDeliveryStatus,
              last_delivery_status_updated_at: sentAt,
              last_delivery_error_code: null,
              last_delivery_error_message: null,
              last_outreach_at: sentAt,
              initial_block_reason: null,
              send_error: null,
            })
            .eq("id", row.id);

          if (updateError) throw updateError;

          results.push({
            id: row.id,
            agent_name: row.agent_name,
            step: "initial",
            ok: true,
            sid: smsRes.externalId || smsRes.sid || null,
            provider: smsRes.provider,
            preview_url: previewUrl || null,
          });

          continue;
        }

        if (followupDue) {
          sendAttempts += 1;
          attemptedStep = "followup";
          const smsRes = await sendSMS({
            supabase,
            to,
            body: followupBody || row.followup_sms || "",
            category: "outreach_followup",
            providerOverride: providerOverride || undefined,
            mediaUrls: [row.mockup_image_url, BUSINESS_CARD_URL].filter(Boolean),
            statusCallback: buildStatusCallbackUrl(supabaseUrl, row.id, "followup"),
            metadata: {
              queue_row_id: row.id,
              open_house_id: row.open_house_id || null,
              brokerage: row.brokerage || null,
              step: "followup",
              template_key: row.template_key || null,
              provider_override: providerOverride,
              outreach_operator_mode: outreachOperatorMode,
              mockup_image_url: row.mockup_image_url || null,
              outreach_preview_url: previewUrl || null,
            },
          });

          const sentAt = new Date().toISOString();
          const followupDeliveryStatus = String(smsRes.status || "queued").toLowerCase();
          await recordOutboundReply(supabase, row, followupBody || row.followup_sms || "", smsRes, "followup", sentAt).catch((error) => {
            console.error("[send-agent-outreach] outbound reply mirror failed", error);
          });

          const { error: updateError } = await supabase
            .from("agent_outreach_queue")
            .update({
              followup_sms: followupBody || row.followup_sms || null,
              followup_sms_link: followupBody ? buildSmsLink(row.agent_phone, followupBody) : null,
              followup_send_status: "sent",
              followup_sent_at: sentAt,
              twilio_sid_followup: smsRes.externalId || smsRes.sid || null,
              followup_delivery_status: followupDeliveryStatus,
              followup_delivery_status_updated_at: sentAt,
              followup_delivery_error_code: null,
              followup_delivery_error_message: null,
              last_delivery_status: followupDeliveryStatus,
              last_delivery_status_updated_at: sentAt,
              last_delivery_error_code: null,
              last_delivery_error_message: null,
              last_outreach_at: sentAt,
              followup_block_reason: null,
              send_error: null,
            })
            .eq("id", row.id);

          if (updateError) throw updateError;

          results.push({
            id: row.id,
            agent_name: row.agent_name,
            step: "followup",
            ok: true,
            sid: smsRes.externalId || smsRes.sid || null,
            provider: smsRes.provider,
            preview_url: previewUrl || null,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const providerForBlock = attemptedProvider || outreachProviderOverrideForRow(row) || (usesAndroidGateway() ? "android_gateway" : "twilio");
        const terminalBlock = getTerminalSmsBlock(message, providerForBlock);
        const update: Record<string, unknown> = { send_error: message };

        if (terminalBlock && attemptedStep === "initial") {
          update.initial_send_status = terminalBlock.status;
          update.initial_block_reason = terminalBlock.reason;
        }

        if (terminalBlock && attemptedStep === "followup") {
          update.followup_send_status = terminalBlock.status;
          update.followup_block_reason = terminalBlock.reason;
        }

        if (terminalBlock?.reviewStatus) {
          update.review_status = terminalBlock.reviewStatus;
        }

        await supabase
          .from("agent_outreach_queue")
          .update(update)
          .eq("id", row.id);

        results.push({
          id: row.id,
          agent_name: row.agent_name,
          step: attemptedStep,
          blocked: Boolean(terminalBlock),
          provider: providerForBlock,
          ok: false,
          error: message,
        });
      }
    }

    return new Response(
      JSON.stringify(
        {
          ok: true,
          processed: results.length,
          dry_run: dryRun,
          candidate_rows: rows?.length || 0,
          fetch_limit: fetchLimit,
          requested_limit: normalizedRequestedLimit,
          effective_limit: limit,
          max_per_run: maxPerRun,
          max_per_hour: maxPerHour,
          max_per_day: maxPerDay,
          recent_outreach_sends_1h: recentHourlySendCount,
          recent_outreach_sends_24h: recentDailySendCount,
          hourly_remaining: hourlyRemaining,
          daily_remaining: dailyRemaining,
          outreach_operator_mode: outreachOperatorMode,
          paused: outreachSendPaused,
          duplicate_phone_cooldown: "disabled",
          results,
        },
        null,
        2,
      ),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify(
        {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
        null,
        2,
      ),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
