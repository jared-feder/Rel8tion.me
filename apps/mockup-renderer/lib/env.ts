function read(name: string, fallback = ""): string {
  const value = process.env[name];
  return value ?? fallback;
}

export const env = {
  supabaseUrl: read("SUPABASE_URL"),
  supabaseServiceRoleKey: read("SUPABASE_SERVICE_ROLE_KEY"),
  storageBucket: read("SUPABASE_STORAGE_BUCKET", "agent-mockups"),
  publicBaseUrl: read("REL8TION_PUBLIC_BASE_URL", "https://rel8tion.me"),
  generateFunctionUrl: read("GENERATE_FUNCTION_URL"),
  twilioSendFunctionUrl: read("TWILIO_SEND_FUNCTION_URL"),
  cronSharedSecret: read("CRON_SHARED_SECRET")
};

export function getMissingEnvVars(names: string[]): string[] {
  return names.filter((name) => !process.env[name]);
}
