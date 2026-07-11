import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { generateSlug, normalizeDomain } from '@/lib/builder'
import { requireAdminSession } from '@/lib/admin-auth'
import { createLocalSite, deleteLocalSite, readLocalSites, updateLocalSite } from '@/lib/local-sites-store'

const DEFAULT_REL8TION_SUPABASE_URL = 'https://nicanqrfqlbnlmnoernb.supabase.co'

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

function normalizeImageList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 8)
}

function normalizeTestimonials(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const source = item as Record<string, unknown>
      const text = String(source.text || '').trim()
      const clientName = String(source.clientName || '').trim()
      if (!text || !clientName) return null
      const rating = Math.max(1, Math.min(5, Number(source.rating || 5)))

      return {
        id: String(source.id || crypto.randomUUID?.() || `testimonial-${index + 1}`),
        clientName,
        text,
        rating: Number.isFinite(rating) ? rating : 5,
        date: String(source.date || new Date().toISOString()),
        propertyType: String(source.propertyType || '').trim(),
      }
    })
    .filter(Boolean)
    .slice(0, 9)
}

// GET all agent websites
export async function GET(request: NextRequest) {
  try {
    const unauthorized = requireAdminSession(request)
    if (unauthorized) return unauthorized

    const supabase = getAdminClient()
    
    const { data, error } = await supabase
      .from('agent_websites')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (error) throw error
    
    const sites = data || []
    const published = sites.filter((site) => site.status === 'published').length
    const pendingDns = sites.filter((site) => site.status === 'pending_dns').length
    const draft = sites.filter((site) => site.status === 'draft').length
    const totalViews = sites.reduce((sum, site) => sum + Number(site.views || 0), 0)

    return NextResponse.json({
      configured: true,
      sites,
      summary: {
        total: sites.length,
        published,
        pendingDns,
        draft,
        totalViews,
      },
    })
  } catch (error) {
    console.error('Error fetching sites:', error)
    const sites = await readLocalSites()
    const published = sites.filter((site) => site.status === 'published').length
    const pendingDns = sites.filter((site) => site.status === 'pending_dns').length
    const draft = sites.filter((site) => site.status === 'draft').length
    const totalViews = sites.reduce((sum, site) => sum + Number(site.views || 0), 0)

    return NextResponse.json({
      configured: false,
      localFallback: true,
      sites,
      summary: {
        total: sites.length,
        published,
        pendingDns,
        draft,
        totalViews,
      },
      error: error instanceof Error ? error.message : 'Failed to fetch sites',
    })
  }
}

// POST create new agent website
export async function POST(request: NextRequest) {
  try {
    const unauthorized = requireAdminSession(request)
    if (unauthorized) return unauthorized

    const body = await request.json()
    const name = String(body.name || '').trim()
    const slug = generateSlug(String(body.slug || name))

    if (!name || !slug) {
      return NextResponse.json({ error: 'Agent name and website slug are required.' }, { status: 400 })
    }

    const customDomain = body.customDomain ? normalizeDomain(String(body.customDomain)) : null
    const status = customDomain ? 'pending_dns' : body.status || 'published'
    const payload = {
      name,
      slug,
      title: body.title || 'Real Estate Agent',
      brokerage: body.brokerage || null,
      email: body.email || null,
      phone: body.phone || null,
      bio: body.bio || null,
      photo_url: body.photoUrl || null,
      hero_image_url: body.heroImageUrl || null,
      about_image_url: body.aboutImageUrl || null,
      gallery_image_urls: normalizeImageList(body.galleryImageUrls),
      testimonials_json: normalizeTestimonials(body.testimonials),
      license_number: body.licenseNumber || null,
      rel8tion_agent_id: body.rel8tionAgentId || null,
      color_scheme: body.colorScheme || 'warm-earth',
      font_pairing: body.fontPairing || 'classic-elegant',
      custom_domain: customDomain,
      status,
      facebook_url: body.facebook || null,
      instagram_url: body.instagram || null,
      linkedin_url: body.linkedin || null,
    }

    let supabase
    try {
      supabase = getAdminClient()
    } catch {
      const site = await createLocalSite(payload)
      return NextResponse.json({ site, configured: false, localFallback: true })
    }
    
    const { data, error } = await supabase
      .from('agent_websites')
      .insert(payload)
      .select()
      .single()
    
    if (error) throw error
    
    return NextResponse.json({ site: data })
  } catch (error) {
    console.error('Error creating site:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create site' }, { status: 500 })
  }
}

// PATCH update an existing agent website
export async function PATCH(request: NextRequest) {
  try {
    const unauthorized = requireAdminSession(request)
    if (unauthorized) return unauthorized

    const body = await request.json()
    const id = String(body.id || '').trim()

    if (!id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 })
    }

    const patch: Record<string, string | string[] | object[] | null> = {}

    if ('photoUrl' in body) patch.photo_url = body.photoUrl || null
    if ('heroImageUrl' in body) patch.hero_image_url = body.heroImageUrl || null
    if ('aboutImageUrl' in body) patch.about_image_url = body.aboutImageUrl || null
    if ('galleryImageUrls' in body) patch.gallery_image_urls = normalizeImageList(body.galleryImageUrls)
    if ('testimonials' in body) patch.testimonials_json = normalizeTestimonials(body.testimonials)
    if ('colorScheme' in body) patch.color_scheme = body.colorScheme || 'warm-earth'
    if ('status' in body) patch.status = body.status || 'published'
    patch.updated_at = new Date().toISOString()

    let supabase
    try {
      supabase = getAdminClient()
    } catch {
      const site = await updateLocalSite(id, patch)
      if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })
      return NextResponse.json({ site, configured: false, localFallback: true })
    }

    const { data, error } = await supabase
      .from('agent_websites')
      .update(patch)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ site: data })
  } catch (error) {
    console.error('Error updating site:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update site' }, { status: 500 })
  }
}

// DELETE agent website
export async function DELETE(request: NextRequest) {
  try {
    const unauthorized = requireAdminSession(request)
    if (unauthorized) return unauthorized

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 })
    }

    let supabase
    try {
      supabase = getAdminClient()
    } catch {
      await deleteLocalSite(id)
      return NextResponse.json({ success: true, configured: false, localFallback: true })
    }
    
    const { error } = await supabase
      .from('agent_websites')
      .delete()
      .eq('id', id)
    
    if (error) throw error
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting site:', error)
    return NextResponse.json({ error: 'Failed to delete site' }, { status: 500 })
  }
}
