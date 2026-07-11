import { NextRequest, NextResponse } from 'next/server'
import { getAgentWebsiteForSession } from '@/lib/agent-auth'
import { openAiJson, uploadAiMedia } from '@/lib/ai-media'
import { requireAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

function requireOpenAiKey() {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('Missing OPENAI_API_KEY.')
  return key
}

async function resolveAiMediaAccess(request: NextRequest) {
  const adminUnauthorized = requireAdminSession(request)
  if (!adminUnauthorized) return { role: 'admin' as const, site: null, response: null }

  const agentAccess = await getAgentWebsiteForSession()
  if (agentAccess.error || !agentAccess.site) {
    return {
      role: 'agent' as const,
      site: null,
      response: NextResponse.json({ error: agentAccess.error || 'Agent session required.' }, { status: agentAccess.status || 401 }),
    }
  }

  return { role: 'agent' as const, site: agentAccess.site, response: null }
}

async function downloadVideo(openaiId: string) {
  const response = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(openaiId)}/content?variant=video`, {
    headers: { Authorization: `Bearer ${requireOpenAiKey()}` },
  })

  if (!response.ok) {
    const data = await openAiJson(response)
    throw new Error((data.error as { message?: string } | undefined)?.message || 'Unable to download completed video.')
  }

  return Buffer.from(await response.arrayBuffer())
}

async function tryDownloadVideo(openaiId: string) {
  try {
    return await downloadVideo(openaiId)
  } catch (error) {
    console.info('[ai media status] video content not ready', {
      openaiId,
      error: error instanceof Error ? error.message : 'Unable to download video.',
    })
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await resolveAiMediaAccess(request)
    if (access.response) return access.response

    const { id } = await request.json()
    const mediaId = String(id || '').trim()
    if (!mediaId) return NextResponse.json({ error: 'Media ID required.' }, { status: 400 })

    const supabase = createAdminClient()
    const { data: media, error: loadError } = await supabase
      .from('agent_website_ai_media')
      .select('*')
      .eq('id', mediaId)
      .maybeSingle()

    if (loadError) throw loadError
    if (!media?.openai_id) return NextResponse.json({ error: 'OpenAI video ID not found.' }, { status: 404 })
    if (access.role === 'agent' && media.agent_website_id !== access.site.id) {
      return NextResponse.json({ error: 'OpenAI video ID not found.' }, { status: 404 })
    }

    const statusResponse = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(media.openai_id)}`, {
      headers: { Authorization: `Bearer ${requireOpenAiKey()}` },
    })
    const openaiStatusRequestId = statusResponse.headers.get('x-request-id') || ''
    const statusData = await openAiJson(statusResponse)
    if (!statusResponse.ok) {
      throw new Error((statusData.error as { message?: string } | undefined)?.message || 'Unable to check video status.')
    }

    const status = String(statusData.status || media.status || 'queued')
    let resultUrl = media.result_url
    let errorMessage = media.error
    let effectiveStatus = status

    if (status === 'completed' && !resultUrl) {
      const videoBuffer = await downloadVideo(media.openai_id)
      const upload = await uploadAiMedia({
        buffer: videoBuffer,
        contentType: 'video/mp4',
        folder: 'videos',
        fileName: `${media.openai_id}.mp4`,
      })
      resultUrl = upload.url
    }

    if (status !== 'failed' && !resultUrl) {
      const videoBuffer = await tryDownloadVideo(media.openai_id)
      if (videoBuffer) {
        const upload = await uploadAiMedia({
          buffer: videoBuffer,
          contentType: 'video/mp4',
          folder: 'videos',
          fileName: `${media.openai_id}.mp4`,
        })
        resultUrl = upload.url
        effectiveStatus = 'completed'
      }
    }

    if (status === 'failed') {
      const typedError = statusData.error as { message?: string } | undefined
      errorMessage = typedError?.message || 'Video generation failed.'
    }

    const { data: updated, error: updateError } = await supabase
      .from('agent_website_ai_media')
      .update({
        status: effectiveStatus,
        result_url: resultUrl,
        error: errorMessage,
        metadata: {
          ...(media.metadata || {}),
          progress: statusData.progress ?? media.metadata?.progress ?? 0,
          openai_status: status,
          openai_status_request_id: openaiStatusRequestId || media.metadata?.openai_status_request_id || '',
          last_status_check: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', media.id)
      .select('*')
      .single()

    if (updateError) throw updateError
    return NextResponse.json({ media: updated })
  } catch (error) {
    console.error('[ai media status] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to check AI media status.' },
      { status: 500 },
    )
  }
}
