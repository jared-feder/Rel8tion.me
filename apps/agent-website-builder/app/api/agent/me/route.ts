import { NextResponse } from 'next/server'
import { getAgentWebsiteForSession } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase/admin'

async function countRows(table: string, siteId: string) {
  const supabase = createAdminClient()
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('agent_website_id', siteId)

  if (error) throw error
  return count || 0
}

export async function GET() {
  try {
    const access = await getAgentWebsiteForSession()
    if (access.error || !access.site) {
      return NextResponse.json({ error: access.error || 'Agent session required.' }, { status: access.status || 401 })
    }

    const [leads, listings, aiMedia] = await Promise.all([
      countRows('contact_submissions', access.site.id).catch(() => 0),
      countRows('agent_website_listings', access.site.id).catch(() => 0),
      countRows('agent_website_ai_media', access.site.id).catch(() => 0),
    ])

    return NextResponse.json({
      user: {
        id: access.user?.id,
        email: access.user?.email,
      },
      site: access.site,
      summary: {
        leads,
        listings,
        aiMedia,
      },
    })
  } catch (error) {
    console.error('[agent me] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load agent dashboard.' },
      { status: 500 },
    )
  }
}
