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
  initial_send_status: string | null;
  followup_send_status: string | null;
  created_at: string | null;
};

type ListingInventoryRow = {
  id: string;
  agent_name: string | null;
  brokerage: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  open_start: string | null;
  open_end: string | null;
  image_url: string | null;
  outreach_image_status: string | null;
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

function buildStoragePath(id: string, collection = "agent-outreach"): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${collection}/${yyyy}/${mm}/${id}.jpg`;
}

function publicObjectUrl(bucket: string, path: string): string {
  return `${env.supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

async function patchQueueRow(id: string, payload: Record<string, unknown>) {
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

async function patchListingInventoryRow(id: string, payload: Record<string, unknown>) {
  const url = `${env.supabaseUrl}/rest/v1/agent_listing_inventory?id=eq.${encodeURIComponent(id)}`;

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
    throw new Error(raw || `Failed updating listing inventory row ${id}`);
  }
}

async function selectListingInventoryRows(limit: number): Promise<ListingInventoryRow[]> {
  if (limit <= 0) return [];
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
    "image_url",
    "outreach_image_status"
  ].join(",");
  const now = encodeURIComponent(new Date().toISOString());
  const url =
    `${env.supabaseUrl}/rest/v1/agent_listing_inventory` +
    `?select=${encodeURIComponent(select)}` +
    `&is_current=eq.true` +
    `&image_url=not.is.null` +
    `&outreach_image_status=eq.pending` +
    `&or=(open_end.gte.${now},and(open_end.is.null,open_start.gte.${now}))` +
    `&order=open_start.asc.nullslast` +
    `&limit=${limit}`;
  const response = await fetch(url, { method: "GET", headers: restHeaders() });
  const raw = await response.text();
  if (!response.ok) throw new Error(raw || "Failed selecting listing inventory images");
  return raw ? JSON.parse(raw) : [];
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
    body: bytes as any
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
    const inventoryLimit = ids.length > 0 ? 0 : Math.max(1, Math.floor(limit * 0.75));
    const queueLimit = ids.length > 0 ? limit : Math.max(1, limit - inventoryLimit);

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
      "initial_send_status",
      "followup_send_status",
      "created_at"
    ].join(",");

    let url =
      `${env.supabaseUrl}/rest/v1/agent_outreach_queue` +
      `?select=${encodeURIComponent(select)}` +
      `&generation_status=eq.generated` +
      `&send_status=eq.not_sent` +
      `&order=created_at.asc` +
      `&limit=${queueLimit}`;

    if (!force) {
      url += `&mockup_image_url=is.null`;
      url += `&mockup_status=eq.pending`;
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

    let inventoryRows: ListingInventoryRow[] = [];
    try {
      inventoryRows = await selectListingInventoryRows(inventoryLimit);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        stage: "select_listing_inventory_rows",
        error: error instanceof Error ? error.message : String(error)
      });
    }

    if (!rows.length && !inventoryRows.length) {
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

    const results: Array<{
      id: string;
      source: "listing_inventory" | "outreach_queue";
      ok: boolean;
      mockup_image_url?: string;
      outreach_image_url?: string;
      error?: string;
    }> = [];

    for (const row of inventoryRows) {
      try {
        const jpg: Buffer = await renderMockupJpg({
          agentName: row.agent_name,
          brokerage: row.brokerage,
          address: row.address,
          cityStateZip: [row.city, row.state, row.zip].filter(Boolean).join(", "),
          openStart: row.open_start,
          openEnd: row.open_end,
          propertyImageUrl: row.image_url,
          agentPhotoUrl: null,
          rel8tionUrl: `${baseUrl}/`
        });

        const path = buildStoragePath(row.id, "open-house-outreach");
        await uploadMockup(bucket, path, jpg);
        const publicUrl = publicObjectUrl(bucket, path);
        const renderedAt = new Date().toISOString();
        await patchListingInventoryRow(row.id, {
          outreach_image_url: publicUrl,
          outreach_image_status: "rendered",
          outreach_image_rendered_at: renderedAt,
          outreach_image_attempted_at: renderedAt,
          outreach_image_error: null,
          updated_at: renderedAt
        });
        results.push({
          id: row.id,
          source: "listing_inventory",
          ok: true,
          outreach_image_url: publicUrl
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown render error";
        try {
          await patchListingInventoryRow(row.id, {
            outreach_image_status: "failed",
            outreach_image_attempted_at: new Date().toISOString(),
            outreach_image_error: message,
            updated_at: new Date().toISOString()
          });
        } catch {}
        results.push({
          id: row.id,
          source: "listing_inventory",
          ok: false,
          error: message
        });
      }
    }

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
          source: "outreach_queue",
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
          const failedPatch: Record<string, unknown> = {
            generation_status: "failed",
            mockup_status: "failed",
            mockup_error: message,
            mockup_render_error: message,
            mockup_render_attempted_at: new Date().toISOString(),
            last_error: message,
            updated_at: new Date().toISOString()
          };

          if (row.initial_send_status === "pending") {
            failedPatch.initial_send_status = "blocked_image_unavailable";
            failedPatch.initial_block_reason = "listing_photo_unavailable";
          }

          if (row.followup_send_status === "pending") {
            failedPatch.followup_send_status = "not_scheduled";
            failedPatch.followup_block_reason = "listing_photo_unavailable";
          }

          await patchQueueRow(row.id, {
            ...failedPatch
          });
        } catch {}

        results.push({
          id: row.id,
          source: "outreach_queue",
          ok: false,
          error: message
        });
      }
    }

    return res.status(200).json({
      ok: true,
      stage: "render_pipeline",
      processed: results.length,
      listing_inventory_processed: inventoryRows.length,
      outreach_queue_processed: rows.length,
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
