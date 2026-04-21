import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "../lib/env";
import { supabaseAdmin } from "../lib/supabase-admin";
import { renderMockupJpg } from "../lib/mockup";

type QueueRow = {
  id: string;
  agent_name: string | null;
  agent_photo_url: string | null;
  brokerage: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  open_start: string | null;
  open_end: string | null;
  listing_photo_url: string | null;
  sms_link: string | null;
};

function buildLink(row: QueueRow): string {
  return row.sms_link || `${env.publicBaseUrl}/`;
}

function buildStoragePath(id: string): string {
  const yyyy = new Date().getUTCFullYear();
  const mm = String(new Date().getUTCMonth() + 1).padStart(2, "0");
  return `agent-outreach/${yyyy}/${mm}/${id}.jpg`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (req.headers["x-cron-secret"] !== env.cronSharedSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const limit = Math.min(Number(req.body?.limit || 10), 25);

  const { data, error } = await supabaseAdmin
    .from("agent_outreach_queue")
    .select("id,agent_name,agent_photo_url,brokerage,address,city,state,zip,open_start,open_end,listing_photo_url,sms_link")
    .in("status", ["pending_approval", "approved"])
    .is("mockup_image_url", null)
    .in("mockup_status", ["pending", "retry"])
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });

  const results: Array<{ id: string; ok: boolean; mockup_image_url?: string; error?: string }> = [];

  for (const row of (data || []) as QueueRow[]) {
    try {
      const jpg = await renderMockupJpg({
        agentName: row.agent_name,
        brokerage: row.brokerage,
        address: row.address,
        cityStateZip: [row.city, row.state, row.zip].filter(Boolean).join(", "),
        openStart: row.open_start,
        openEnd: row.open_end,
        propertyImageUrl: row.listing_photo_url,
        agentPhotoUrl: row.agent_photo_url,
        rel8tionUrl: buildLink(row)
      });

      const path = buildStoragePath(row.id);

      const uploaded = await supabaseAdmin.storage.from(env.storageBucket).upload(path, jpg, {
        contentType: "image/jpeg",
        upsert: true
      });

      if (uploaded.error) throw new Error(uploaded.error.message);

      const { data: publicData } = supabaseAdmin.storage.from(env.storageBucket).getPublicUrl(path);
      const mockupUrl = publicData.publicUrl;

      const updated = await supabaseAdmin
        .from("agent_outreach_queue")
        .update({
          mockup_image_url: mockupUrl,
          mockup_status: "rendered",
          mockup_rendered_at: new Date().toISOString(),
          mockup_render_attempted_at: new Date().toISOString(),
          mockup_render_error: null,
          mockup_error: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", row.id);

      if (updated.error) throw new Error(updated.error.message);

      results.push({ id: row.id, ok: true, mockup_image_url: mockupUrl });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown render error";

      await supabaseAdmin
        .from("agent_outreach_queue")
        .update({
          mockup_status: "failed",
          mockup_error: message,
          mockup_render_error: message,
          mockup_render_attempted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", row.id);

      results.push({ id: row.id, ok: false, error: message });
    }
  }

  return res.status(200).json({ ok: true, processed: results.length, results });
}