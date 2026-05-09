import type { VercelRequest } from "@vercel/node";
import { env } from "./env";

export function isAuthorizedCron(req: VercelRequest): boolean {
  const manualSecret = req.headers["x-cron-secret"];
  const authHeader = req.headers.authorization;

  return (
    manualSecret === env.cronSharedSecret ||
    authHeader === `Bearer ${env.cronSharedSecret}`
  );
}
