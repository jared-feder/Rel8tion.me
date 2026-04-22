export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const authHeader = req.headers?.authorization || req.headers?.Authorization || "";

    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!process.env.GENERATE_FUNCTION_URL) {
      return res.status(500).json({ error: "Missing GENERATE_FUNCTION_URL" });
    }

    const r = await fetch(process.env.GENERATE_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 25 })
    });

    const text = await r.text();
    return res.status(r.status).send(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown cron-generate error";
    return res.status(500).json({ ok: false, stage: "cron_generate", error: message });
  }
}
