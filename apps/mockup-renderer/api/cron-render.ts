export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const authHeader = req.headers?.authorization || req.headers?.Authorization || "";

    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!process.env.CRON_SHARED_SECRET) {
      return res.status(500).json({ error: "Missing CRON_SHARED_SECRET" });
    }

    const base = process.env.RENDERER_BASE_URL || "https://mockup-renderer-psi.vercel.app";

    const r = await fetch(`${base}/api/render-agent-mockup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": process.env.CRON_SHARED_SECRET,
        "Authorization": `Bearer ${process.env.CRON_SECRET}`
      },
      body: JSON.stringify({ limit: 10 })
    });

    const text = await r.text();
    return res.status(r.status).send(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown cron-render error";
    return res.status(500).json({ ok: false, stage: "cron_render", error: message });
  }
}
