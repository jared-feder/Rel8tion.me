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
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function phoneLookupVariants(phone: string | null): string[] {
  const rawDigits = phone ? phone.replace(/\D/g, "") : "";
  const normalized = normalizePhone(phone);
  return Array.from(new Set([normalized, rawDigits].filter(Boolean)));
}

function toFormBody(payload: Record<string, unknown>) {
  const form = new URLSearchParams();

  for (const [key, value] of Object.entries(payload)) {
    if (value == null) continue;
    form.append(key, String(value));
  }

  return form.toString();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const outreachReplyUrl =
      Deno.env.get("OUTREACH_INBOUND_REPLY_URL") ||
      `${supabaseUrl}/functions/v1/twilio-inbound-reply`;

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

    const fromPhone = String(payload.From || payload.from || "").trim();
    const fromPhoneNormalized = normalizePhone(fromPhone);

    if (!fromPhoneNormalized) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing From phone" }, null, 2),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: matchingRow, error: lookupError } = await supabase
      .from("agent_outreach_queue")
      .select(`
        id,
        open_house_id,
        agent_name,
        agent_phone_normalized,
        review_status,
        last_outreach_at,
        updated_at
      `)
      .in("agent_phone_normalized", phoneLookupVariants(fromPhone))
      .order("last_outreach_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupError) throw lookupError;

    const routeToOutreach = !!matchingRow;

    const forwardRes = await fetch(outreachReplyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Bearer ${serviceRoleKey}`,
        "apikey": serviceRoleKey,
      },
      body: toFormBody(payload),
    });

    const responseText = await forwardRes.text();

    return new Response(responseText, {
      status: forwardRes.status,
      headers: {
        ...corsHeaders,
        "Content-Type": forwardRes.headers.get("content-type") || "text/plain",
        "X-Twilio-Routed-To": routeToOutreach ? "outreach" : "outreach-unmatched",
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
