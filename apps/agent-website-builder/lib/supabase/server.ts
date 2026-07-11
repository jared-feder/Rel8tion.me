import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const DEFAULT_REL8TION_SUPABASE_URL = 'https://nicanqrfqlbnlmnoernb.supabase.co'
const DEFAULT_REL8TION_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJuaWNhbnFyZnFsYm5sbW5vZXJuYiIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzYxMTYxMDc3LCJleHAiOjIwNzY3MzcwNzd9.FNE_8qVT4BZBrgdhYqvdwEzeCdbtUzBXndq_Us-WUjg'

function isValidHttpUrl(value?: string) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export async function createClient() {
  const cookieStore = await cookies()
  
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.REL8TION_SUPABASE_URL
  const supabaseUrl = isValidHttpUrl(configuredUrl) ? configuredUrl : DEFAULT_REL8TION_SUPABASE_URL
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.REL8TION_SUPABASE_ANON_KEY ||
    DEFAULT_REL8TION_SUPABASE_ANON_KEY
  
  if (!supabaseUrl || !supabaseKey) {
    const missingConfigResult = () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } })
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      not: () => chain,
      single: missingConfigResult,
      limit: () => missingConfigResult(),
    }

    return {
      from: () => chain,
      auth: {
        getUser: () => Promise.resolve({ data: { user: null }, error: null })
      }
    } as unknown as ReturnType<typeof createServerClient>
  }

  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // The "setAll" method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    },
  )
}
