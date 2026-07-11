import { NextRequest, NextResponse } from 'next/server'
import { demoAgent, demoListings, demoTestimonials } from '@/lib/demo-data'

// GET /api/agent/[agentId] - Get agent data
// This endpoint will be called by the public site to fetch agent data
// In production, replace demo data with REL8TION API calls

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params

    // TODO: Replace with REL8TION API call
    // const agent = await getAgent(agentId)
    
    // For demo purposes, return demo data
    if (agentId === 'demo' || agentId === 'demo-agent-001') {
      const agent = {
        ...demoAgent,
        testimonials: demoTestimonials,
      }

      return NextResponse.json({
        success: true,
        data: agent,
      })
    }

    return NextResponse.json(
      { success: false, error: 'Agent not found' },
      { status: 404 }
    )
  } catch (error) {
    console.error('[API] Error fetching agent:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
