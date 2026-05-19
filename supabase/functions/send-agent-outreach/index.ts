import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const INITIAL_COOLDOWN_HOURS = 24 * 7;
const BUSINESS_CARD_URL =
  Deno.env.get("NMB_BUSINESS_CARD_URL") ||
  "https://nicanqrfqlbnlmnoernb.supabase.co/storage/v1/object/public/outreach-mockups/mynmb.jpg";

type OutreachRow = {
  agent_first_name?: string | null;
  agent_name?: string | null;
  agent_phone?: string | null;
  address?: string | null;
  open_start?: string | null;
  selected_sms?: string | null;
  followup_sms?: string | null;
  review_status?: string | null;
  template_key?: string | null;
};

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
  const start = 7 * 60;
  const endExclusive = 21 * 60 + 59;

  return minutes >= start && minutes < endExclusive;
}

function isBlockedReviewStatus(reviewStatus: string | null): boolean {
  return reviewStatus === "opted_out";
}

function getTerminalTwilioBlock(message: string): { status: string; reason: string; reviewStatus?: string } | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("not a mobile number")) {
    return { status: "blocked_invalid_mobile", reason: "twilio_not_mobile" };
  }

  if (normalized.includes("unsubscribed recipient") || normalized.includes("21610")) {
    return { status: "blocked_opted_out", reason: "twilio_unsubscribed", reviewStatus: "opted_out" };
  }

  return null;
}

async function sendTwilioMessage(opts: {
  accountSid: string;
  authToken: string;
  from: string;
  to: string;
  body: string;
  mediaUrls?: string[];
}) {
  const form = new URLSearchParams();
  form.set("From", opts.from);
  form.set("To", opts.to);
  form.set("Body", opts.body);
  for (const mediaUrl of opts.mediaUrls || []) {
    if (mediaUrl) {
      form.append("MediaUrl", mediaUrl);
    }
  }

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${opts.accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${opts.accountSid}:${opts.authToken}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    },
  );

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.message || `Twilio error ${res.status}`);
  }

  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioFrom = Deno.env.get("TWILIO_PHONE");

    if (!supabaseUrl || !serviceRoleKey || !twilioSid || !twilioToken || !twilioFrom) {
      throw new Error(
        "Missing required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE",
      );
    }

    if (!isWithinAllowedSendWindow()) {
      return new Response(
        JSON.stringify(
          {
            ok: true,
            processed: 0,
            quiet_hours: true,
            timezone: "America/New_York",
            message: "Current time is outside allowed send window (7:00 AM–9:58 PM ET). No messages sent.",
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
    const body = await req.json().catch(() => ({}));
    const limit = Number(body.limit || 25);
    const now = new Date();
    const nowIso = now.toISOString();
    const cooldownCutoff = new Date(now.getTime() - INITIAL_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();

    const { data: rows, error } = await supabase
      .from("agent_outreach_queue")
      .select(`
        id,
        open_house_id,
        agent_first_name,
        agent_name,
        agent_phone,
        agent_phone_normalized,
        address,
        selected_sms,
        followup_sms,
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
      .order("created_at", { ascending: true })
      .limit(Math.max(limit * 200, 250));

    if (error) throw error;

    const results: Array<Record<string, unknown>> = [];
    let sendAttempts = 0;

    for (const row of rows || []) {
      if (sendAttempts >= limit) break;

      let attemptedStep: "initial" | "followup" | null = null;

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
        const followupStale = !isAdminScheduledDrip && !!openStart && openStart <= now;

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
          row.followup_send_status === "pending" &&
          row.followup_send_at &&
          row.followup_send_at <= nowIso &&
          row.followup_sms &&
          row.approved_for_send === true &&
          row.initial_send_status === "sent" &&
          row.initial_sent_at &&
          (isAdminScheduledDrip || !openStart || openStart > now);

        if (!initialDue && !followupDue) {
          continue;
        }

        const initialBody = initialDue ? buildInitialOutreachBody(row) : "";
        const followupBody = followupDue ? buildFollowupOutreachBody(row) : null;
        const storedFollowupBody = buildFollowupOutreachBody(row);

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
          const { data: recentInitial, error: recentError } = await supabase
            .from("agent_outreach_queue")
            .select("id, agent_name, initial_sent_at")
            .eq("agent_phone_normalized", phoneNormalized)
            .eq("initial_send_status", "sent")
            .gte("initial_sent_at", cooldownCutoff)
            .neq("id", row.id)
            .order("initial_sent_at", { ascending: false })
            .limit(1);

          if (recentError) throw recentError;

          if (recentInitial && recentInitial.length > 0) {
            await supabase
              .from("agent_outreach_queue")
              .update({
                initial_send_status: "blocked_duplicate",
                initial_block_reason: `recent_initial_sent_to_phone:${recentInitial[0].id}`,
                send_error: null,
              })
              .eq("id", row.id);

            results.push({
              id: row.id,
              agent_name: row.agent_name,
              step: "initial",
              ok: true,
              skipped: true,
              reason: "Recent initial already sent to this phone",
              blocked_by: recentInitial[0].id,
            });
            continue;
          }

          sendAttempts += 1;
          attemptedStep = "initial";
          const twilioRes = await sendTwilioMessage({
            accountSid: twilioSid,
            authToken: twilioToken,
            from: twilioFrom,
            to,
            body: initialBody,
            mediaUrls: [row.mockup_image_url, BUSINESS_CARD_URL].filter(Boolean),
          });

          const { error: updateError } = await supabase
            .from("agent_outreach_queue")
            .update({
              selected_sms: initialBody,
              sms_variant_1: initialBody,
              sms_link: buildSmsLink(row.agent_phone, initialBody),
              followup_sms: storedFollowupBody,
              followup_sms_link: storedFollowupBody ? buildSmsLink(row.agent_phone, storedFollowupBody) : null,
              initial_send_status: "sent",
              initial_sent_at: new Date().toISOString(),
              twilio_sid_initial: twilioRes.sid,
              last_outreach_at: new Date().toISOString(),
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
            sid: twilioRes.sid,
          });

          continue;
        }

        if (followupDue) {
          sendAttempts += 1;
          attemptedStep = "followup";
          const twilioRes = await sendTwilioMessage({
            accountSid: twilioSid,
            authToken: twilioToken,
            from: twilioFrom,
            to,
            body: followupBody || row.followup_sms || "",
            mediaUrls: [row.mockup_image_url, BUSINESS_CARD_URL].filter(Boolean),
          });

          const { error: updateError } = await supabase
            .from("agent_outreach_queue")
            .update({
              followup_sms: followupBody || row.followup_sms || null,
              followup_sms_link: followupBody ? buildSmsLink(row.agent_phone, followupBody) : null,
              followup_send_status: "sent",
              followup_sent_at: new Date().toISOString(),
              twilio_sid_followup: twilioRes.sid,
              last_outreach_at: new Date().toISOString(),
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
            sid: twilioRes.sid,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const terminalBlock = getTerminalTwilioBlock(message);
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
          cooldown_hours: INITIAL_COOLDOWN_HOURS,
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
