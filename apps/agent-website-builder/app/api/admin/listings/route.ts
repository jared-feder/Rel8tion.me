import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

const STATUSES = new Set(['active', 'pending', 'sold', 'off_market', 'draft'])

function clean(value: unknown) {
  return String(value || '').trim()
}

function optionalText(value: unknown) {
  const text = clean(value)
  return text || null
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function intOrNull(value: unknown) {
  const parsed = numberOrNull(value)
  return parsed === null ? null : Math.round(parsed)
}

function normalizeList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => clean(item)).filter(Boolean)
  }
  return clean(value)
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeDate(value: unknown) {
  const text = clean(value)
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeStatus(value: unknown) {
  const status = clean(value).toLowerCase()
  return STATUSES.has(status) ? status : 'active'
}

function listingPayload(body: Record<string, unknown>) {
  const images = normalizeList(body.images).slice(0, 24)
  const primaryImage = optionalText(body.primaryImage) || images[0] || null

  return {
    agent_website_id: clean(body.agentWebsiteId),
    source: clean(body.source) || 'manual',
    source_listing_id: optionalText(body.sourceListingId),
    mls_id: optionalText(body.mlsId),
    title: optionalText(body.title),
    address: clean(body.address),
    city: optionalText(body.city),
    state: optionalText(body.state) || 'NY',
    zip: optionalText(body.zip),
    price: numberOrNull(body.price),
    beds: numberOrNull(body.beds),
    baths: numberOrNull(body.baths),
    sqft: intOrNull(body.sqft),
    lot_size: numberOrNull(body.lotSize),
    year_built: intOrNull(body.yearBuilt),
    annual_property_taxes: numberOrNull(body.annualPropertyTaxes),
    property_type: optionalText(body.propertyType),
    listing_status: normalizeStatus(body.status),
    description: optionalText(body.description),
    features: normalizeList(body.features).slice(0, 32),
    images,
    primary_image: primaryImage,
    listing_url: optionalText(body.listingUrl),
    brokerage: optionalText(body.brokerage),
    agent_name: optionalText(body.agentName),
    agent_phone: optionalText(body.agentPhone),
    agent_email: optionalText(body.agentEmail),
    open_house_start: normalizeDate(body.openHouseStart),
    open_house_end: normalizeDate(body.openHouseEnd),
    lat: numberOrNull(body.lat),
    lng: numberOrNull(body.lng),
    sort_order: intOrNull(body.sortOrder) || 0,
    is_featured: body.isFeatured === false ? false : true,
    disclaimer: optionalText(body.disclaimer),
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    updated_at: new Date().toISOString(),
  }
}

export async function GET(request: NextRequest) {
  try {
    const unauthorized = requireAdminSession(request)
    if (unauthorized) return unauthorized

    const siteId = request.nextUrl.searchParams.get('siteId')
    const supabase = createAdminClient()
    let query = supabase
      .from('agent_website_listings')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })

    if (siteId) query = query.eq('agent_website_id', siteId)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ listings: data || [] })
  } catch (error) {
    console.error('[admin listings] GET error:', error)
    return NextResponse.json(
      { listings: [], error: error instanceof Error ? error.message : 'Unable to load listings.' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const unauthorized = requireAdminSession(request)
    if (unauthorized) return unauthorized

    const body = await request.json()
    const payload = listingPayload(body)
    if (!payload.agent_website_id) return NextResponse.json({ error: 'Agent website is required.' }, { status: 400 })
    if (!payload.address) return NextResponse.json({ error: 'Listing address is required.' }, { status: 400 })

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('agent_website_listings')
      .insert(payload)
      .select('*')
      .single()

    if (error) throw error
    return NextResponse.json({ listing: data })
  } catch (error) {
    console.error('[admin listings] POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create listing.' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const unauthorized = requireAdminSession(request)
    if (unauthorized) return unauthorized

    const body = await request.json()
    const id = clean(body.id)
    if (!id) return NextResponse.json({ error: 'Listing ID is required.' }, { status: 400 })

    const payload = listingPayload(body)
    if (!payload.address) return NextResponse.json({ error: 'Listing address is required.' }, { status: 400 })

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('agent_website_listings')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single()

    if (error) throw error
    return NextResponse.json({ listing: data })
  } catch (error) {
    console.error('[admin listings] PATCH error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to update listing.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const unauthorized = requireAdminSession(request)
    if (unauthorized) return unauthorized

    const id = request.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Listing ID is required.' }, { status: 400 })

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('agent_website_listings')
      .delete()
      .eq('id', id)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin listings] DELETE error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to delete listing.' },
      { status: 500 },
    )
  }
}
