import { createClient } from '@supabase/supabase-js'

const DEFAULT_REL8TION_SUPABASE_URL = 'https://nicanqrfqlbnlmnoernb.supabase.co'

function isValidHttpUrl(value?: string) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

// Admin client for database operations (server-side only)
export function createAdminClient() {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.REL8TION_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseUrl = isValidHttpUrl(configuredUrl) ? configuredUrl : DEFAULT_REL8TION_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase admin credentials')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
