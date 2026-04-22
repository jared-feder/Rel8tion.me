import { env, getMissingEnvVars } from "../lib/env.js";

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
  generation_status: string | null;
  review_status: string | null;
  send_status: string | null;
  mockup_status: string | null;
  mockup_image_url: string | null;
  created_at: string | null;
};

function restHeaders() {
  return {
    "Content-Type": "application/json",
    apikey: env.supabaseServiceRoleKey,
    Authorization: `Bearer ${env.supabaseServiceRoleKey}`
  };
}

function readHeader(req: any, name: string): string {
  return req?.headers?.[name] || req?.headers?.[name.toLowerCase()] || req?.headers?.[name.toUpperCase()] || "";
}

function isAuthorizedRequest(req: any): boolean {
  const sharedSecret = readHeader(req, "x-cron-secret");
  const authHeader = readHeader(req, "authorization");

  if (env.cronSharedSecret && sharedSecret === env.cronSharedSecret) {
    return true;
  }

  if (env.cronSecret && authHeader === `Bearer ${env.cronSecret}`) {
    return true;
  }

  return false;
}

function parseLimit(value: unknown): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 10;
  }

  return Math.max(1, Math.min(Math.floor(parsed), 50));
}

function parseIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((id) => String(id || "").trim())
    .filter(Boolean);
}

function buildStoragePath(id: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `agent-outreach/${yyyy}/${mm}/${id}.jpg`;
}

function publicObjectUrl(bucket: string, path: string): string {
  return `${env.supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

async function patchQueueRow(id: string, payload: Record<string, string | null>) {
  const url = `${env.supabaseUrl}/rest/v1/agent_outreach_queue?id=eq.${encodeURIComponent(id)}`;

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
  const url = `${env.supabaseUrl}/storage/v1/object/${bucket}/${path}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "image/jpeg",
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
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

    if (!env.cronSharedSecret && !env.cronSecret) {
      return res.status(500).json({
        ok: false,
        stage: "auth_config",
        error: "Missing CRON_SHARED_SECRET or CRON_SECRET"
      });
    }

    if (!isAuthorizedRequest(req)) {
      return res.status(401).json({
        ok: false,
        stage: "auth_check",
        error: "Unauthorized"
      });
    }

    const missingEnvVars = getMissingEnvVars(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
    if (missingEnvVars.length > 0) {
      return res.status(500).json({
        ok: false,
        stage: "env_check",
        missingEnvVars
      });
    }

    const bucket = env.storageBucket;
    const baseUrl = env.publicBaseUrl;
    const limit = parseLimit(req?.body?.limit);
    const force = Boolean(req?.body?.force);
    const ids = parseIds(req?.body?.ids);

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
      "generation_status",
      "review_status",
      "send_status",
      "mockup_status",
      "mockup_image_url",
      "created_at"
    ].join(",");

    let url =
      `${env.supabaseUrl}/rest/v1/agent_outreach_queue` +
      `?select=${encodeURIComponent(select)}` +
      `&generation_status=eq.generated` +
      `&send_status=eq.not_sent` +
      `&order=created_at.asc` +
      `&limit=${limit}`;

    if (!force) {
      url += `&mockup_image_url=is.null`;
    }

    if (ids.length > 0) {
      url += `&id=in.(${ids.join(",")})`;
    }

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
      const renderer = await import("../lib/mockup.js");
      if (typeof renderer.renderMockupJpg !== "function") {
        console.error("[render-agent-mockup] Renderer module loaded without renderMockupJpg export", {
          exportedKeys: Object.keys(renderer || {})
        });
        return res.status(500).json({
          ok: false,
          stage: "import_renderer",
          error: "Renderer module missing renderMockupJpg export"
        });
      }
      renderMockupJpg = renderer.renderMockupJpg;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed importing renderer";
      console.error("[render-agent-mockup] Failed importing renderer", {
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: message,
        errorStack: error instanceof Error ? error.stack : undefined
      });
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
        console.error("[render-agent-mockup] Failed rendering queue row", {
          rowId: row.id,
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: message,
          errorStack: error instanceof Error ? error.stack : undefined
        });

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
    console.error("[render-agent-mockup] Unhandled diagnostic error", {
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: message,
      errorStack: error instanceof Error ? error.stack : undefined
    });
    return res.status(500).json({
      ok: false,
      error: message,
      stage: "diagnostic_handler"
    });
  }
}
