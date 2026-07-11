import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const DEFAULT_REL8TION_SUPABASE_URL = 'https://nicanqrfqlbnlmnoernb.supabase.co'
const DEFAULT_REL8TION_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pY2FucXJmcWxibmxtbm9lcm5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNjEwNzcsImV4cCI6MjA3NjczNzA3N30.FNE_8qVT4BZBrgdhYqvdwEzeCdbtUzBXndq_Us-WUjg'
const DEFAULT_AGENT_SITE_DOMAIN = 'my.rel8tion.me'

// Known system paths that should not be treated as agent slugs
const SYSTEM_PATHS = [
  '/admin',
  '/agent',
  '/api',
  '/auth',
  '/get-started',
  '/_next',
  '/favicon',
  '/images',
  '/icon',
]

function isValidHttpUrl(value?: string) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isSystemPath(pathname: string) {
  return SYSTEM_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  // Check if Supabase credentials are available
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.REL8TION_SUPABASE_URL
  const configuredKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.REL8TION_SUPABASE_ANON_KEY
  const supabaseUrl = isValidHttpUrl(configuredUrl) ? configuredUrl : DEFAULT_REL8TION_SUPABASE_URL
  const supabaseKey = configuredKey || DEFAULT_REL8TION_SUPABASE_ANON_KEY

  if (!isValidHttpUrl(supabaseUrl) || !supabaseKey) {
    // Supabase not configured yet, just pass through
    return supabaseResponse
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const hostname = request.headers.get('host') || ''
  
  // Check if this is a custom domain (not rel8tion.me or localhost)
  const isCustomDomain = !hostname.includes('rel8tion.me') && 
                         !hostname.includes('localhost') && 
                         !hostname.includes('vercel.app') &&
                         !hostname.includes('v0.dev')

  // Handle custom domain routing
  if (isCustomDomain && !isSystemPath(pathname)) {
    // Look up which agent website this domain belongs to
    const { data: site } = await supabase
      .from('agent_websites')
      .select('slug')
      .eq('custom_domain', hostname.replace('www.', ''))
      .single()
    
    if (site?.slug) {
      if (pathname === '/') {
        const url = request.nextUrl.clone()
        url.pathname = `/${site.slug}`
        return NextResponse.rewrite(url)
      }

      const pathSlug = pathname.split('/').filter(Boolean)[0]
      if (pathSlug && pathSlug !== site.slug) {
        const canonical = new URL(`${pathname}${request.nextUrl.search}`, `https://${DEFAULT_AGENT_SITE_DOMAIN}`)
        return NextResponse.redirect(canonical)
      }
    }
  }

  // Protect agent dashboard routes
  if (pathname.startsWith('/agent/dashboard') && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/agent/login'
    return NextResponse.redirect(url)
  }

  // Admin auth is handled client-side with localStorage

  return supabaseResponse
}
