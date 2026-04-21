export default async function handler(req: any, res: any) {
  try {
    const receivedSecret = req?.headers?.["x-cron-secret"] || null;

    return res.status(200).json({
      ok: true,
      method: req?.method || null,
      env: {
        hasSupabaseUrl: !!process.env.SUPABASE_URL,
        hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        hasCronSecret: !!process.env.CRON_SHARED_SECRET
      },
      secretMatches: !!(
        process.env.CRON_SHARED_SECRET &&
        receivedSecret === process.env.CRON_SHARED_SECRET
      )
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown diagnostic error";
    return res.status(500).json({ ok: false, error: message, stage: "diagnostic_handler" });
  }
}