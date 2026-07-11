import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/admin-auth'

const DEFAULT_REL8TION_SUPABASE_URL = 'https://nicanqrfqlbnlmnoernb.supabase.co'
const BUCKET = 'agent-website-assets'
const MAX_FILE_SIZE = 8 * 1024 * 1024

function isValidHttpUrl(value?: string) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function getAdminClient() {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.REL8TION_SUPABASE_URL
  const supabaseUrl = isValidHttpUrl(configuredUrl) ? configuredUrl : DEFAULT_REL8TION_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase credentials')
  }

  return createClient(supabaseUrl, supabaseServiceKey)
}

function safeName(value: string) {
  const clean = value.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/(^-|-$)/g, '')
  return clean || 'image'
}

async function ensurePublicBucket(supabase: ReturnType<typeof createClient>) {
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_FILE_SIZE,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  })

  if (error && !/already exists/i.test(error.message)) {
    throw error
  }

  await supabase.storage.updateBucket(BUCKET, { public: true }).catch(() => null)
}

export async function POST(request: NextRequest) {
  try {
    const unauthorized = requireAdminSession(request)
    if (unauthorized) return unauthorized

    const formData = await request.formData()
    const file = formData.get('file')
    const kind = String(formData.get('kind') || 'image').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'image'

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Image file is required.' }, { status: 400 })
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image uploads are supported.' }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Image must be smaller than 8 MB.' }, { status: 400 })
    }

    const supabase = getAdminClient()
    await ensurePublicBucket(supabase)

    const ext = file.name.includes('.') ? file.name.split('.').pop() : file.type.split('/').pop()
    const objectPath = `${kind}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName(file.name || `upload.${ext}`)}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, buffer, {
        contentType: file.type,
        cacheControl: '31536000',
        upsert: false,
      })

    if (error) throw error

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(objectPath)
    return NextResponse.json({ url: data.publicUrl, path: objectPath })
  } catch (error) {
    console.error('Asset upload failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Asset upload failed.' },
      { status: 500 },
    )
  }
}
