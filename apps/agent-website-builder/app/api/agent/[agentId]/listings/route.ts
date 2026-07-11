import { NextRequest, NextResponse } from 'next/server'
import { demoListings } from '@/lib/demo-data'

// GET /api/agent/[agentId]/listings - Get agent's listings
// This endpoint will be called by the public site to fetch listings
// In production, replace demo data with REL8TION API calls

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params
    const { searchParams } = new URL(request.url)
    
    const status = searchParams.get('status')
    const limit = searchParams.get('limit')

    // TODO: Replace with REL8TION API call
    // const listings = await getListings(agentId)

    // For demo purposes, return demo data
    if (agentId === 'demo' || agentId === 'demo-agent-001') {
      let listings = [...demoListings]

      // Filter by status if provided
      if (status && status !== 'all') {
        listings = listings.filter((l) => l.status === status)
      }

      // Limit results if provided
      if (limit) {
        listings = listings.slice(0, parseInt(limit))
      }

      return NextResponse.json({
        success: true,
        data: listings,
        total: listings.length,
      })
    }

    return NextResponse.json(
      { success: false, error: 'Agent not found' },
      { status: 404 }
    )
  } catch (error) {
    console.error('[API] Error fetching listings:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
