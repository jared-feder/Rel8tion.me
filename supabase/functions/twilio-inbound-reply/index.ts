import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalizePhone(phone: string | null): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

function isOptOut(text: string): boolean {
  const normalized = text.trim().toUpperCase();
  return ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(normalized);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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
    const optOut = isOptOut(body);

    const { data: queueRow, error: queueLookupError } = await supabase
      .from("agent_outreach_queue")
      .select("id, open_house_id, agent_name, agent_phone_normalized, send_mode, review_status")
      .eq("agent_phone_normalized", fromPhoneNormalized)
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

    if (queueRow?.id) {
      const queueUpdate: Record<string, unknown> = {
        approved_for_send: false,
        review_status: optOut ? "opted_out" : "replied",
        send_mode: optOut ? "manual" : queueRow.send_mode,
        followup_block_reason: optOut ? "opted_out" : null,
        followup_send_status: optOut ? "blocked_opt_out" : "pending",
        updated_at: new Date().toISOString(),
      };

      const { error: updateQueueError } = await supabase
        .from("agent_outreach_queue")
        .update(queueUpdate)
        .eq("id", queueRow.id);

      if (updateQueueError) throw updateQueueError;
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
