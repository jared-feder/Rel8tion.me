import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminSession } from '@/lib/admin-auth'

export async function GET(request: NextRequest) {
  try {
    const unauthorized = requireAdminSession(request)
    if (unauthorized) return unauthorized

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('contact_submissions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error

    return NextResponse.json({ leads: data || [] })
  } catch (error) {
    console.error('[builder admin leads] Error:', error)
    return NextResponse.json({
      leads: [],
      error: error instanceof Error ? error.message : 'Unable to load leads.',
    }, { status: 500 })
  }
}
