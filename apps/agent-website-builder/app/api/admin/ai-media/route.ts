import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import {
  buildHeadshotPrompt,
  buildPoweredByCaption,
  buildStagingPrompt,
  buildVideoPrompt,
  cleanPromptField,
  cleanText,
  openAiJson,
  uploadAiMedia,
} from '@/lib/ai-media'
import {
  AUTO_REEL_POST_PRESETS,
  AUTO_REEL_STYLE_PRESETS,
  HEADSHOT_BACKGROUND_PRESETS,
  HEADSHOT_LOOK_PRESETS,
  STAGING_ROOM_PRESETS,
  STAGING_STYLE_PRESETS,
  isAiMediaMode,
  resolvePreset,
} from '@/lib/ai-presets'
import { getAgentWebsiteForSession } from '@/lib/agent-auth'
import { requireAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const MAX_SOURCE_SIZE = 25 * 1024 * 1024
const MAX_VIDEO_SOURCE_IMAGES = 6
const VIDEO_REFERENCE_CONTENT_TYPE = 'image/jpeg'
const STORAGE_IMAGE_TARGET_BYTES = 350 * 1024
const DEFAULT_VIDEO_SECONDS = '12'

function requireOpenAiKey() {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('Missing OPENAI_API_KEY.')
  return key
}

function assertImageFile(file: FormDataEntryValue | null): asserts file is File {
  if (!(file instanceof File)) throw new Error('Upload an image first.')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Upload a JPG, PNG, or WebP image.')
  }
  if (file.size > MAX_SOURCE_SIZE) throw new Error('Image must be smaller than 25 MB.')
}

function extensionForImageType(contentType: string) {
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/webp') return 'webp'
  return 'jpg'
}

function sourceFileName(file: File, fallbackBase: string) {
  const name = String(file.name || '').trim()
  if (/\.(jpe?g|png|webp)$/i.test(name)) return name
  return `${fallbackBase}.${extensionForImageType(file.type)}`
}

function videoReferenceFileName(file: File) {
  const name = String(file.name || '').trim().replace(/\.[^.]+$/, '')
  return `${name || 'autoreel-reference'}.jpg`
}

function previewFileName(file: File, index: number) {
  const name = String(file.name || '').trim().replace(/\.[^.]+$/, '')
  return `${name || `autoreel-source-${index + 1}`}-preview.jpg`
}

function getVideoSize() {
  const rawSize = process.env.OPENAI_VIDEO_SIZE || '720x1280'
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(rawSize)
  if (!match) throw new Error('OPENAI_VIDEO_SIZE must be formatted like 720x1280.')
  return {
    width: Number(match[1]),
    height: Number(match[2]),
    value: rawSize,
  }
}

function brandFooterSvg(width: number, height: number) {
  const footerHeight = Math.max(78, Math.round(height * 0.07))
  const y = height - footerHeight
  const logoSize = Math.round(footerHeight * 0.44)
  const logoX = Math.round(width * 0.06)
  const logoY = y + Math.round((footerHeight - logoSize) / 2)
  const textX = logoX + logoSize + 14
  const titleSize = Math.max(22, Math.round(footerHeight * 0.3))
  const urlSize = Math.max(13, Math.round(footerHeight * 0.17))

  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="footer" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#061226" stop-opacity="0.88"/>
          <stop offset="1" stop-color="#123f88" stop-opacity="0.72"/>
        </linearGradient>
      </defs>
      <rect x="0" y="${y}" width="${width}" height="${footerHeight}" fill="url(#footer)"/>
      <circle cx="${logoX + logoSize / 2}" cy="${logoY + logoSize / 2}" r="${logoSize / 2}" fill="#ffffff" opacity="0.96"/>
      <text x="${logoX + logoSize / 2}" y="${logoY + logoSize * 0.66}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(logoSize * 0.5)}" font-weight="900" fill="#145cf2">R</text>
      <text x="${textX}" y="${y + Math.round(footerHeight * 0.44)}" font-family="Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="900" letter-spacing="1.4" fill="#ffffff">Powered by REL8TION</text>
      <text x="${textX}" y="${y + Math.round(footerHeight * 0.72)}" font-family="Arial, Helvetica, sans-serif" font-size="${urlSize}" font-weight="700" fill="#dff7ff">rel8tion.me</text>
    </svg>
  `)
}

function brandEndCardSvg(width: number, height: number) {
  const titleSize = Math.max(28, Math.round(height * 0.11))
  const urlSize = Math.max(16, Math.round(height * 0.052))
  const smallSize = Math.max(13, Math.round(height * 0.035))
  const centerX = Math.round(width / 2)
  const centerY = Math.round(height / 2)

  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#061226"/>
          <stop offset="0.48" stop-color="#145cf2"/>
          <stop offset="1" stop-color="#26bde2"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)"/>
      <rect x="${Math.round(width * 0.07)}" y="${Math.round(height * 0.1)}" width="${Math.round(width * 0.86)}" height="${Math.round(height * 0.8)}" rx="22" fill="#061226" opacity="0.54"/>
      <text x="${centerX}" y="${centerY - Math.round(height * 0.16)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${smallSize}" font-weight="900" letter-spacing="4" fill="#dff7ff">POWERED BY</text>
      <text x="${centerX}" y="${centerY + Math.round(height * 0.02)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="900" letter-spacing="2" fill="#ffffff">REL8TION</text>
      <text x="${centerX}" y="${centerY + Math.round(height * 0.15)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${urlSize}" font-weight="900" fill="#ffffff">rel8tion.me</text>
      <text x="${centerX}" y="${centerY + Math.round(height * 0.28)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${smallSize}" font-weight="800" fill="#e8fbff">Smart open house tools for modern agents</text>
    </svg>
  `)
}

async function addBrandFooter(buffer: Buffer, width: number, height: number) {
  return sharp(buffer)
    .composite([{ input: brandFooterSvg(width, height), left: 0, top: 0 }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()
}

async function makeBrandEndCard(width: number, height: number) {
  return sharp(brandEndCardSvg(width, height))
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()
}

function getImageFiles(formData: FormData) {
  const files = formData.getAll('images').filter((entry): entry is File => entry instanceof File && entry.size > 0)
  const fallback = formData.get('image')
  if (!files.length && fallback instanceof File && fallback.size > 0) files.push(fallback)
  return files
}

function assertImageFiles(files: File[], maxFiles = 1) {
  if (!files.length) throw new Error('Upload an image first.')
  if (files.length > maxFiles) throw new Error(`Upload up to ${maxFiles} images.`)
  files.forEach((file) => assertImageFile(file))
}

async function makeSingleVideoReference({
  buffer,
  width,
  height,
}: {
  buffer: Buffer
  width: number
  height: number
}) {
  const background = await sharp(buffer)
    .rotate()
    .resize(width, height, { fit: 'cover', position: 'attention' })
    .blur(24)
    .modulate({ brightness: 0.72, saturation: 0.9 })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer()

  const foreground = await sharp(buffer)
    .rotate()
    .resize(width, height, { fit: 'inside', withoutEnlargement: false })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()

  return sharp(background)
    .composite([{ input: foreground, gravity: 'center' }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()
}

function collageCells(count: number, width: number, height: number) {
  if (count <= 2) {
    const cellHeight = Math.floor(height / count)
    return Array.from({ length: count }, (_, index) => ({
      left: 0,
      top: index * cellHeight,
      width,
      height: index === count - 1 ? height - index * cellHeight : cellHeight,
    }))
  }

  const rows = count <= 4 ? 2 : 3
  const cols = 2
  const cellWidth = Math.floor(width / cols)
  const cellHeight = Math.floor(height / rows)
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / cols)
    const col = index % cols
    return {
      left: col * cellWidth,
      top: row * cellHeight,
      width: col === cols - 1 ? width - col * cellWidth : cellWidth,
      height: row === rows - 1 ? height - row * cellHeight : cellHeight,
    }
  })
}

async function makeVideoReferenceImage(sourceBuffers: Buffer[]) {
  const { width, height, value } = getVideoSize()
  const usableBuffers = sourceBuffers.slice(0, MAX_VIDEO_SOURCE_IMAGES)

  if (usableBuffers.length === 1) {
    return {
      buffer: await addBrandFooter(await makeSingleVideoReference({ buffer: usableBuffers[0], width, height }), width, height),
      width,
      height,
      size: value,
      strategy: 'single_image_letterboxed_branded',
      sourceCount: 1,
    }
  }

  const includeBrandCard = usableBuffers.length > 1
  const storyboardItemCount = includeBrandCard ? Math.min(MAX_VIDEO_SOURCE_IMAGES, usableBuffers.length + 1) : usableBuffers.length
  const imagePanelCount = includeBrandCard ? storyboardItemCount - 1 : storyboardItemCount
  const storyboardBuffers = usableBuffers.slice(0, imagePanelCount)
  const cells = collageCells(storyboardItemCount, width, height)
  const imageComposites = await Promise.all(
    storyboardBuffers.map(async (buffer, index) => {
      const cell = cells[index]
      const input = await sharp(buffer)
        .rotate()
        .resize(cell.width, cell.height, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer()
      return { input, left: cell.left, top: cell.top }
    }),
  )
  const brandCell = includeBrandCard ? cells[storyboardItemCount - 1] : null
  const composites = [
    ...imageComposites,
    ...(brandCell ? [{
      input: await sharp(await makeBrandEndCard(width, height))
        .resize(brandCell.width, brandCell.height, { fit: 'cover' })
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer(),
      left: brandCell.left,
      top: brandCell.top,
    }] : []),
  ]

  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#111827',
    },
  })
    .composite(composites)
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()

  return {
    buffer: await addBrandFooter(buffer, width, height),
    width,
    height,
    size: value,
    strategy: 'multi_image_storyboard_with_brand_card',
    sourceCount: storyboardBuffers.length,
  }
}

async function makeStoragePreview(buffer: Buffer) {
  return makeStorageJpeg(buffer, { maxDimension: 1200 })
}

async function makeOpenAiInputJpeg(buffer: Buffer) {
  return sharp(buffer)
    .rotate()
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer()
}

async function makeStorageJpeg(buffer: Buffer, { maxDimension = 1400 }: { maxDimension?: number } = {}) {
  const dimensions = [maxDimension, 1200, 1000, 820, 680, 520, 420].filter((value, index, values) => value > 0 && values.indexOf(value) === index)
  const qualities = [76, 68, 60, 52, 44, 36, 30]

  let smallest: Buffer | null = null
  for (const dimension of dimensions) {
    for (const quality of qualities) {
      const candidate = await sharp(buffer)
        .rotate()
        .resize(dimension, dimension, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer()
      if (!smallest || candidate.length < smallest.length) smallest = candidate
      if (candidate.length <= STORAGE_IMAGE_TARGET_BYTES) return candidate
    }
  }

  return smallest || buffer
}

async function uploadOpenAiInputImage({
  buffer,
  contentType,
  fileName,
}: {
  buffer: Buffer
  contentType: string
  fileName: string
}) {
  const form = new FormData()
  form.append('purpose', 'vision')
  form.append('file', new Blob([buffer], { type: contentType }), fileName)

  const response = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireOpenAiKey()}` },
    body: form,
  })

  const data = await openAiJson(response)
  if (!response.ok) throw new Error((data.error as { message?: string } | undefined)?.message || 'OpenAI image upload failed.')

  const fileId = typeof data.id === 'string' ? data.id : ''
  if (!fileId) throw new Error('OpenAI did not return an input image file id.')
  return fileId
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

function extractImageBase64(data: Record<string, unknown>) {
  const output = Array.isArray(data.output) ? data.output : []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const typed = item as Record<string, unknown>
    if (typed.type === 'image_generation_call' && typeof typed.result === 'string') {
      return { imageBase64: typed.result, revisedPrompt: String(typed.revised_prompt || '') }
    }
  }
  return { imageBase64: '', revisedPrompt: '' }
}

async function createAgentHeadshot({
  file,
  agentWebsiteId,
  agentName,
  look,
  background,
}: {
  file: File
  agentWebsiteId: string
  agentName: string
  look: { key: string; label: string; prompt: string }
  background: { key: string; label: string; prompt: string }
}) {
  const sourceBuffer = Buffer.from(await file.arrayBuffer())
  const openAiInputBuffer = await makeOpenAiInputJpeg(sourceBuffer)
  const sourcePreviewBuffer = await makeStoragePreview(sourceBuffer)
  const openAiSourceFileId = await uploadOpenAiInputImage({
    buffer: openAiInputBuffer,
    contentType: VIDEO_REFERENCE_CONTENT_TYPE,
    fileName: 'agent-headshot-source.jpg',
  })
  const { supabase, url: sourceUrl } = await uploadAiMedia({
    buffer: sourcePreviewBuffer,
    contentType: VIDEO_REFERENCE_CONTENT_TYPE,
    folder: 'sources',
    fileName: previewFileName(file, 0),
  })

  const prompt = buildHeadshotPrompt({
    agentName,
    look: `${look.label}: ${look.prompt}`,
    background: `${background.label}: ${background.prompt}`,
  })

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireOpenAiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_RESPONSES_MODEL || 'gpt-5.5',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', file_id: openAiSourceFileId },
          ],
        },
      ],
      tools: [{ type: 'image_generation' }],
    }),
  })

  const data = await openAiJson(response)
  if (!response.ok) throw new Error((data.error as { message?: string } | undefined)?.message || 'OpenAI headshot generation failed.')

  const { imageBase64, revisedPrompt } = extractImageBase64(data)
  if (!imageBase64) throw new Error('OpenAI did not return a generated headshot.')

  const generatedBuffer = Buffer.from(imageBase64, 'base64')
  const resultBuffer = await makeStorageJpeg(generatedBuffer, { maxDimension: 1400 })
  const { url: resultUrl } = await uploadAiMedia({
    buffer: resultBuffer,
    contentType: VIDEO_REFERENCE_CONTENT_TYPE,
    folder: 'headshots',
    fileName: 'agent-headshot.jpg',
  })

  const caption = [
    `${agentName || 'Agent'} professional headshot concept.`,
    'Powered by rel8tion.me',
  ].join('\n')

  const { data: media, error } = await supabase
    .from('agent_website_ai_media')
    .insert({
      agent_website_id: agentWebsiteId || null,
      media_type: 'agent_headshot',
      status: 'completed',
      source_url: sourceUrl,
      result_url: resultUrl,
      prompt,
      caption,
      metadata: {
        look: look.key,
        look_label: look.label,
        background: background.key,
        background_label: background.label,
        openai_source_file_id: openAiSourceFileId,
        revisedPrompt,
      },
    })
    .select('*')
    .single()

  if (error) throw error
  return media
}

async function createStagingImage({
  file,
  agentWebsiteId,
  agentName,
  propertyAddress,
  roomType,
  style,
}: {
  file: File
  agentWebsiteId: string
  agentName: string
  propertyAddress: string
  roomType: string
  style: string
}) {
  const sourceBuffer = Buffer.from(await file.arrayBuffer())
  const openAiInputBuffer = await makeOpenAiInputJpeg(sourceBuffer)
  const sourcePreviewBuffer = await makeStoragePreview(sourceBuffer)
  const openAiSourceFileId = await uploadOpenAiInputImage({
    buffer: openAiInputBuffer,
    contentType: VIDEO_REFERENCE_CONTENT_TYPE,
    fileName: 'source-image.jpg',
  })
  const { supabase, url: sourceUrl } = await uploadAiMedia({
    buffer: sourcePreviewBuffer,
    contentType: VIDEO_REFERENCE_CONTENT_TYPE,
    folder: 'sources',
    fileName: previewFileName(file, 0),
  })

  const prompt = buildStagingPrompt({ roomType, style, propertyAddress })
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireOpenAiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_RESPONSES_MODEL || 'gpt-5.5',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', file_id: openAiSourceFileId },
          ],
        },
      ],
      tools: [{ type: 'image_generation' }],
    }),
  })

  const data = await openAiJson(response)
  if (!response.ok) throw new Error((data.error as { message?: string } | undefined)?.message || 'OpenAI image generation failed.')

  const { imageBase64, revisedPrompt } = extractImageBase64(data)
  if (!imageBase64) throw new Error('OpenAI did not return a generated image.')

  const generatedBuffer = Buffer.from(imageBase64, 'base64')
  const resultBuffer = await makeStorageJpeg(generatedBuffer, { maxDimension: 1400 })
  const { url: resultUrl } = await uploadAiMedia({
    buffer: resultBuffer,
    contentType: VIDEO_REFERENCE_CONTENT_TYPE,
    folder: 'staging',
    fileName: 'staged-room.jpg',
  })

  const caption = buildPoweredByCaption({
    agentName,
    propertyAddress,
    extra: 'Virtual staging concept for listing marketing.',
  })

  const { data: media, error } = await supabase
    .from('agent_website_ai_media')
    .insert({
      agent_website_id: agentWebsiteId || null,
      media_type: 'staging_image',
      status: 'completed',
      source_url: sourceUrl,
      result_url: resultUrl,
      prompt,
      caption,
      metadata: { roomType, style, openai_source_file_id: openAiSourceFileId, revisedPrompt },
    })
    .select('*')
    .single()

  if (error) throw error
  return media
}

async function createSocialVideo({
  files,
  agentWebsiteId,
  agentName,
  propertyAddress,
  postType,
  visualStyle,
}: {
  files: File[]
  agentWebsiteId: string
  agentName: string
  propertyAddress: string
  postType: { key: string; label: string; prompt: string; captionExtra?: string }
  visualStyle: { key: string; label: string; prompt: string }
}) {
  const sourceBuffers = await Promise.all(files.map(async (file) => Buffer.from(await file.arrayBuffer())))
  const reference = await makeVideoReferenceImage(sourceBuffers)
  const uploadedSources = []
  let supabase = createAdminClient()

  for (let index = 0; index < files.length; index += 1) {
    const previewBuffer = await makeStoragePreview(sourceBuffers[index])
    const upload = await uploadAiMedia({
      buffer: previewBuffer,
      contentType: VIDEO_REFERENCE_CONTENT_TYPE,
      folder: 'sources',
      fileName: previewFileName(files[index], index),
    })
    supabase = upload.supabase
    uploadedSources.push(upload.url)
  }

  const referenceUpload = await uploadAiMedia({
    buffer: await makeStorageJpeg(reference.buffer, { maxDimension: Math.max(reference.width, reference.height) }),
    contentType: VIDEO_REFERENCE_CONTENT_TYPE,
    folder: 'sources',
    fileName: videoReferenceFileName(files[0]),
  })
  supabase = referenceUpload.supabase

  const prompt = buildVideoPrompt({
    propertyAddress,
    agentName,
    postType: `${postType.label}: ${postType.prompt}`,
    style: `${visualStyle.label}: ${visualStyle.prompt}`,
    sourceImageCount: files.length,
  })
  const caption = buildPoweredByCaption({
    agentName,
    propertyAddress,
    extra: postType.captionExtra || 'Short-form listing video ready for social edits.',
  })

  const form = new FormData()
  form.append('model', process.env.OPENAI_VIDEO_MODEL || 'sora-2')
  form.append('prompt', prompt)
  form.append('size', reference.size)
  form.append('seconds', process.env.OPENAI_VIDEO_SECONDS || DEFAULT_VIDEO_SECONDS)
  form.append('input_reference', new Blob([reference.buffer], { type: VIDEO_REFERENCE_CONTENT_TYPE }), videoReferenceFileName(files[0]))

  const response = await fetch('https://api.openai.com/v1/videos', {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireOpenAiKey()}` },
    body: form,
  })
  const openaiCreateRequestId = response.headers.get('x-request-id') || ''
  const data = await openAiJson(response)
  if (!response.ok) throw new Error((data.error as { message?: string } | undefined)?.message || 'OpenAI video generation failed.')

  const status = String(data.status || 'queued')
  const { data: media, error } = await supabase
    .from('agent_website_ai_media')
    .insert({
      agent_website_id: agentWebsiteId || null,
      media_type: 'social_video',
      status,
      source_url: referenceUpload.url,
      openai_id: String(data.id || ''),
      prompt,
      caption,
      metadata: {
        postType: postType.key,
        postType_label: postType.label,
        visualStyle: visualStyle.key,
        visualStyle_label: visualStyle.label,
        model: data.model || process.env.OPENAI_VIDEO_MODEL || 'sora-2',
        size: data.size || reference.size,
        seconds: data.seconds || process.env.OPENAI_VIDEO_SECONDS || DEFAULT_VIDEO_SECONDS,
        progress: data.progress ?? 0,
        openai_create_request_id: openaiCreateRequestId,
        source_count: files.length,
        storyboard_source_count: reference.sourceCount,
        source_urls: uploadedSources,
        reference_url: referenceUpload.url,
        reference_strategy: reference.strategy,
        reference_size: reference.size,
        reference_width: reference.width,
        reference_height: reference.height,
      },
    })
    .select('*')
    .single()

  if (error) throw error
  return media
}

export async function GET(request: NextRequest) {
  try {
    const access = await resolveAiMediaAccess(request)
    if (access.response) return access.response

    const supabase = createAdminClient()
    let query = supabase
      .from('agent_website_ai_media')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30)

    if (access.role === 'agent') {
      query = query.eq('agent_website_id', access.site.id)
    }

    const { data, error } = await query

    if (error) throw error
    return NextResponse.json({ media: data || [] })
  } catch (error) {
    console.error('[ai media list] Error:', error)
    return NextResponse.json(
      { media: [], error: error instanceof Error ? error.message : 'Unable to load AI media.' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await resolveAiMediaAccess(request)
    if (access.response) return access.response

    const formData = await request.formData()
    const mode = cleanText(formData.get('mode'))
    if (!isAiMediaMode(mode)) {
      return NextResponse.json({ error: 'Choose a preset AI tool.' }, { status: 400 })
    }
    const imageFiles = getImageFiles(formData)
    assertImageFiles(imageFiles, mode === 'social_video' ? MAX_VIDEO_SOURCE_IMAGES : 1)
    const file = imageFiles[0]

    const agentWebsiteId = access.role === 'agent' ? access.site.id : cleanText(formData.get('agentWebsiteId'))
    const agentName = access.role === 'agent' ? cleanPromptField(access.site.name, 90) : cleanPromptField(formData.get('agentName'), 90)
    const propertyAddress = cleanPromptField(formData.get('propertyAddress'), 160)

    if (mode === 'agent_headshot') {
      const look = resolvePreset(HEADSHOT_LOOK_PRESETS, cleanText(formData.get('headshotLook')), 'modern_agent')
      const background = resolvePreset(HEADSHOT_BACKGROUND_PRESETS, cleanText(formData.get('headshotBackground')), 'soft_office')
      const media = await createAgentHeadshot({ file, agentWebsiteId, agentName, look, background })
      return NextResponse.json({ media })
    }

    if (mode === 'staging_image') {
      const style = resolvePreset(
        STAGING_STYLE_PRESETS,
        cleanText(formData.get('stagingStyle')) || cleanText(formData.get('style')),
        'bright_luxury',
      )
      const roomType = resolvePreset(
        STAGING_ROOM_PRESETS,
        cleanText(formData.get('roomType')),
        'living_room',
      )
      const media = await createStagingImage({
        file,
        agentWebsiteId,
        agentName,
        propertyAddress,
        roomType: roomType.prompt,
        style: `${style.label}: ${style.prompt}`,
      })
      return NextResponse.json({ media })
    }

    if (mode === 'social_video') {
      const postType = resolvePreset(AUTO_REEL_POST_PRESETS, cleanText(formData.get('videoPreset')), 'new_listing_teaser')
      const visualStyle = resolvePreset(
        AUTO_REEL_STYLE_PRESETS,
        cleanText(formData.get('videoStyle')) || cleanText(formData.get('style')),
        'bright_luxury',
      )
      const media = await createSocialVideo({ files: imageFiles, agentWebsiteId, agentName, propertyAddress, postType, visualStyle })
      return NextResponse.json({ media })
    }

    return NextResponse.json({ error: 'Choose a preset AI tool.' }, { status: 400 })
  } catch (error) {
    console.error('[ai media create] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create AI media.' },
      { status: 500 },
    )
  }
}
