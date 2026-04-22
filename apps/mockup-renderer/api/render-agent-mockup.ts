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

    const limit = Math.min(Number(req?.body?.limit || 3), 10);
    const url = `${process.env.SUPABASE_URL}/rest/v1/agent_outreach_queue?select=id,agent_name,brokerage,address,listing_photo_url,agent_photo_url,status,mockup_status,mockup_image_url,created_at&status=in.(pending_approval,approved)&order=created_at.asc&limit=${limit}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    });

    const raw = await response.text();

    if (!response.ok) {
      return res.status(500).json({
        ok: false,
        stage: "select_queue_rows",
        status: response.status,
        error: raw
      });
    }

    let data: any[] = [];
    try {
      data = raw ? JSON.parse(raw) : [];
    } catch {
      return res.status(500).json({
        ok: false,
        stage: "parse_queue_rows",
        error: raw
      });
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
