import { createAdminClient } from '@/lib/supabase/admin'
import type { AiMediaMode } from '@/lib/ai-presets'

export const AI_MEDIA_BUCKET = 'agent-website-ai-media-v2'
const AI_MEDIA_BUCKET_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
const AI_MEDIA_BUCKET_SIZE_LIMIT = '100MB'

export type { AiMediaMode }

export function cleanText(value?: FormDataEntryValue | null) {
  return String(value || '').trim()
}

export function cleanPromptField(value?: FormDataEntryValue | null, maxLength = 140) {
  return cleanText(value)
    .replace(/[^a-zA-Z0-9\s.,#&'\/-]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, maxLength)
}

export function safeName(value: string) {
  const clean = value.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/(^-|-$)/g, '')
  return clean || 'media'
}

export function buildPoweredByCaption({
  agentName,
  propertyAddress,
  extra,
}: {
  agentName: string
  propertyAddress: string
  extra?: string
}) {
  const subject = propertyAddress || agentName || 'this listing'
  return [
    `Fresh look at ${subject}.`,
    extra || 'DM for details, private tour options, or the full listing story.',
    'Powered by rel8tion.me',
  ].join('\n')
}

export function buildStagingPrompt({
  roomType,
  style,
  propertyAddress,
}: {
  roomType: string
  style: string
  propertyAddress: string
}) {
  return [
    `Virtually stage this real estate ${roomType || 'room'} photo in a ${style || 'modern warm'} style.`,
    'Keep the room architecture, windows, walls, floors, scale, and camera perspective realistic.',
    'Add tasteful furniture, lighting, rugs, art, and decor suitable for a listing presentation.',
    'Do not alter permanent fixtures in a misleading way and do not add people.',
    propertyAddress ? `Property context: ${propertyAddress}.` : '',
  ].filter(Boolean).join(' ')
}

export function buildHeadshotPrompt({
  agentName,
  look,
  background,
}: {
  agentName: string
  look: string
  background: string
}) {
  return [
    'Create a realistic professional real estate agent headshot from the uploaded image.',
    agentName ? `Subject name/context: ${agentName}.` : '',
    `Selected look: ${look}.`,
    `Selected background: ${background}.`,
    'Preserve the same person and core identity, including facial structure, skin tone, age range, hair, and natural expression.',
    'Improve lighting, framing, wardrobe polish, and background quality for a trustworthy agent profile photo.',
    'Use a chest-up portrait crop with eye contact, realistic skin texture, and natural professional retouching.',
    'Do not add text, logos, badges, extra people, hands, phones, or misleading body/age changes.',
  ].filter(Boolean).join(' ')
}

export function buildVideoPrompt({
  propertyAddress,
  agentName,
  style,
  postType,
  sourceImageCount = 1,
}: {
  propertyAddress: string
  agentName: string
  style: string
  postType: string
  sourceImageCount?: number
}) {
  return [
    'Create a short vertical real estate social media walkthrough video from the uploaded property photo reference.',
    sourceImageCount > 1
      ? `The reference image is a storyboard made from ${sourceImageCount} listing photos; treat each panel as an ordered property view and turn them into a seamless walkthrough-style listing tour. Do not show the storyboard grid or collage in the final video.`
      : 'Use the reference image as the opening frame and create a polished walkthrough-style listing reel from it.',
    `Post type: ${postType}.`,
    `Visual style: ${style}.`,
    'Make it agent-post-ready for Instagram Reels, TikTok, Facebook Reels, and YouTube Shorts: premium, confident, and emotionally inviting rather than frantic.',
    'Use smooth room-to-room transitions, push-in motion, gentle pans, and enough breathing room for viewers to understand each space.',
    'Use short tasteful on-screen text callouts only, no dense text, no fake prices, no fake dates, and no fake listing facts.',
    'All on-screen text must be high contrast and easy to read: white or near-white type on navy, black, or dark translucent panels. Do not use pale yellow, light cyan, beige, thin script fonts, or low-contrast text over bright footage.',
    'Do not include spoken voiceover, narration, dialogue, or rushed speech. Use instrumental music, light ambient sound, or no prominent audio.',
    propertyAddress ? `Feature this listing/location text: ${propertyAddress}.` : '',
    agentName ? `Agent: ${agentName}.` : '',
    'The reference image includes an explicit brand end-card panel with the exact words "Powered by REL8TION" and "rel8tion.me"; include a final brand card using that exact wording. Do not misspell REL8TION and do not omit the brand card.',
    'End with a clean, polished call-to-action card for the agent, such as "DM for a private tour" or "Visit the open house", then show the REL8TION brand card.',
    'Keep the property visually truthful; do not invent materially different rooms, views, or structural features.',
  ].filter(Boolean).join(' ')
}

export async function ensureAiMediaBucket() {
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage.getBucket(AI_MEDIA_BUCKET)

  if (data && !error) return supabase

  const missingBucket =
    error &&
    (error.message.toLowerCase().includes('not found') ||
      error.message.toLowerCase().includes('does not exist') ||
      ('statusCode' in error && Number(error.statusCode) === 404))

  if (!missingBucket && error) throw error

  const { error: createError } = await supabase.storage.createBucket(AI_MEDIA_BUCKET, {
    public: true,
    allowedMimeTypes: AI_MEDIA_BUCKET_MIME_TYPES,
    fileSizeLimit: AI_MEDIA_BUCKET_SIZE_LIMIT,
  })

  if (createError && !createError.message.toLowerCase().includes('already exists')) {
    throw createError
  }

  return supabase
}

export async function uploadAiMedia({
  buffer,
  contentType,
  folder,
  fileName,
}: {
  buffer: Buffer
  contentType: string
  folder: string
  fileName: string
}) {
  const supabase = await ensureAiMediaBucket()
  const objectPath = `${folder}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName(fileName)}`
  const sizeKb = Math.round(buffer.length / 1024)
  console.info(`[ai media] Uploading ${AI_MEDIA_BUCKET}/${objectPath} (${sizeKb} KB, ${contentType})`)

  const { error } = await supabase.storage
    .from(AI_MEDIA_BUCKET)
    .upload(objectPath, buffer, {
      contentType,
      cacheControl: '31536000',
      upsert: false,
    })

  if (error) {
    throw new Error(`${error.message} (${folder}/${fileName}, ${sizeKb} KB, ${contentType})`)
  }

  const { data } = supabase.storage.from(AI_MEDIA_BUCKET).getPublicUrl(objectPath)
  return { supabase, url: data.publicUrl, path: objectPath }
}

export async function openAiJson(response: Response) {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return { error: { message: text || response.statusText } }
  }
}
