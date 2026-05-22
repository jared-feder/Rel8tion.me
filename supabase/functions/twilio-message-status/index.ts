import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-rel8tion-status-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function readPayloadValue(payload: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const value = payload[name];
    if (value !== undefined && value !== null) return String(value).trim();
  }
  return "";
}

async function readTwilioPayload(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    return Object.fromEntries(form.entries());
  }
  return await req.json().catch(() => ({}));
}

function normalizeStep(step: string): "initial" | "followup" | "unknown" {
  const clean = step.trim().toLowerCase();
  if (clean === "initial") return "initial";
  if (clean === "followup" || clean === "manual" || clean === "manual_reply") return "followup";
  return "unknown";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }, null, 2),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const expectedToken = Deno.env.get("TWILIO_STATUS_CALLBACK_TOKEN") || "";

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const url = new URL(req.url);
    const providedToken = url.searchParams.get("token") || req.headers.get("x-rel8tion-status-token") || "";
    if (expectedToken && providedToken !== expectedToken) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }, null, 2),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const payload = await readTwilioPayload(req);
    const messageSid = readPayloadValue(payload, "MessageSid", "SmsSid", "message_sid");
    const messageStatus = readPayloadValue(payload, "MessageStatus", "SmsStatus", "message_status").toLowerCase();
    const accountSid = readPayloadValue(payload, "AccountSid", "account_sid");
    const fromPhone = readPayloadValue(payload, "From", "from");
    const toPhone = readPayloadValue(payload, "To", "to");
    const errorCode = readPayloadValue(payload, "ErrorCode", "error_code") || null;
    const errorMessage = readPayloadValue(payload, "ErrorMessage", "error_message") || null;
    const queueId = url.searchParams.get("queue_id") || readPayloadValue(payload, "queue_id") || "";
    let step = normalizeStep(url.searchParams.get("step") || readPayloadValue(payload, "step"));

    if (!messageSid || !messageStatus) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing MessageSid or MessageStatus" }, null, 2),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    let queueRow: Record<string, unknown> | null = null;

    if (queueId) {
      const { data, error } = await supabase
        .from("agent_outreach_queue")
        .select("id, open_house_id, twilio_sid_initial, twilio_sid_followup")
        .eq("id", queueId)
        .maybeSingle();
      if (error) throw error;
      queueRow = data || null;
    }

    if (!queueRow) {
      const { data, error } = await supabase
        .from("agent_outreach_queue")
        .select("id, open_house_id, twilio_sid_initial, twilio_sid_followup")
        .or(`twilio_sid_initial.eq.${messageSid},twilio_sid_followup.eq.${messageSid}`)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      queueRow = data || null;
    }

    if (queueRow) {
      if (step === "unknown" && queueRow.twilio_sid_initial === messageSid) step = "initial";
      if (step === "unknown" && queueRow.twilio_sid_followup === messageSid) step = "followup";
    }

    const now = new Date().toISOString();

    const { error: insertError } = await supabase
      .from("agent_outreach_delivery_events")
      .insert({
        queue_row_id: queueRow?.id || null,
        open_house_id: queueRow?.open_house_id || null,
        message_sid: messageSid,
        message_step: step,
        message_status: messageStatus,
        error_code: errorCode,
        error_message: errorMessage,
        from_phone: fromPhone || null,
        to_phone: toPhone || null,
        account_sid: accountSid || null,
        raw_payload: payload,
        received_at: now,
      });

    if (insertError) throw insertError;

    if (queueRow?.id) {
      const update: Record<string, unknown> = {
        last_delivery_status: messageStatus,
        last_delivery_status_updated_at: now,
        last_delivery_error_code: errorCode,
        last_delivery_error_message: errorMessage,
        updated_at: now,
      };

      if (step === "initial") {
        update.initial_delivery_status = messageStatus;
        update.initial_delivery_status_updated_at = now;
        update.initial_delivery_error_code = errorCode;
        update.initial_delivery_error_message = errorMessage;
      } else if (step === "followup") {
        update.followup_delivery_status = messageStatus;
        update.followup_delivery_status_updated_at = now;
        update.followup_delivery_error_code = errorCode;
        update.followup_delivery_error_message = errorMessage;
      }

      const { error: updateError } = await supabase
        .from("agent_outreach_queue")
        .update(update)
        .eq("id", queueRow.id);

      if (updateError) throw updateError;
    }

    return new Response(
      JSON.stringify(
        {
          ok: true,
          message_sid: messageSid,
          message_status: messageStatus,
          queue_row_id: queueRow?.id || null,
          step,
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
