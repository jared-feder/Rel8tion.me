import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

function normalizeEmail(value?: string | null) {
  return String(value || '').trim().toLowerCase()
}

export async function getAgentWebsiteForSession() {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  const email = normalizeEmail(user?.email)
  if (userError || !user || !email) {
    return { user: null, site: null, error: 'Agent session required.', status: 401 }
  }

  const admin = createAdminClient()
  const { data: sites, error } = await admin
    .from('agent_websites')
    .select('*')
    .ilike('email', email)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (error) throw error
  const site = sites?.[0] || null
  if (!site) {
    return { user, site: null, error: 'No agent website is connected to this email.', status: 403 }
  }

  return { user, site, error: null, status: 200 }
}
