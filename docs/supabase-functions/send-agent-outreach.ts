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

function normalizePhone(phone: string | null): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

function toE164(phone: string | null): string {
  const digits = normalizePhone(phone);
  if (!digits) return "";

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

  return "";
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
  const start = 6 * 60;
  const endExclusive = 22 * 60;

  return minutes >= start && minutes < endExclusive;
}

function isBlockedReviewStatus(reviewStatus: string | null): boolean {
  return reviewStatus === "opted_out" || reviewStatus === "replied";
}

function isPermanentPhoneFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("21614") ||
    lower.includes("not a valid mobile number") ||
    lower.includes("not a valid phone number") ||
    lower.includes("landline") ||
    lower.includes("sms-capable") ||
    lower.includes("not sms capable")
  );
}

function isStopMessageFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("21610") || lower.includes("has replied with stop");
}

function hasWaitedLongEnoughForFollowup(initialSentAt: string | null, now: Date): boolean {
  if (!initialSentAt) return false;

  const initialDate = new Date(initialSentAt);
  if (Number.isNaN(initialDate.getTime())) return false;

  return now.getTime() - initialDate.getTime() >= 24 * 60 * 60 * 1000;
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
    if (mediaUrl) form.append("MediaUrl", mediaUrl);
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
    const msg = data?.message || `Twilio error ${res.status}`;
    const code = data?.code ? ` (${data.code})` : "";
    throw new Error(`${msg}${code}`);
  }

  return data;
}

async function claimSendStep(
  supabase: ReturnType<typeof createClient>,
  rowId: string,
  step: "initial" | "followup",
) {
  const statusField =
    step === "initial" ? "initial_send_status" : "followup_send_status";

  const { data, error } = await supabase
    .from("agent_outreach_queue")
    .update({
      [statusField]: "sending",
      send_error: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rowId)
    .eq(statusField, "pending")
    .select(`id, ${statusField}`)
    .limit(1);

  if (error) throw error;

  return Array.isArray(data) && data.length > 0;
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
            message: "Current time is outside allowed send window (6:00 AM-10:00 PM ET). No messages sent.",
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
    const cooldownCutoff = new Date(
      now.getTime() - INITIAL_COOLDOWN_HOURS * 60 * 60 * 1000,
    ).toISOString();

    const attemptedPhones = new Set<string>();
    const results: Array<Record<string, unknown>> = [];

    const dueFilter = [
      `and(initial_send_status.eq.pending,initial_send_at.lte.${nowIso},open_end.gt.${nowIso})`,
      `and(followup_send_status.eq.pending,followup_send_at.lte.${nowIso},initial_send_status.eq.sent,open_start.gt.${nowIso})`,
    ].join(",");

    const { data: rows, error } = await supabase
      .from("agent_outreach_queue")
      .select(`
        id,
        created_at,
        open_house_id,
        agent_name,
        agent_phone,
        agent_phone_normalized,
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
        initial_block_reason,
        followup_block_reason
      `)
      .eq("send_mode", "automatic")
      .eq("generation_status", "generated")
      .not("review_status", "in", '("opted_out","replied","skipped")')
      .or(dueFilter)
      .order("created_at", { ascending: true })
      .limit(limit * 10);

    if (error) throw error;

    for (const row of rows || []) {
      if (results.length >= limit) break;

      try {
        const phoneNormalized =
          row.agent_phone_normalized || normalizePhone(row.agent_phone);
        const to = toE164(row.agent_phone);

        if (!phoneNormalized || !to) {
          await supabase
            .from("agent_outreach_queue")
            .update({
              send_error: "Missing or invalid phone",
              last_error: "Missing or invalid phone",
              initial_send_status:
                row.initial_send_status === "pending"
                  ? "blocked_invalid_phone"
                  : row.initial_send_status,
              followup_send_status:
                row.followup_send_status === "pending"
                  ? "blocked_invalid_phone"
                  : row.followup_send_status,
              initial_block_reason:
                row.initial_send_status === "pending"
                  ? "invalid_phone"
                  : row.initial_block_reason,
              followup_block_reason:
                row.followup_send_status === "pending"
                  ? "invalid_phone"
                  : row.followup_block_reason,
              updated_at: new Date().toISOString(),
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

        if (isBlockedReviewStatus(row.review_status)) {
          results.push({
            id: row.id,
            agent_name: row.agent_name,
            ok: true,
            skipped: true,
            reason: "Contact opted out",
          });
          continue;
        }

        if (
          row.initial_send_status === "blocked_invalid_mobile" ||
          row.followup_send_status === "blocked_invalid_mobile" ||
          row.initial_send_status === "blocked_invalid_phone" ||
          row.followup_send_status === "blocked_invalid_phone" ||
          row.initial_send_status === "blocked_opted_out" ||
          row.followup_send_status === "blocked_opted_out" ||
          row.initial_block_reason === "invalid_mobile" ||
          row.followup_block_reason === "invalid_mobile" ||
          row.initial_block_reason === "invalid_phone" ||
          row.followup_block_reason === "invalid_phone" ||
          row.initial_block_reason === "twilio_stop" ||
          row.followup_block_reason === "twilio_stop"
        ) {
          results.push({
            id: row.id,
            agent_name: row.agent_name,
            ok: true,
            skipped: true,
            reason: "Phone already blocked from retry",
          });
          continue;
        }

        const openStart = row.open_start ? new Date(row.open_start) : null;
        const openEnd = row.open_end ? new Date(row.open_end) : null;

        const initialStale = !!openEnd && openEnd <= now;
        const followupStale = !!openStart && openStart <= now;

        if (row.initial_send_status === "pending" && initialStale) {
          await supabase
            .from("agent_outreach_queue")
            .update({
              initial_send_status: "skipped_expired",
              initial_block_reason: "open_house_ended",
              send_error: null,
              last_error: null,
              updated_at: new Date().toISOString(),
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
              last_error: null,
              updated_at: new Date().toISOString(),
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
          (!openEnd || openEnd > now);

        const followupDue =
          row.followup_send_status === "pending" &&
          row.followup_send_at &&
          row.followup_send_at <= nowIso &&
          row.followup_sms &&
          row.initial_send_status === "sent" &&
          row.initial_sent_at &&
          hasWaitedLongEnoughForFollowup(row.initial_sent_at, now) &&
          (!openStart || openStart > now);

        if (!initialDue && !followupDue) {
          continue;
        }

        const { data: priorOptOut, error: priorOptOutError } = await supabase
          .from("agent_outreach_queue")
          .select("id, review_status, initial_block_reason, followup_block_reason")
          .eq("agent_phone_normalized", phoneNormalized)
          .neq("id", row.id)
          .or("review_status.eq.opted_out,initial_block_reason.eq.twilio_stop,followup_block_reason.eq.twilio_stop,initial_send_status.eq.blocked_opted_out,followup_send_status.eq.blocked_opted_out")
          .order("updated_at", { ascending: false })
          .limit(1);

        if (priorOptOutError) throw priorOptOutError;

        if (priorOptOut && priorOptOut.length > 0) {
          await supabase
            .from("agent_outreach_queue")
            .update({
              review_status: "opted_out",
              initial_send_status:
                initialDue ? "blocked_opted_out" : row.initial_send_status,
              followup_send_status:
                followupDue ? "blocked_opted_out" : row.followup_send_status,
              initial_block_reason:
                initialDue ? `prior_opt_out_phone:${priorOptOut[0].id}` : row.initial_block_reason,
              followup_block_reason:
                followupDue ? `prior_opt_out_phone:${priorOptOut[0].id}` : row.followup_block_reason,
              send_error: null,
              last_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);

          results.push({
            id: row.id,
            agent_name: row.agent_name,
            ok: true,
            skipped: true,
            reason: "Phone previously opted out",
            blocked_by: priorOptOut[0].id,
          });
          continue;
        }

        if (attemptedPhones.has(phoneNormalized)) {
          await supabase
            .from("agent_outreach_queue")
            .update({
              send_error: "Skipped duplicate phone in same batch",
              last_error: "Skipped duplicate phone in same batch",
              initial_send_status:
                initialDue ? "blocked_duplicate" : row.initial_send_status,
              followup_send_status:
                followupDue ? "blocked_duplicate" : row.followup_send_status,
              initial_block_reason:
                initialDue ? "duplicate_phone_same_batch" : row.initial_block_reason,
              followup_block_reason:
                followupDue ? "duplicate_phone_same_batch" : row.followup_block_reason,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);

          results.push({
            id: row.id,
            agent_name: row.agent_name,
            ok: true,
            skipped: true,
            reason: "Duplicate phone in same batch",
          });
          continue;
        }

        if (initialDue) {
          const claimed = await claimSendStep(supabase, row.id, "initial");

          if (!claimed) {
            results.push({
              id: row.id,
              agent_name: row.agent_name,
              step: "initial",
              ok: true,
              skipped: true,
              reason: "Row already claimed by another send run",
            });
            continue;
          }

          const { data: recentInitial, error: recentError } = await supabase
            .from("agent_outreach_queue")
            .select("id, initial_sent_at")
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
                last_error: null,
                updated_at: new Date().toISOString(),
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

          const { data: priorPermanentFailure, error: priorPermanentFailureError } = await supabase
            .from("agent_outreach_queue")
            .select("id, initial_block_reason, followup_block_reason")
            .eq("agent_phone_normalized", phoneNormalized)
            .neq("id", row.id)
            .or("initial_block_reason.eq.invalid_mobile,followup_block_reason.eq.invalid_mobile,initial_block_reason.eq.invalid_phone,followup_block_reason.eq.invalid_phone")
            .order("created_at", { ascending: false })
            .limit(1);

          if (priorPermanentFailureError) throw priorPermanentFailureError;

          if (priorPermanentFailure && priorPermanentFailure.length > 0) {
            await supabase
              .from("agent_outreach_queue")
              .update({
                initial_send_status: "blocked_invalid_mobile",
                initial_block_reason: `prior_phone_failure:${priorPermanentFailure[0].id}`,
                send_error: "Phone previously failed validation for SMS outreach",
                last_error: "Phone previously failed validation for SMS outreach",
                review_status: "needs_review",
                updated_at: new Date().toISOString(),
              })
              .eq("id", row.id);

            results.push({
              id: row.id,
              agent_name: row.agent_name,
              step: "initial",
              ok: true,
              skipped: true,
              reason: "Phone previously failed validation",
              blocked_by: priorPermanentFailure[0].id,
            });
            continue;
          }

          attemptedPhones.add(phoneNormalized);

          const twilioRes = await sendTwilioMessage({
            accountSid: twilioSid,
            authToken: twilioToken,
            from: twilioFrom,
            to,
            body: row.selected_sms,
            mediaUrls: [row.mockup_image_url, BUSINESS_CARD_URL].filter(Boolean),
          });

          const sentAt = new Date().toISOString();

          const { error: updateError } = await supabase
            .from("agent_outreach_queue")
            .update({
              initial_send_status: "sent",
              initial_sent_at: sentAt,
              twilio_sid_initial: twilioRes.sid,
              last_outreach_at: sentAt,
              initial_block_reason: null,
              send_error: null,
              last_error: null,
              updated_at: sentAt,
            })
            .eq("id", row.id);

          if (updateError) throw updateError;

          results.push({
            id: row.id,
            agent_name: row.agent_name,
            step: "initial",
            ok: true,
            sid: twilioRes.sid,
            media_included: [row.mockup_image_url, BUSINESS_CARD_URL].filter(Boolean).length,
          });

          continue;
        }

        if (followupDue) {
          const claimed = await claimSendStep(supabase, row.id, "followup");

          if (!claimed) {
            results.push({
              id: row.id,
              agent_name: row.agent_name,
              step: "followup",
              ok: true,
              skipped: true,
              reason: "Row already claimed by another send run",
            });
            continue;
          }

          attemptedPhones.add(phoneNormalized);

          const twilioRes = await sendTwilioMessage({
            accountSid: twilioSid,
            authToken: twilioToken,
            from: twilioFrom,
            to,
            body: row.followup_sms,
            mediaUrls: [row.mockup_image_url, BUSINESS_CARD_URL].filter(Boolean),
          });

          const sentAt = new Date().toISOString();

          const { error: updateError } = await supabase
            .from("agent_outreach_queue")
            .update({
              followup_send_status: "sent",
              followup_sent_at: sentAt,
              twilio_sid_followup: twilioRes.sid,
              last_outreach_at: sentAt,
              followup_block_reason: null,
              send_error: null,
              last_error: null,
              updated_at: sentAt,
            })
            .eq("id", row.id);

          if (updateError) throw updateError;

          results.push({
            id: row.id,
            agent_name: row.agent_name,
            step: "followup",
            ok: true,
            sid: twilioRes.sid,
            media_included: [row.mockup_image_url, BUSINESS_CARD_URL].filter(Boolean).length,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const permanentPhoneFailure = isPermanentPhoneFailure(message);
        const stopFailure = isStopMessageFailure(message);

        const updatePayload: Record<string, unknown> = {
          send_error: message,
          last_error: message,
          updated_at: new Date().toISOString(),
        };

        if (!permanentPhoneFailure && !stopFailure) {
          if (row.initial_send_status === "pending" || row.initial_send_status === "sending") {
            updatePayload.initial_send_status = "pending";
          }
          if (row.followup_send_status === "pending" || row.followup_send_status === "sending") {
            updatePayload.followup_send_status = "pending";
          }
        }

        if (permanentPhoneFailure) {
          if (row.initial_send_status === "pending" || row.initial_send_status === "sending") {
            updatePayload.initial_send_status = "blocked_invalid_mobile";
            updatePayload.initial_block_reason = "invalid_mobile";
          }
          if (row.followup_send_status === "pending" || row.followup_send_status === "sending") {
            updatePayload.followup_send_status = "blocked_invalid_mobile";
            updatePayload.followup_block_reason = "invalid_mobile";
          }
          updatePayload.review_status = "needs_review";
        }

        if (stopFailure) {
          updatePayload.review_status = "opted_out";
          if (row.initial_send_status === "pending" || row.initial_send_status === "sending") {
            updatePayload.initial_send_status = "blocked_opted_out";
            updatePayload.initial_block_reason = "twilio_stop";
          }
          if (row.followup_send_status === "pending" || row.followup_send_status === "sending") {
            updatePayload.followup_send_status = "blocked_opted_out";
            updatePayload.followup_block_reason = "twilio_stop";
          }
        }

        await supabase
          .from("agent_outreach_queue")
          .update(updatePayload)
          .eq("id", row.id);

        results.push({
          id: row.id,
          agent_name: row.agent_name,
          ok: false,
          error: message,
          classified_as:
            permanentPhoneFailure
              ? "permanent_phone_failure"
              : stopFailure
              ? "opt_out"
              : "temporary_failure",
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
