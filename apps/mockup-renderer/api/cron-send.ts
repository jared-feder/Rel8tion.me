export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const authHeader = req.headers?.authorization || req.headers?.Authorization || "";

    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!process.env.TWILIO_SEND_FUNCTION_URL) {
      return res.status(500).json({ error: "Missing TWILIO_SEND_FUNCTION_URL" });
    }

    const r = await fetch(process.env.TWILIO_SEND_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 25, mode: "approved_only" })
    });

    const text = await r.text();
    return res.status(r.status).send(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown cron-send error";
    return res.status(500).json({ ok: false, stage: "cron_send", error: message });
  }
}
