import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalizePhone(phone: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits;
}

function getPhoneMatchCandidates(phone: string | null): string[] {
  if (!phone) return [];

  const rawDigits = phone.replace(/\D/g, "");
  const normalized = normalizePhone(phone);

  return Array.from(new Set([normalized, rawDigits].filter(Boolean)));
}

function isOptOut(text: string): boolean {
  const normalized = text.trim().toUpperCase();
  return ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(normalized);
}

function isNegativeReply(text: string): boolean {
  const normalized = text.trim().toLowerCase();

  if (!normalized) return false;

  const patterns = [
    /^\s*no\s*$/i,
    /^\s*nope\s*$/i,
    /^\s*nah\s*$/i,
    /^\s*not interested\s*$/i,
    /\bnot interested\b/,
    /\bno thanks\b/,
    /\bno thank you\b/,
    /\bdo not contact\b/,
    /\bdon't contact\b/,
    /\bwrong number\b/,
    /\bremove me\b/,
    /\bopt out\b/,
  ];

  return patterns.some((pattern) => pattern.test(normalized));
}

async function sendTwilioMessage(opts: {
  accountSid: string;
  authToken: string;
  from: string;
  to: string;
  body: string;
}) {
  const form = new URLSearchParams();
  form.set("From", opts.from);
  form.set("To", opts.to);
  form.set("Body", opts.body);

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

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data?.message || `Twilio error ${res.status}`;
    throw new Error(msg);
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
    const ownerPhone = Deno.env.get("YOUR_PHONE");

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

    if (!messageSid || !fromPhone) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing MessageSid or From" }, null, 2),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const fromPhoneNormalized = normalizePhone(fromPhone);
    const phoneCandidates = getPhoneMatchCandidates(fromPhone);
    const optOut = isOptOut(body);
    const negativeReply = isNegativeReply(body);

    const { data: existingReply, error: existingReplyError } = await supabase
      .from("agent_outreach_replies")
      .select("id")
      .eq("message_sid", messageSid)
      .maybeSingle();

    if (existingReplyError) throw existingReplyError;

    const isNewReply = !existingReply;

    const { data: queueRow, error: queueLookupError } = await supabase
      .from("agent_outreach_queue")
      .select("id, open_house_id, agent_name, agent_phone_normalized, send_mode, review_status")
      .in("agent_phone_normalized", phoneCandidates)
      .order("last_outreach_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (queueLookupError) throw queueLookupError;

    const { error: insertError } = await supabase
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
      }, { onConflict: "message_sid" });

    if (insertError) throw insertError;

    if (queueRow?.id) {
      const queueUpdate: Record<string, unknown> = {
        approved_for_send: false,
        review_status: optOut ? "opted_out" : "replied",
        send_mode: "manual",
        followup_block_reason: optOut ? "opted_out" : "agent_replied",
        followup_send_status: optOut ? "blocked_opted_out" : "blocked_replied",
        updated_at: new Date().toISOString(),
      };

      const { error: updateQueueError } = await supabase
        .from("agent_outreach_queue")
        .update(queueUpdate)
        .eq("id", queueRow.id);

      if (updateQueueError) throw updateQueueError;
    }

    if (isNewReply && ownerPhone && twilioSid && twilioToken && twilioFrom && body && !optOut && !negativeReply) {
      const address = queueRow?.open_house_id ? `Open house: ${queueRow.open_house_id}` : "Open house: unknown";
      const agent = queueRow?.agent_name || "Unknown agent";
      const prefix = "Agent reply";
      const alertBody =
        `${prefix}\n\n${agent}\n${fromPhone}\n${address}\n\n${body || "(empty message)"}`;

      try {
        await sendTwilioMessage({
          accountSid: twilioSid,
          authToken: twilioToken,
          from: twilioFrom,
          to: ownerPhone,
          body: alertBody,
        });
      } catch (alertError) {
        console.error("Failed to send owner alert", alertError);
      }
    }

    const twiml = optOut
      ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>You have been opted out. No further automated texts will be sent.</Message></Response>`
      : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

    return new Response(twiml, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/xml",
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
