function must(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  supabaseUrl: must("SUPABASE_URL"),
  supabaseServiceRoleKey: must("SUPABASE_SERVICE_ROLE_KEY"),
  storageBucket: process.env.SUPABASE_STORAGE_BUCKET || "agent-mockups",
  publicBaseUrl: process.env.REL8TION_PUBLIC_BASE_URL || "https://rel8tion.me",
  generateFunctionUrl: must("GENERATE_FUNCTION_URL"),
  twilioSendFunctionUrl: must("TWILIO_SEND_FUNCTION_URL"),
  cronSharedSecret: must("CRON_SHARED_SECRET")
};