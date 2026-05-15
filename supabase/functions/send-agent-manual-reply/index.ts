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

function toE164(phone: string | null): string {
  const normalized = normalizePhone(phone);
  if (!normalized) return "";
  return `+1${normalized}`;
}

function isOptOut(text: string): boolean {
  const normalized = text.trim().toUpperCase();
  return ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(normalized);
}

function isServiceRoleRequest(req: Request, serviceRoleKey: string): boolean {
  const authHeader = req.headers.get("authorization") || "";
  return authHeader === `Bearer ${serviceRoleKey}`;
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

    if (!supabaseUrl || !serviceRoleKey || !twilioSid || !twilioToken || !twilioFrom) {
      throw new Error(
        "Missing required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE",
      );
    }

    if (!isServiceRoleRequest(req, serviceRoleKey)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }, null, 2),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json().catch(() => ({}));
    const rowId = String(body.id || "").trim();
    const messageBody = String(body.body || "").trim();

    if (!rowId) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing queue row id" }, null, 2),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!messageBody) {
      return new Response(
        JSON.stringify({ ok: false, error: "Message body is required" }, null, 2),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (isOptOut(messageBody)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Manual reply cannot be an opt-out keyword" }, null, 2),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: row, error: rowError } = await supabase
      .from("agent_outreach_queue")
      .select(`
        id,
        open_house_id,
        agent_name,
        agent_phone,
        agent_phone_normalized,
        review_status,
        send_mode
      `)
      .eq("id", rowId)
      .maybeSingle();

    if (rowError) throw rowError;
    if (!row) {
      return new Response(
        JSON.stringify({ ok: false, error: "Queue row not found" }, null, 2),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (row.review_status === "opted_out") {
      return new Response(
        JSON.stringify({ ok: false, error: "Cannot send manual reply to opted-out contact" }, null, 2),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const normalizedPhone = normalizePhone(row.agent_phone_normalized || row.agent_phone || "");
    const to = toE164(normalizedPhone);

    if (!to) {
      return new Response(
        JSON.stringify({ ok: false, error: "Agent phone is missing or invalid" }, null, 2),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const twilioRes = await sendTwilioMessage({
      accountSid: twilioSid,
      authToken: twilioToken,
      from: twilioFrom,
      to,
      body: messageBody,
    });

    const sentAt = new Date().toISOString();

    const { error: replyInsertError } = await supabase
      .from("agent_outreach_replies")
      .insert({
        queue_row_id: row.id,
        open_house_id: row.open_house_id || null,
        from_phone: twilioFrom,
        from_phone_normalized: normalizePhone(twilioFrom),
        to_phone: to,
        body: messageBody,
        message_sid: twilioRes.sid,
        account_sid: twilioSid,
        direction: "outbound",
        opt_out: false,
        raw_payload: twilioRes,
        received_at: sentAt,
      });

    if (replyInsertError) throw replyInsertError;

    const { error: updateError } = await supabase
      .from("agent_outreach_queue")
      .update({
        send_mode: "manual",
        approved_for_send: false,
        followup_sms: messageBody,
        followup_send_status: "sent",
        followup_sent_at: sentAt,
        twilio_sid_followup: twilioRes.sid,
        followup_block_reason: null,
        send_error: null,
        last_error: null,
        last_outreach_at: sentAt,
        updated_at: sentAt,
      })
      .eq("id", row.id);

    if (updateError) throw updateError;

    return new Response(
      JSON.stringify(
        {
          ok: true,
          id: row.id,
          agent_name: row.agent_name,
          sid: twilioRes.sid,
          sent_at: sentAt,
        },
        null,
        2,
      ),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
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
