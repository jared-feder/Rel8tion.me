import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "../lib/env";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (req.headers["x-cron-secret"] !== env.cronSharedSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const r = await fetch(env.generateFunctionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 25 })
  });

  const text = await r.text();
  return res.status(r.status).send(text);
}