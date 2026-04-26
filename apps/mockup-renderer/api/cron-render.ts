import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAuthorizedCron } from "../lib/cron-auth";
import { env } from "../lib/env";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!isAuthorizedCron(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const base = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
  const r = await fetch(`${base}/api/render-agent-mockup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cron-secret": env.cronSharedSecret
    },
    body: JSON.stringify({ limit: 10 })
  });

  const text = await r.text();
  return res.status(r.status).send(text);
}
