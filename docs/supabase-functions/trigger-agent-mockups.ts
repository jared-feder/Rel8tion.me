import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const renderUrl =
      Deno.env.get("VERCEL_RENDER_URL") || "https://mockup-renderer-psi.vercel.app/api/render-agent-mockup";
    const sharedSecret = Deno.env.get("CRON_SHARED_SECRET");

    if (!renderUrl || !sharedSecret) {
      throw new Error("Missing VERCEL_RENDER_URL or CRON_SHARED_SECRET");
    }

    const body = await req.json().catch(() => ({}));

    const response = await fetch(renderUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": sharedSecret,
      },
      body: JSON.stringify({
        limit: body.limit || 25,
        ids: Array.isArray(body.ids) ? body.ids : undefined,
        force: Boolean(body.force),
      }),
    });

    const text = await response.text();

    return new Response(text, {
      status: response.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
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
