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
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits;
}

function normalizeIdentity(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function validOutreachMediaUrl(value: unknown, supabaseUrl: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const expected = new URL(supabaseUrl);
    const allowedPath = "/storage/v1/object/public/agent-mockups/";
    return url.protocol === "https:" && url.origin === expected.origin && url.pathname.startsWith(allowedPath)
      ? url.toString()
      : "";
  } catch {
    return "";
  }
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

function twilioOutreachBrokeragePatterns(): string[] {
  return String(Deno.env.get("SMS_TWILIO_OUTREACH_BROKERAGES") || "douglas elliman")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function outreachProviderOverrideForRow(row: Record<string, unknown>): "twilio" | null {
  const brokerage = String(row.brokerage || "").toLowerCase();
  if (!brokerage) return null;
  return twilioOutreachBrokeragePatterns().some((pattern) => brokerage.includes(pattern))
    ? "twilio"
    : null;
}

function requestedProviderOverride(value: unknown): "twilio" | "android_gateway" | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "twilio" || normalized === "android_gateway") return normalized;
  throw new Error("Unsupported provider override");
}

function buildStatusCallbackUrl(supabaseUrl: string, queueId: string): string {
  const override = Deno.env.get("TWILIO_STATUS_CALLBACK_URL");
  const token = Deno.env.get("TWILIO_STATUS_CALLBACK_TOKEN") || "";
  const base = override || `${supabaseUrl.replace(/\/$/, "")}/functions/v1/twilio-message-status`;
  const url = new URL(base);
  url.searchParams.set("queue_id", queueId);
  url.searchParams.set("step", "manual_reply");
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

function isRecentInbound(receivedAt: string | null | undefined): boolean {
  const receivedAtMs = new Date(receivedAt || "").getTime();
  if (!Number.isFinite(receivedAtMs)) return false;
  const ageMs = Date.now() - receivedAtMs;
  return ageMs >= 0 && ageMs <= 24 * 60 * 60 * 1000;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const defaultFrom = Deno.env.get("TWILIO_FROM_NUMBER") || Deno.env.get("TWILIO_PHONE") || Deno.env.get("ANDROID_OUTREACH_GATEWAY_DEVICE_ID") || "";

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "Missing required secrets: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
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
    const providerOverrideRequested = requestedProviderOverride(body.provider_override || body.provider);

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
        brokerage,
        review_status,
        send_mode,
        mockup_image_url,
        mockup_status
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

    if (row.review_status === "opted_out" || row.review_status === "android_opted_out") {
      return new Response(
        JSON.stringify({ ok: false, error: "Cannot send manual reply to opted-out contact" }, null, 2),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const mediaSource = String(body.media_source || "").trim().toLowerCase();
    const mediaId = String(body.media_id || "").trim();
    let mediaUrl = "";

    if (mediaSource || mediaId) {
      if (!mediaSource || !mediaId) {
        return new Response(
          JSON.stringify({ ok: false, error: "Both media source and media id are required" }, null, 2),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (mediaSource === "outreach_queue") {
        if (mediaId !== row.id || row.mockup_status !== "rendered") {
          return new Response(
            JSON.stringify({ ok: false, error: "The selected queue image is not available for this conversation" }, null, 2),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        mediaUrl = validOutreachMediaUrl(row.mockup_image_url, supabaseUrl);
      } else if (mediaSource === "listing_inventory") {
        const { data: listing, error: listingError } = await supabase
          .from("agent_listing_inventory")
          .select("id,agent_name,brokerage,phone,phone_normalized,is_current,outreach_image_url,outreach_image_status")
          .eq("id", mediaId)
          .maybeSingle();
        if (listingError) throw listingError;

        const queuePhone = normalizePhone(row.agent_phone_normalized || row.agent_phone || "");
        const listingPhone = normalizePhone(listing?.phone_normalized || listing?.phone || "");
        const samePhone = Boolean(queuePhone && listingPhone && queuePhone === listingPhone);
        const sameIdentity = normalizeIdentity(listing?.agent_name) === normalizeIdentity(row.agent_name)
          && normalizeIdentity(listing?.brokerage) === normalizeIdentity(row.brokerage);
        if (!listing?.is_current || listing.outreach_image_status !== "rendered" || (!samePhone && !sameIdentity)) {
          return new Response(
            JSON.stringify({ ok: false, error: "The selected property image is not available for this agent" }, null, 2),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        mediaUrl = validOutreachMediaUrl(listing.outreach_image_url, supabaseUrl);
      } else {
        return new Response(
          JSON.stringify({ ok: false, error: "Unsupported outreach image source" }, null, 2),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (!mediaUrl) {
        return new Response(
          JSON.stringify({ ok: false, error: "The selected outreach image URL is invalid" }, null, 2),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (providerOverrideRequested === "android_gateway") {
        return new Response(
          JSON.stringify({ ok: false, error: "Photo messages require the Twilio outreach sender" }, null, 2),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const { data: latestInbound, error: latestInboundError } = await supabase
      .from("agent_outreach_replies")
      .select("received_at")
      .eq("queue_row_id", row.id)
      .neq("direction", "outbound")
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestInboundError) throw latestInboundError;

    const lastInboundAt = latestInbound?.received_at || null;
    const replyToRecentInbound = isRecentInbound(lastInboundAt);

    const normalizedPhone = normalizePhone(row.agent_phone_normalized || row.agent_phone || "");
    const to = toE164(normalizedPhone);

    if (!to) {
      return new Response(
        JSON.stringify({ ok: false, error: "Agent phone is missing or invalid" }, null, 2),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const providerOverride = mediaUrl ? "twilio" : (providerOverrideRequested || outreachProviderOverrideForRow(row));
    const smsRes = await sendSMS({
      supabase,
      to,
      body: messageBody,
      category: "manual_outreach",
      providerOverride: providerOverride || undefined,
      mediaUrls: mediaUrl ? [mediaUrl] : undefined,
      statusCallback: buildStatusCallbackUrl(supabaseUrl, row.id),
      metadata: {
        queue_row_id: row.id,
        open_house_id: row.open_house_id || null,
        brokerage: row.brokerage || null,
        provider_override: providerOverride,
        campaign: typeof body.campaign === "string" ? body.campaign : null,
        step: "manual_reply",
        omit_repeated_stop_disclosure: true,
        reply_to_recent_inbound: replyToRecentInbound,
        last_inbound_at: lastInboundAt,
        media_source: mediaSource || null,
        media_id: mediaId || null,
        media_url: mediaUrl || null,
      },
    });

    const sentAt = new Date().toISOString();
    const followupDeliveryStatus = String(smsRes.status || "queued").toLowerCase();

    const { error: replyInsertError } = await supabase
      .from("agent_outreach_replies")
      .insert({
        queue_row_id: row.id,
        open_house_id: row.open_house_id || null,
        from_phone: smsRes.from || smsRes.deviceId || defaultFrom,
        from_phone_normalized: normalizePhone(String(smsRes.from || defaultFrom || "")),
        to_phone: to,
        body: smsRes.body || messageBody,
        message_sid: smsRes.externalId || smsRes.sid || `manual-${row.id}-${Date.now()}`,
        account_sid: smsRes.provider,
        direction: "outbound",
        opt_out: false,
        raw_payload: smsRes.raw || smsRes,
        received_at: sentAt,
      });

    if (replyInsertError) throw replyInsertError;

    const { error: updateError } = await supabase
      .from("agent_outreach_queue")
      .update({
        send_mode: "manual",
        approved_for_send: false,
        followup_sms: smsRes.body || messageBody,
        followup_send_status: "sent",
        followup_sent_at: sentAt,
        twilio_sid_followup: smsRes.externalId || smsRes.sid || null,
        followup_delivery_status: followupDeliveryStatus,
        followup_delivery_status_updated_at: sentAt,
        followup_delivery_error_code: null,
        followup_delivery_error_message: null,
        last_delivery_status: followupDeliveryStatus,
        last_delivery_status_updated_at: sentAt,
        last_delivery_error_code: null,
        last_delivery_error_message: null,
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
          sid: smsRes.externalId || smsRes.sid || null,
          provider: smsRes.provider,
          media_attached: Boolean(mediaUrl),
          media_url: mediaUrl || null,
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
