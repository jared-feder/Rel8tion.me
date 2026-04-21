import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env, getMissingEnvVars } from "../lib/env";
import { getSupabaseAdmin } from "../lib/supabase-admin";

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

async function patchQueueRow(id: string, payload: Record<string, string | null>) {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/agent_outreach_queue?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "apikey": env.supabaseServiceRoleKey,
      "Authorization": `Bearer ${env.supabaseServiceRoleKey}`,
      "Prefer": "return=minimal"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(raw || `Failed updating queue row ${id}`);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const missing = getMissingEnvVars([
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "CRON_SHARED_SECRET"
    ]);

    if (missing.length) {
      return res.status(500).json({ error: "Missing required environment variables", missing });
    }

    if (req.headers["x-cron-secret"] !== env.cronSharedSecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const limit = Math.min(Number(req.body?.limit || 10), 25);

    let renderMockupJpg: any;
    try {
      const renderer = await import("../lib/mockup");
      renderMockupJpg = renderer.renderMockupJpg;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed importing renderer";
      return res.status(500).json({ error: message, stage: "import_renderer" });
    }

    const { data, error } = await supabaseAdmin
      .from("agent_outreach_queue")
      .select("id,agent_name,agent_photo_url,brokerage,address,city,state,zip,open_start,open_end,listing_photo_url,sms_link")
      .in("status", ["pending_approval", "approved"])
      .is("mockup_image_url", null)
      .in("mockup_status", ["pending", "retry"])
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message, stage: "select_queue_rows" });

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

        await patchQueueRow(row.id, {
          mockup_image_url: mockupUrl,
          mockup_status: "rendered",
          mockup_rendered_at: new Date().toISOString(),
          mockup_render_attempted_at: new Date().toISOString(),
          mockup_render_error: null,
          mockup_error: null,
          updated_at: new Date().toISOString()
        });

        results.push({ id: row.id, ok: true, mockup_image_url: mockupUrl });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown render error";

        try {
          await patchQueueRow(row.id, {
            mockup_status: "failed",
            mockup_error: message,
            mockup_render_error: message,
            mockup_render_attempted_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        } catch {}

        results.push({ id: row.id, ok: false, error: message });
      }
    }

    return res.status(200).json({ ok: true, processed: results.length, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown function error";
    return res.status(500).json({ error: message, stage: "top_level_handler" });
  }
}
