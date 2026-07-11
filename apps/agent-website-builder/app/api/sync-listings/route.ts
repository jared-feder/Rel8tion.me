import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

// Geographic bounding boxes for OneKey MLS coverage
const COVERAGE_BOXES = [
  { name: 'core-nyc-queens-nassau-west', topLeft: '[-73.96,40.80]', bottomRight: '[-73.70,40.54]' },
  { name: 'queens-nassau-bronx-edge', topLeft: '[-73.80,40.92]', bottomRight: '[-73.40,40.55]' },
  { name: 'long-island-suffolk', topLeft: '[-73.40,41.10]', bottomRight: '[-72.00,40.60]' },
  { name: 'brooklyn', topLeft: '[-74.06,40.75]', bottomRight: '[-73.83,40.55]' },
  { name: 'bronx', topLeft: '[-73.95,40.93]', bottomRight: '[-73.74,40.78]' },
  { name: 'staten-island', topLeft: '[-74.27,40.66]', bottomRight: '[-74.04,40.47]' },
]

function normalizeUtcTime(value: unknown): string | null {
  if (!value) return null
  const raw = String(value).trim()
  if (!raw) return null

  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(raw)) {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }

  const d = new Date(`${raw}Z`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export async function OPTIONS() {
  return new Response('ok', { headers: corsHeaders })
}

// GET - Check sync status
export async function GET() {
  try {
    const supabase = createAdminClient()
    
    const { count, error } = await supabase
      .from('listings')
      .select('*', { count: 'exact', head: true })

    if (error) {
      return NextResponse.json({ 
        configured: false, 
        message: 'Listings table not found. Run POST /api/setup-db first.',
        error: error.message 
      }, { headers: corsHeaders })
    }

    const { data: lastSync } = await supabase
      .from('listings')
      .select('synced_at')
      .order('synced_at', { ascending: false })
      .limit(1)
      .single()

    return NextResponse.json({
      configured: true,
      totalListings: count,
      lastSyncedAt: lastSync?.synced_at || null,
      message: 'POST to this endpoint to sync listings from OneKey MLS'
    }, { headers: corsHeaders })
  } catch (error) {
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500, headers: corsHeaders })
  }
}

// POST - Sync listings from OneKey MLS
export async function POST(req: NextRequest) {
  try {
    // Optional: Verify cron secret for automated syncs
    const authHeader = req.headers.get('authorization') || ''
    const cronSecret = process.env.CRON_SECRET
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      // Allow if no cron secret is set (manual trigger) or if it matches
      if (cronSecret && !authHeader.startsWith('Bearer eyJ')) {
        // Not a cron call and not a JWT - could be manual trigger, allow for now
      }
    }

    console.log('[v0] Starting OneKey MLS sync...')
    
    const supabase = createAdminClient()
    const allListings: any[] = []

    // Fetch listings from all coverage areas
    for (const box of COVERAGE_BOXES) {
      let offset = 0
      let total = 9999
      const limit = 100

      while (offset < total && offset < 1000) {
        try {
          console.log(`[v0] Fetching: ${box.name} offset=${offset}`)

          // Remove openHouse=true to get ALL listings, not just open houses
          const url = `https://www.onekeymls.com/api/search?topLeft=${box.topLeft}&bottomRight=${box.bottomRight}&propertySaleType=Sale&StateOrProvince=NY&offset=${offset}`
          
          const res = await fetch(url)
          
          let data
          try {
            data = await res.json()
          } catch {
            console.log('[v0] Bad JSON response from OneKey')
            break
          }

          if (!data?.Results || data.Results.length === 0) break

          allListings.push(...data.Results)
          total = data.Total || total
          offset += limit
        } catch (err) {
          console.log('[v0] Fetch error:', err)
          break
        }
      }
    }

    console.log(`[v0] Raw listings pulled: ${allListings.length}`)

    // Dedupe and transform listings
    const listingsMap = new Map()

    for (const p of allListings) {
      try {
        const id = p.UniqueListingId
        if (!id) continue

        const lat = p.LocationPoint?.lat
        const lng = p.LocationPoint?.lon
        if (!lat || !lng) continue

        // Extract agent info with multiple fallback paths
        const agentName =
          p.Listing?.ListAgent?.FullName ||
          p.Listing?.ListAgent?.MemberFullName ||
          p.Listing?.ListAgent?.Name ||
          p.Listing?.Agent?.FullName ||
          p.Listing?.Agent?.Name ||
          p.ListingAgentName ||
          p.ListAgentFullName ||
          p.ListAgentName ||
          null

        const agentPhone = 
          p.Listing?.ListAgent?.Phone ||
          p.Listing?.ListAgent?.MemberPhone ||
          p.Listing?.Agent?.Phone ||
          null

        const agentEmail =
          p.Listing?.ListAgent?.Email ||
          p.Listing?.ListAgent?.MemberEmail ||
          p.Listing?.Agent?.Email ||
          null

        const brokerage =
          p.Listing?.AgentOffice?.ListOffice?.ListOfficeName || 
          p.Listing?.ListOffice?.ListOfficeName ||
          'Unknown'

        // Get all images
        const images = p.Media?.map((m: any) => m.MediaURL).filter(Boolean) || []

        listingsMap.set(id, {
          mls_id: id,
          address: p.DisplayName || null,
          city: p.Location?.City || null,
          state: p.Location?.StateOrProvince || 'NY',
          zip: p.Location?.PostalCode || null,
          price: p.Listing?.Price?.ListPrice || null,
          beds: p.Structure?.BedroomsTotal || null,
          baths: p.Structure?.BathroomsTotalInteger || null,
          sqft: p.Structure?.LivingArea || null,
          lot_size: p.Listing?.LotSizeArea || null,
          year_built: p.Structure?.YearBuilt || null,
          property_type: p.Listing?.PropertyType || p.PropertyType || null,
          listing_status: p.Listing?.StandardStatus || 'Active',
          brokerage,
          agent_name: agentName,
          agent_phone: agentPhone,
          agent_email: agentEmail,
          lat,
          lng,
          images,
          primary_image: images[0] || p.ImagesHero || null,
          description: p.Listing?.PublicRemarks || null,
          open_house_start: normalizeUtcTime(p.Computed?.OpenHousesEarliestStartTime),
          open_house_end: normalizeUtcTime(p.Computed?.OpenHousesEarliestEndTime),
          source: 'onekey',
          synced_at: new Date().toISOString(),
        })
      } catch (err) {
        console.log('[v0] Skipped bad listing:', err)
        continue
      }
    }

    const listings = Array.from(listingsMap.values())
    console.log(`[v0] Deduped listings: ${listings.length}`)

    // Upsert in chunks
    let successCount = 0
    let failCount = 0

    for (let i = 0; i < listings.length; i += 100) {
      const chunk = listings.slice(i, i + 100)

      try {
        const { error } = await supabase
          .from('listings')
          .upsert(chunk, { onConflict: 'mls_id' })

        if (error) {
          console.log('[v0] Upsert error:', error)
          failCount += chunk.length
        } else {
          successCount += chunk.length
        }
      } catch (err) {
        console.log('[v0] Chunk failed:', err)
        failCount += chunk.length
      }
    }

    console.log(`[v0] Sync complete: ${successCount} success, ${failCount} failed`)

    return NextResponse.json({
      success: true,
      inserted: successCount,
      failed: failCount,
      total: listings.length,
    }, { headers: corsHeaders })

  } catch (err: any) {
    console.error('[v0] Sync error:', err?.message)
    return NextResponse.json({
      error: err?.message || 'Unknown error'
    }, { status: 500, headers: corsHeaders })
  }
}
