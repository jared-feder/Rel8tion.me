import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
};

function normalizePhone(phone: string | null): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

function firstNameSafe(name: string | null): string {
  if (!name?.trim()) return "there";
  return name.trim().split(/\s+/)[0];
}

function shortAddress(address: string | null): string {
  if (!address?.trim()) return "your open house";
  return address.replace(/,\s*NY\s+\d{5}$/i, "").trim();
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

function buildMorningOfFallback(openStartDate: Date): Date | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(openStartDate);

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  if (!year || !month || !day) return null;

  const eightAmEt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const sixAmEt = new Date(Date.UTC(year, month - 1, day, 10, 0, 0));

  if (openStartDate > eightAmEt) return eightAmEt;
  if (openStartDate > sixAmEt) return sixAmEt;

  return null;
}

function computeFollowupPlan(openStart: string | null, initialSendAt: string) {
  if (!openStart) {
    return {
      sendAt: null,
      blockReason: "followup_not_scheduled",
      messageType: "none" as const,
    };
  }

  const openStartDate = new Date(openStart);
  const initialDate = new Date(initialSendAt);

  if (Number.isNaN(openStartDate.getTime()) || Number.isNaN(initialDate.getTime())) {
    return {
      sendAt: null,
      blockReason: "followup_not_scheduled",
      messageType: "none" as const,
    };
  }

  const dayBeforeOpen = new Date(openStartDate.getTime() - 24 * 60 * 60 * 1000);
  const minimumAfterInitial = new Date(initialDate.getTime() + 24 * 60 * 60 * 1000);

  if (dayBeforeOpen > initialDate && dayBeforeOpen >= minimumAfterInitial) {
    return {
      sendAt: dayBeforeOpen.toISOString(),
      blockReason: null,
      messageType: "standard" as const,
    };
  }

  const fallback = buildMorningOfFallback(openStartDate);

  if (fallback && fallback > initialDate && fallback < openStartDate) {
    return {
      sendAt: fallback.toISOString(),
      blockReason: null,
      messageType: "last_chance" as const,
    };
  }

  return {
    sendAt: null,
    blockReason: "followup_window_unavailable",
    messageType: "none" as const,
  };
}

function buildVariants(
  row: QueueRow,
  followupType: "standard" | "last_chance" | "none",
) {
  const firstName = firstNameSafe(row.agent_first_name || row.agent_name);
  const when = formatOpenHouse(row.open_start);
  const addr = shortAddress(row.address);

  const main =
    `Hey ${firstName} 👋 I’d love to stop by your open house at ${addr} ${when} and provide preapproval support for you and your buyers. ` +
    `No pressure. I also need a few local agents to beta Rel8tion, so I’ll bring a custom check-in sign and my card. Let me know. Reply STOP to opt out.`;

  const followup =
    followupType === "last_chance"
      ? `Hey ${firstName} 👋 Last chance to have industry-leading preapproval support at your event today at ${addr}. Happy to stop by with my card if helpful. Reply STOP to opt out.`
      : `Hey ${firstName} 👋 Just circling back before ${addr}. Happy to stop by with the custom check-in sign and my card if helpful. Reply STOP to opt out.`;

  return { v1: main, v2: null, v3: null, selected: main, followup };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const sendFunctionUrl =
      Deno.env.get("SEND_AGENT_OUTREACH_URL") ||
      (supabaseUrl ? `${supabaseUrl}/functions/v1/send-agent-outreach` : null);

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body.limit || 25), 200));

    const queueRefresh = await supabase.rpc("queue_recent_outreach_candidates");

    const queueRefreshError = queueRefresh.error ? queueRefresh.error.message : null;

    const { data: rows, error: fetchError } = await supabase
      .from("agent_outreach_queue")
      .select(
        "id, agent_first_name, agent_name, agent_phone, brokerage, address, open_start, open_end, listing_photo_url",
      )
      .eq("generation_status", "pending")
      .eq("send_status", "not_sent")
      .order("open_start", { ascending: true })
      .limit(limit);

    if (fetchError) throw fetchError;

    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          processed: 0,
          queue_refresh_error: queueRefreshError,
          message: "No pending outreach rows found.",
        }, null, 2),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];

    for (const row of rows as QueueRow[]) {
      try {
        if (isPast(row.open_end || row.open_start)) {
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

          results.push({ id: row.id, ok: false, error: "Open house is already in the past" });
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

          results.push({ id: row.id, ok: false, error: "Missing agent phone" });
          continue;
        }

        const initialSendAt = computeInitialSendAt();
        const followupPlan = computeFollowupPlan(row.open_start, initialSendAt);
        const { v1, v2, v3, selected, followup } = buildVariants(row, followupPlan.messageType);

        const { error: updateError } = await supabase
          .from("agent_outreach_queue")
          .update({
            sms_variant_1: v1,
            sms_variant_2: v2,
            sms_variant_3: v3,
            selected_sms: selected,
            followup_sms: followup,
            sms_link: buildSmsLink(row.agent_phone, selected),
            followup_sms_link: buildSmsLink(row.agent_phone, followup),
            generation_status: "generated",
            review_status: "pending",
            mockup_status: "pending",
            mockup_error: null,
            send_error: null,
            last_error: null,
            approved_for_send: false,
            send_mode: "automatic",
            initial_send_at: initialSendAt,
            followup_send_at: followupPlan.sendAt,
            initial_send_status: "pending",
            followup_send_status: followupPlan.sendAt ? "pending" : "not_scheduled",
            initial_block_reason: null,
            followup_block_reason: followupPlan.sendAt ? null : followupPlan.blockReason,
          })
          .eq("id", row.id);

        if (updateError) throw updateError;

        results.push({ id: row.id, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        await supabase
          .from("agent_outreach_queue")
          .update({
            generation_status: "failed",
            last_error: message,
          })
          .eq("id", row.id);

        results.push({ id: row.id, ok: false, error: message });
      }
    }

    let sendTriggerResult: Record<string, unknown> | null = null;

    if (results.some((result) => result.ok) && sendFunctionUrl) {
      try {
        const sendResponse = await fetch(sendFunctionUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ limit }),
        });

        const sendText = await sendResponse.text();

        sendTriggerResult = {
          ok: sendResponse.ok,
          status: sendResponse.status,
          body: sendText,
        };
      } catch (err) {
        sendTriggerResult = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed: results.length,
        queue_refresh_error: queueRefreshError,
        send_trigger: sendTriggerResult,
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
