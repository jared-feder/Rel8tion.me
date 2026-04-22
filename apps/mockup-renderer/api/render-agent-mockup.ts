import { getSupabaseAdmin } from "../lib/supabase-admin";

export default async function handler(req: any, res: any) {
  try {
    if (req?.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const limit = Math.min(Number(req?.body?.limit || 3), 10);

    const { data, error } = await supabaseAdmin
      .from("agent_outreach_queue")
      .select("id,agent_name,brokerage,address,listing_photo_url,agent_photo_url,status,mockup_status,mockup_image_url,created_at")
      .in("status", ["pending_approval", "approved"])
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) {
      return res.status(500).json({ ok: false, stage: "select_queue_rows", error: error.message });
    }

    return res.status(200).json({
      ok: true,
      stage: "select_queue_rows",
      count: Array.isArray(data) ? data.length : 0,
      rows: data || []
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown diagnostic error";
    return res.status(500).json({ ok: false, error: message, stage: "diagnostic_handler" });
  }
}
