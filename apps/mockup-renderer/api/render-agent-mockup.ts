type QueueRow = {
  id: string;
  agent_name: string | null;
  brokerage: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  open_start: string | null;
  open_end: string | null;
  listing_photo_url: string | null;
  agent_photo_url: string | null;
  status: string | null;
  mockup_status: string | null;
  mockup_image_url: string | null;
  created_at: string | null;
};

function restHeaders() {
  return {
    "Content-Type": "application/json",
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ""}`
  };
}

function buildStoragePath(id: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `agent-outreach/${yyyy}/${mm}/${id}.jpg`;
}

function publicObjectUrl(bucket: string, path: string): string {
  const base = process.env.SUPABASE_URL || "";
  return `${base}/storage/v1/object/public/${bucket}/${path}`;
}

async function patchQueueRow(id: string, payload: Record<string, string | null>) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/agent_outreach_queue?id=eq.${encodeURIComponent(id)}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      ...restHeaders(),
      Prefer: "return=minimal"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(raw || `Failed updating queue row ${id}`);
  }
}

async function uploadMockup(bucket: string, path: string, bytes: Uint8Array) {
  const url = `${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "image/jpeg",
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ""}`,
      "x-upsert": "true"
    },
    body: bytes
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(raw || `Failed uploading mockup to ${path}`);
  }
}

export default async function handler(req: any, res: any) {
  try {
    if (req?.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        ok: false,
        stage: "env_check",
        hasSupabaseUrl: !!process.env.SUPABASE_URL,
        hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY
      });
    }

    const bucket = process.env.SUPABASE_STORAGE_BUCKET || "agent-mockups";
    const baseUrl = process.env.REL8TION_PUBLIC_BASE_URL || "https://rel8tion.me";
    const limit = Math.min(Number(req?.body?.limit || 3), 10);

    const select = [
      "id",
      "agent_name",
      "brokerage",
      "address",
      "city",
      "state",
      "zip",
      "open_start",
      "open_end",
      "listing_photo_url",
      "agent_photo_url",
      "status",
      "mockup_status",
      "mockup_image_url",
      "created_at"
    ].join(",");

    const url =
      `${process.env.SUPABASE_URL}/rest/v1/agent_outreach_queue` +
      `?select=${encodeURIComponent(select)}` +
      `&status=in.(pending_approval,approved)` +
      `&mockup_image_url=is.null` +
      `&order=created_at.asc` +
      `&limit=${limit}`;

    const queueResponse = await fetch(url, {
      method: "GET",
      headers: restHeaders()
    });

    const queueRaw = await queueResponse.text();

    if (!queueResponse.ok) {
      return res.status(500).json({
        ok: false,
        stage: "select_queue_rows",
        status: queueResponse.status,
        error: queueRaw
      });
    }

    let rows: QueueRow[] = [];
    try {
      rows = queueRaw ? JSON.parse(queueRaw) : [];
    } catch {
      return res.status(500).json({
        ok: false,
        stage: "parse_queue_rows",
        error: queueRaw
      });
    }

    if (!rows.length) {
      return res.status(200).json({
        ok: true,
        stage: "no_rows",
        processed: 0,
        results: []
      });
    }

    let renderMockupJpg: any;
    try {
      const renderer = await import("../lib/mockup");
      renderMockupJpg = renderer.renderMockupJpg;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed importing renderer";
      return res.status(500).json({
        ok: false,
        stage: "import_renderer",
        error: message
      });
    }

    const results: Array<{ id: string; ok: boolean; mockup_image_url?: string; error?: string }> = [];

    for (const row of rows) {
      try {
        const jpg: Buffer = await renderMockupJpg({
          agentName: row.agent_name,
          brokerage: row.brokerage,
          address: row.address,
          cityStateZip: [row.city, row.state, row.zip].filter(Boolean).join(", "),
          openStart: row.open_start,
          openEnd: row.open_end,
          propertyImageUrl: row.listing_photo_url,
          agentPhotoUrl: row.agent_photo_url,
          rel8tionUrl: `${baseUrl}/`
        });

        const path = buildStoragePath(row.id);
        await uploadMockup(bucket, path, jpg);

        const publicUrl = publicObjectUrl(bucket, path);

        await patchQueueRow(row.id, {
          mockup_image_url: publicUrl,
          mockup_status: "rendered",
          mockup_rendered_at: new Date().toISOString(),
          mockup_render_attempted_at: new Date().toISOString(),
          mockup_render_error: null,
          mockup_error: null,
          updated_at: new Date().toISOString()
        });

        results.push({
          id: row.id,
          ok: true,
          mockup_image_url: publicUrl
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown render error";

        try {
          await patchQueueRow(row.id, {
            mockup_status: "failed",
            mockup_error: message,
            mockup_render_error: message,
            mockup_render_attempted_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        } catch {}

        results.push({
          id: row.id,
          ok: false,
          error: message
        });
      }
    }

    return res.status(200).json({
      ok: true,
      stage: "render_pipeline",
      processed: results.length,
      results
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown diagnostic error";
    return res.status(500).json({
      ok: false,
      error: message,
      stage: "diagnostic_handler"
    });
  }
}