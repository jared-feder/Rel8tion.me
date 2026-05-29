import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function clampHours(value: unknown, fallback = 3, max = 24): number {
  const parsed = Number.parseInt(clean(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, parsed));
}

function parseRoutes(value: unknown): string[] {
  const raw = clean(value || "outreach").toLowerCase();
  if (raw === "both") return ["outreach", "events"];
  return raw
    .split(/[\s,;]+/)
    .map((route) => route.trim())
    .filter(Boolean);
}

function isServiceRoleRequest(req: Request, serviceRoleKey: string): boolean {
  const authHeader = req.headers.get("authorization") || "";
  return authHeader === `Bearer ${serviceRoleKey}`;
}

function gatewayConfig(route: string) {
  const prefix = route === "events" ? "ANDROID_EVENTS" : "ANDROID_OUTREACH";
  return {
    route,
    baseUrl: clean(Deno.env.get(`${prefix}_GATEWAY_URL`) || "https://api.sms-gate.app"),
    username: clean(Deno.env.get(`${prefix}_GATEWAY_USERNAME`)),
    password: clean(Deno.env.get(`${prefix}_GATEWAY_PASSWORD`)),
    deviceId: clean(Deno.env.get(`${prefix}_GATEWAY_DEVICE_ID`)),
  };
}

function maskDevice(deviceId: string): string {
  if (!deviceId) return "";
  return deviceId.length <= 8 ? "configured" : `${deviceId.slice(0, 4)}...${deviceId.slice(-4)}`;
}

function inboxExportUrl(baseUrl: string): string {
  const base = clean(baseUrl || "https://api.sms-gate.app").replace(/\/$/, "");
  if (/\/3rdparty\/v1\/messages\/inbox\/export$/i.test(base)) return base;
  if (/\/3rdparty\/v1\/messages$/i.test(base)) return `${base}/inbox/export`;
  if (/\/3rdparty\/v1$/i.test(base)) return `${base}/messages/inbox/export`;
  return `${base}/3rdparty/v1/messages/inbox/export`;
}

async function requestInboxExport(config: ReturnType<typeof gatewayConfig>, since: string, until: string) {
  const missing = ["username", "password", "deviceId"].filter((key) => !config[key as keyof typeof config]);
  if (missing.length) {
    return {
      ok: false,
      route: config.route,
      status: "missing_config",
      missing,
    };
  }

  const response = await fetch(inboxExportUrl(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${config.username}:${config.password}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      deviceId: config.deviceId,
      since,
      until,
    }),
  });

  const text = await response.text().catch(() => "");
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  return {
    ok: response.ok,
    route: config.route,
    status: response.status,
    device: maskDevice(config.deviceId),
    payload: response.ok ? payload : null,
    error: response.ok ? null : payload || text || `Gateway returned ${response.status}`,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed." }, null, 2),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");

    if (!isServiceRoleRequest(req, serviceRoleKey)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }, null, 2),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const routes = [...new Set(parseRoutes(body.routes || body.route || "outreach"))];
    if (!routes.every((route) => ["outreach", "events"].includes(route))) {
      return new Response(
        JSON.stringify({ ok: false, error: "Route must be outreach, events, or both." }, null, 2),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const hours = clampHours(body.hours, 3, 168);
    const until = new Date().toISOString();
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const results = await Promise.all(routes.map((route) => requestInboxExport(gatewayConfig(route), since, until)));
    const ok = results.some((result) => result.ok);

    return new Response(
      JSON.stringify({
        ok,
        stage: "android-inbox-replay",
        message: "Android inbox replay requested. Matching inbound SMS webhooks should arrive shortly.",
        since,
        until,
        hours,
        routes,
        results,
      }, null, 2),
      { status: ok ? 200 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[android-inbox-replay] failed", error);
    return new Response(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unable to replay Android inbox." }, null, 2),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
