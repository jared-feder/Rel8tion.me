export default async function handler(req: any, res: any) {
  return res.status(200).json({
    ok: true,
    method: req?.method || null,
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    hasCronSecret: !!process.env.CRON_SHARED_SECRET
  });
}