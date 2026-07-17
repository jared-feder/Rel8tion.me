import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendSMS } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalizePhone(phone: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function phoneLookupVariants(phone: string | null): string[] {
  const rawDigits = phone ? phone.replace(/\D/g, "") : "";
  const normalized = normalizePhone(phone);
  return Array.from(new Set([normalized, rawDigits].filter(Boolean)));
}

function isOptOut(text: string): boolean {
  const normalized = text.trim().toUpperCase();
  return ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(normalized);
}

function isOptIn(text: string): boolean {
  const normalized = text.trim().toUpperCase();
  return ["START", "UNSTOP"].includes(normalized);
}

function replyIntent(text: string): "yes" | "no" | null {
  const normalized = text.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (["Y", "YES"].includes(normalized)) return "yes";
  if (["N", "NO"].includes(normalized)) return "no";
  return null;
}

function automaticReply(intent: "yes" | "no"): string {
  if (intent === "yes") {
    return "Great—I’m excited to support your open house. I’ll call shortly to confirm timing and how the complimentary Rel8tion Event Pass and buyer pre-approval support will work. —Jared, NMB.";
  }
  return "No problem—another time works. Save me as Jared | NMB Hard Loans. I help find financing solutions for difficult or nontraditional loans that other lenders may not be able to approve. If a buyer needs a second look, call or text me here.";
}

function toE164(phone: string | null): string {
  const digits = normalizePhone(phone);
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (phone?.trim().startsWith("+")) return phone.trim();
  return `+${digits}`;
}

function shortText(text: string, max = 520): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3)}...`;
}

function buildOwnerReplyAlert(opts: {
  queueRow: Record<string, unknown> | null;
  fromPhone: string;
  body: string;
  optOut: boolean;
}): string {
  const agentName = String(opts.queueRow?.agent_name || "Unknown agent");
  const agentPhone = String(opts.queueRow?.agent_phone || opts.fromPhone || "");
  const address = String(opts.queueRow?.address || opts.queueRow?.open_house_id || "Open house");
  const status = opts.optOut ? "STOP / opt-out" : "reply";

  return [
    `Rel8tion outreach ${status}`,
    `${agentName} (${agentPhone})`,
    address,
    shortText(opts.body || "(empty reply)"),
    "Use the admin dashboard to reply.",
  ].filter(Boolean).join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const ownerAlertPhone =
      Deno.env.get("OUTREACH_REPLY_ALERT_PHONE") ||
      Deno.env.get("REL8TION_OWNER_ALERT_PHONE") ||
      "13477758059";

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const contentType = req.headers.get("content-type") || "";

    let payload: Record<string, unknown> = {};

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      payload = Object.fromEntries(form.entries());
    } else {
      payload = await req.json().catch(() => ({}));
    }

    const messageSid = String(payload.MessageSid || payload.SmsMessageSid || payload.message_sid || "").trim();
    const fromPhone = String(payload.From || payload.from || "").trim();
    const toPhone = String(payload.To || payload.to || "").trim();
    const body = String(payload.Body || payload.body || "").trim();
    const accountSid = String(payload.AccountSid || payload.account_sid || "").trim();
    const optOutType = String(payload.OptOutType || payload.opt_out_type || "").trim().toUpperCase();

    if (!messageSid || !fromPhone) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing MessageSid or From" }, null, 2),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const fromPhoneNormalized = normalizePhone(fromPhone);
    const optOut = optOutType === "STOP" || isOptOut(body);
    const optIn = optOutType === "START" || isOptIn(body);
    const intent = !optOut && !optIn ? replyIntent(body) : null;

    const { data: queueRow, error: queueLookupError } = await supabase
      .from("agent_outreach_queue")
      .select("id, open_house_id, agent_name, agent_phone, agent_phone_normalized, address, send_mode, review_status")
      .in("agent_phone_normalized", phoneLookupVariants(fromPhone))
      .order("last_outreach_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (queueLookupError) throw queueLookupError;

    const { data: savedReply, error: insertError } = await supabase
      .from("agent_outreach_replies")
      .upsert({
        queue_row_id: queueRow?.id || null,
        open_house_id: queueRow?.open_house_id || null,
        from_phone: fromPhone,
        from_phone_normalized: fromPhoneNormalized,
        to_phone: toPhone || null,
        body,
        message_sid: messageSid,
        account_sid: accountSid || null,
        direction: "inbound",
        opt_out: optOut,
        raw_payload: payload,
        received_at: new Date().toISOString(),
      }, { onConflict: "message_sid" })
      .select("id, queue_row_id, open_house_id, opt_out, received_at")
      .single();

    if (insertError) throw insertError;

    if (optOut) {
      const suppressedPhone = toE164(fromPhone);
      const { data: existingSuppression, error: suppressLookupError } = await supabase
        .from("sms_suppression_list")
        .select("id")
        .eq("phone", suppressedPhone)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (suppressLookupError) {
        console.error("SMS suppression lookup failed", suppressLookupError);
      }

      const suppressionPayload = {
        phone: suppressedPhone,
        reason: "STOP keyword",
        provider: "twilio",
        source: "twilio-inbound-reply",
        raw_payload: payload,
      };

      const suppressRequest = existingSuppression?.id
        ? supabase
          .from("sms_suppression_list")
          .update(suppressionPayload)
          .eq("id", existingSuppression.id)
        : supabase
          .from("sms_suppression_list")
          .insert(suppressionPayload);

      const { error: suppressError } = await suppressRequest;

      if (suppressError) {
        console.error("SMS suppression upsert failed", suppressError);
      }
    } else if (optIn) {
      const { error: optInError } = await supabase
        .from("sms_suppression_list")
        .delete()
        .eq("phone", toE164(fromPhone));

      if (optInError) {
        console.error("SMS suppression opt-in removal failed", optInError);
      }
    }

    if (optOut) {
      const { error: updateAllQueueError } = await supabase
        .from("agent_outreach_queue")
        .update({
          approved_for_send: false,
          review_status: "opted_out",
          send_mode: "manual",
          followup_block_reason: "opted_out",
          followup_send_status: "blocked_opt_out",
          updated_at: new Date().toISOString(),
        })
        .in("agent_phone_normalized", phoneLookupVariants(fromPhone));

      if (updateAllQueueError) throw updateAllQueueError;
    } else if (queueRow?.id) {
      const queueUpdate: Record<string, unknown> = {
        approved_for_send: false,
        review_status: intent === "yes" ? "interested" : intent === "no" ? "not_now" : "replied",
        send_mode: queueRow.send_mode,
        followup_block_reason: null,
        followup_send_status: "pending",
        updated_at: new Date().toISOString(),
      };

      const { error: updateQueueError } = await supabase
        .from("agent_outreach_queue")
        .update(queueUpdate)
        .eq("id", queueRow.id);

      if (updateQueueError) throw updateQueueError;
    }

    let automaticReplyStatus = "skipped";
    if (intent && queueRow?.id) {
      try {
        const replyBody = automaticReply(intent);
        const sentReply = await sendSMS({
          supabase,
          to: toE164(fromPhone),
          body: replyBody,
          category: "manual_outreach",
          metadata: {
            source: "twilio-inbound-reply",
            queue_row_id: queueRow.id,
            inbound_reply_id: savedReply?.id || null,
            automatic_y_n_reply: true,
            reply_intent: intent,
            reply_to_recent_inbound: true,
            omit_repeated_stop_disclosure: true,
          },
        });
        await supabase.from("agent_outreach_replies").insert({
          queue_row_id: queueRow.id,
          open_house_id: queueRow.open_house_id || null,
          from_phone: toPhone || null,
          from_phone_normalized: normalizePhone(toPhone),
          to_phone: fromPhone,
          body: replyBody,
          message_sid: sentReply.externalId || sentReply.sid || null,
          direction: "outbound",
          opt_out: false,
          raw_payload: { source: "automatic_y_n_reply", intent },
          received_at: new Date().toISOString(),
        });
        automaticReplyStatus = String(sentReply.externalId || sentReply.sid || "sent");
      } catch (autoReplyError) {
        automaticReplyStatus = "failed";
        console.error("Automatic Y/N reply failed", autoReplyError);
      }
    }

    let ownerAlertStatus = "skipped";
    const ownerAlertTo = toE164(ownerAlertPhone);

    if (ownerAlertTo) {
      try {
        const ownerAlert = await sendSMS({
          supabase,
          to: ownerAlertTo,
          body: buildOwnerReplyAlert({ queueRow, fromPhone, body, optOut }),
          category: "owner_fallback_alert",
          metadata: {
            source: "twilio-inbound-reply",
            queue_row_id: queueRow?.id || null,
            inbound_reply_id: savedReply?.id || null,
            internal_operational_alert: true,
          },
        });
        ownerAlertStatus = String(ownerAlert.sid || ownerAlert.externalId || "sent");
      } catch (alertErr) {
        ownerAlertStatus = "failed";
        console.error("Owner outreach reply alert failed", alertErr);
      }
    }

    // Twilio/carriers provide the required toll-free STOP/START confirmation.
    // Returning an empty response avoids sending a duplicate application reply.
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

    return new Response(twiml, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/xml",
        "X-Rel8tion-Owner-Alert": ownerAlertStatus,
        "X-Rel8tion-Automatic-Reply": automaticReplyStatus,
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
