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

function computeFollowupSendAt(openStart: string | null, initialSendAt: string): string | null {
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

  const v1 =
    `Hey ${firstName} 👋 Jared here. I saw your open house at ${addr} ${when} and wanted to reach out. ` +
    `I’d love to stop by, support you, and help prequal buyers if needed. ` +
    `I’ve been doing this 27 years and know how to help make deals happen, so it’d be great to meet you for a few minutes — no pressure if you already have someone. ` +
    `Also, I’m picking a few local beta agents for Rel8tion. If you’re open to it, I’ll make you a custom sign and you’ll get the service free for life as one of my first agents.`;

  const v2 =
    `Hey ${firstName} 👋 Jared here. I noticed your open house at ${addr} ${when}. ` +
    `Would love to stop by, support you, and help prequal buyers if useful. ` +
    `I’ve been in this business 27 years, so I know how to help make deals happen. No pressure at all if you already work with someone. ` +
    `On a separate note, I’m looking for a few beta agents for Rel8tion, and early agents get a custom sign plus free service for life.`;

  const v3 =
    `Hey ${firstName} 👋 Jared here. I saw your open house at ${addr} ${when}. ` +
    `I’d love to stop by, support you, and help with any buyers that need prequal help. ` +
    `I’ve been doing this 27 years and love helping agents get deals done smoothly. ` +
    `Also looking for a few local beta agents for Rel8tion. If you’re open, I’ll make you a custom sign and you’ll have the service free for life.`;

  const followup =
    `Hey ${firstName} — just circling back before ${addr}. ` +
    `If you’re open, I’d still love to stop by, support the open house, and show you the custom Rel8tion sign I made for your listing.`;

  return { v1, v2, v3, selected: v1, followup };
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

    const { data: rows, error: fetchError } = await supabase
      .from("agent_outreach_queue")
      .select(
        "id, agent_first_name, agent_name, agent_phone, brokerage, address, open_start, open_end, listing_photo_url",
      )
      .eq("enrichment_status", "ready")
      .eq("generation_status", "pending")
      .eq("send_status", "not_sent")
      .order("open_start", { ascending: true })
      .limit(limit);

    if (fetchError) throw fetchError;

    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, processed: 0, message: "No pending outreach rows found." }, null, 2),
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

        const { v1, v2, v3, selected, followup } = buildVariants(row);
        const initialSendAt = computeInitialSendAt();
        const followupSendAt = computeFollowupSendAt(row.open_start, initialSendAt);

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
            followup_send_at: followupSendAt,
            initial_send_status: "pending",
            followup_send_status: followupSendAt ? "pending" : "not_scheduled",
            initial_block_reason: null,
            followup_block_reason: followupSendAt ? null : "followup_not_scheduled",
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

    return new Response(
      JSON.stringify({ ok: true, processed: results.length, results }, null, 2),
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
