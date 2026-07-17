import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FOLLOWUPS_DISABLED = true;

type QueueRow = {
  id: string;
  agent_first_name: string | null;
  agent_name: string | null;
  agent_phone: string | null;
  brokerage: string | null;
  address: string | null;
  open_start: string | null;
  open_end: string | null;
  listing_photo_url: string | null;
  template_key?: string | null;
};

function normalizePhone(phone: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function firstNameSafe(name: string | null): string {
  if (!name?.trim()) return "there";
  const first = name.trim().split(/\s+/)[0].replace(/[:;,]+$/, "");
  if (/^(agent|listing|unknown|phone)$/i.test(first)) return "there";
  return first;
}

function shortAddress(address: string | null): string {
  if (!address?.trim()) return "your open house";
  const withoutStateZip = address.replace(/,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$/i, "").trim();
  const parts = withoutStateZip.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[0] : withoutStateZip;
}

function formatOpenHouse(openStart: string | null): string {
  if (!openStart) return "this weekend";

  try {
    const dt = new Date(openStart);

    const day = dt.toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "America/New_York",
    });

    const time = dt.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    }).replace(":00", "");

    return `${day} at ${time}`;
  } catch {
    return "this weekend";
  }
}

function buildSmsLink(phone: string, body: string) {
  const clean = normalizePhone(phone);
  return `sms:${clean}?body=${encodeURIComponent(body)}`;
}

function computeInitialSendAt(): string {
  return new Date().toISOString();
}

function isPast(dateString: string | null): boolean {
  if (!dateString) return false;
  const dt = new Date(dateString);
  if (Number.isNaN(dt.getTime())) return false;
  return dt <= new Date();
}

function computeFollowupSendAt(openStart: string | null, initialSendAt: string): string | null {
  if (FOLLOWUPS_DISABLED) return null;
  if (!openStart) return null;

  const openStartDate = new Date(openStart);
  const initialDate = new Date(initialSendAt);
  const followupDate = new Date(openStartDate.getTime() - 24 * 60 * 60 * 1000);

  if (Number.isNaN(openStartDate.getTime()) || Number.isNaN(followupDate.getTime())) {
    return null;
  }

  if (followupDate <= initialDate) {
    return null;
  }

  return followupDate.toISOString();
}

function buildVariants(row: QueueRow) {
  const firstName = firstNameSafe(row.agent_first_name || row.agent_name);
  const when = formatOpenHouse(row.open_start);
  const addr = shortAddress(row.address);

  const main =
    `Hi ${firstName} — Jared with NMB. I saw your open house at ${addr} ${when}. ` +
    `Would it help if I stopped by with quick pre-approval support and a complimentary Rel8tion digital check-in pass? Reply Y to book me, N for another time, or STOP to unsubscribe.`;

  const followup = FOLLOWUPS_DISABLED
    ? null
    : `Hey ${firstName} 👋 Just circling back before your open house at ${addr} ${when}. ` +
      `I’d still love to stop by with quick pre-approval support and sponsor a Rel8tion Event Pass for paperless check-in, e-sign disclosures, and lead capture. Reply STOP to opt out.`;

  return { v1: main, v2: null, v3: null, selected: main, followup };
}

function buildMissedOpenHouseVariants(row: QueueRow) {
  const firstName = firstNameSafe(row.agent_first_name || row.agent_name);
  const addr = shortAddress(row.address);

  const main =
    `Hi ${firstName} — Jared with NMB. I missed your open house at ${addr}. ` +
    `Would it help if I supported your next one with quick pre-approval help and a complimentary Rel8tion digital check-in pass? Reply Y to book me, N for another time, or STOP to unsubscribe.`;

  return { v1: main, v2: null, v3: null, selected: main, followup: null };
}

function truthySetting(value: unknown): boolean {
  if (value === true) return true;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return truthySetting(record.paused ?? record.enabled ?? record.value);
  }
  return ["1", "true", "yes", "on", "paused"].includes(String(value || "").trim().toLowerCase());
}

async function loadOutreachSendPaused(supabase: any): Promise<boolean> {
  if (truthySetting(Deno.env.get("OUTREACH_SEND_PAUSED"))) return true;
  try {
    const { data, error } = await supabase
      .from("rel8tion_runtime_settings")
      .select("value")
      .eq("key", "outreach_send_paused")
      .maybeSingle();

    if (error) {
      console.warn("[generate-agent-outreach] outreach send pause lookup failed", error.message || error);
      return false;
    }

    return truthySetting(data?.value);
  } catch (error) {
    console.warn("[generate-agent-outreach] outreach send pause lookup failed", error);
    return false;
  }
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
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body.limit || 25), 200));
    const outreachSendPaused = await loadOutreachSendPaused(supabase);
    const generatedSendMode = outreachSendPaused ? "manual" : "automatic";
    const generatedReviewStatus = outreachSendPaused ? "manual_ready" : "pending";

    const select =
      "id, agent_first_name, agent_name, agent_phone, brokerage, address, open_start, open_end, listing_photo_url, template_key";

    const baseQuery = () =>
      supabase
        .from("agent_outreach_queue")
        .select(select)
        .eq("enrichment_status", "ready")
        .eq("generation_status", "pending")
        .eq("send_status", "not_sent");

    let campaign: "future_open_house" | "missed_open_house" = "future_open_house";
    let { data: rows, error: fetchError } = await baseQuery()
      .gt("open_end", new Date().toISOString())
      .order("open_start", { ascending: true })
      .limit(limit);

    if (!fetchError && (!rows || rows.length === 0)) {
      const blockingFuture = await supabase
        .from("agent_outreach_queue")
        .select("id", { count: "exact", head: true })
        .eq("send_status", "not_sent")
        .gt("open_end", new Date().toISOString())
        .or("generation_status.eq.pending,and(generation_status.eq.generated,mockup_status.eq.pending,mockup_image_url.is.null)");

      if (blockingFuture.error) throw blockingFuture.error;

      if ((blockingFuture.count || 0) > 0) {
        return new Response(
          JSON.stringify(
            {
              ok: true,
              campaign,
              processed: 0,
              blocked_by_future_render_backlog: blockingFuture.count,
              generation_send_mode: generatedSendMode,
              outreach_send_paused: outreachSendPaused,
              message: "Future outreach rows are still generating or waiting for mockups. Missed-open-house backlog is paused.",
            },
            null,
            2,
          ),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      campaign = "missed_open_house";
      const missed = await baseQuery()
        .lte("open_end", new Date().toISOString())
        .order("open_start", { ascending: false })
        .limit(limit);
      rows = missed.data;
      fetchError = missed.error;
    }

    if (fetchError) throw fetchError;

    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          processed: 0,
          generation_send_mode: generatedSendMode,
          outreach_send_paused: outreachSendPaused,
          message: "No pending outreach rows found.",
        }, null, 2),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const results: Array<{ id: string; ok: boolean; campaign: string; error?: string }> = [];

    for (const row of rows as QueueRow[]) {
      try {
        if (campaign !== "missed_open_house" && isPast(row.open_end || row.open_start)) {
          const { error } = await supabase
            .from("agent_outreach_queue")
            .update({
              generation_status: "failed",
              last_error: "Open house is already in the past",
              initial_send_status: "skipped_expired",
              followup_send_status: "not_scheduled",
              followup_block_reason: "open_house_in_past",
            })
            .eq("id", row.id);

          if (error) throw error;

          results.push({ id: row.id, campaign, ok: false, error: "Open house is already in the past" });
          continue;
        }

        if (!row.agent_phone) {
          const { error } = await supabase
            .from("agent_outreach_queue")
            .update({
              generation_status: "failed",
              last_error: "Missing agent phone",
            })
            .eq("id", row.id);

          if (error) throw error;

          results.push({ id: row.id, campaign, ok: false, error: "Missing agent phone" });
          continue;
        }

        const variants =
          campaign === "missed_open_house"
            ? buildMissedOpenHouseVariants(row)
            : buildVariants(row);
        const { v1, v2, v3, selected, followup } = variants;
        const initialSendAt = computeInitialSendAt();
        const followupSendAt =
          campaign === "missed_open_house" ? null : computeFollowupSendAt(row.open_start, initialSendAt);

        const { error: updateError } = await supabase
          .from("agent_outreach_queue")
          .update({
            sms_variant_1: v1,
            sms_variant_2: v2,
            sms_variant_3: v3,
            selected_sms: selected,
            followup_sms: followup,
            sms_link: buildSmsLink(row.agent_phone, selected),
            followup_sms_link: followup ? buildSmsLink(row.agent_phone, followup) : null,
            generation_status: "generated",
            review_status: generatedReviewStatus,
            mockup_status: "pending",
            mockup_error: null,
            send_error: null,
            last_error: null,
            approved_for_send: false,
            send_mode: generatedSendMode,
            template_key: campaign,
            initial_send_at: initialSendAt,
            followup_send_at: followupSendAt,
            initial_send_status: "pending",
            followup_send_status: followupSendAt ? "pending" : "not_scheduled",
            initial_block_reason: null,
            followup_block_reason: followupSendAt ? null : "followups_disabled",
          })
          .eq("id", row.id);

        if (updateError) throw updateError;

        results.push({ id: row.id, campaign, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        await supabase
          .from("agent_outreach_queue")
          .update({
            generation_status: "failed",
            last_error: message,
          })
          .eq("id", row.id);

        results.push({ id: row.id, campaign, ok: false, error: message });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        campaign,
        processed: results.length,
        generation_send_mode: generatedSendMode,
        outreach_send_paused: outreachSendPaused,
        results,
      }, null, 2),
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
