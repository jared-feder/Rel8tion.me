import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
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
    const outreachReplyUrl =
      Deno.env.get("OUTREACH_INBOUND_REPLY_URL") ||
      `${supabaseUrl}/functions/v1/twilio-inbound-reply`;

    if (!outreachReplyUrl || (!Deno.env.get("OUTREACH_INBOUND_REPLY_URL") && !supabaseUrl)) {
      throw new Error("Missing OUTREACH_INBOUND_REPLY_URL or SUPABASE_URL");
    }

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

    const forwardRes = await fetch(outreachReplyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: toFormBody(payload),
    });

    const responseText = await forwardRes.text();

    return new Response(responseText, {
      status: forwardRes.status,
      headers: {
        ...corsHeaders,
        "Content-Type": forwardRes.headers.get("content-type") || "text/plain",
        "X-Twilio-Routed-To": "outreach-reply",
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
