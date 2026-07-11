import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// GET listings for a specific agent
// Matches by agent_name (fuzzy match) or brokerage
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const siteId = searchParams.get('siteId')
    const agentName = searchParams.get('agent')
    const collection = searchParams.get('collection') || 'current'
    const limit = parseInt(searchParams.get('limit') || '12')

    if (!siteId && !agentName) {
      return NextResponse.json({ 
        error: 'Provide ?siteId=ID or ?agent=Name' 
      }, { status: 400 })
    }

    const supabase = createAdminClient()
    const now = new Date()
    const futureOpenHouse = (start?: string | null, end?: string | null) => {
      if (!start) return null
      const endDate = new Date(end || start)
      if (Number.isNaN(endDate.getTime()) || endDate < now) return null
      return { start, end: end || start }
    }

    if (siteId) {
      const statusFilters = collection === 'past-sales'
        ? ['sold']
        : ['active', 'pending']
      const { data: siteListings, error: siteListingsError } = await supabase
        .from('agent_website_listings')
        .select('*')
        .eq('agent_website_id', siteId)
        .in('listing_status', statusFilters)
        .eq('is_featured', true)
        .order('sort_order', { ascending: true })
        .order(collection === 'past-sales' ? 'updated_at' : 'created_at', { ascending: false })
        .limit(limit)

      if (siteListingsError && siteListingsError.code !== '42P01') throw siteListingsError

      const listings = (siteListings || []).map((listing) => ({
        id: listing.id,
        title: listing.title,
        address: listing.address,
        city: listing.city,
        state: listing.state,
        zip: listing.zip,
        price: Number(listing.price || 0),
        beds: Number(listing.beds || 0),
        baths: Number(listing.baths || 0),
        sqft: Number(listing.sqft || 0),
        lotSize: listing.lot_size == null ? null : Number(listing.lot_size),
        yearBuilt: listing.year_built == null ? null : Number(listing.year_built),
        annualPropertyTaxes: listing.annual_property_taxes == null ? null : Number(listing.annual_property_taxes),
        monthlyHoa: listing.metadata?.source_facts?.hoa_monthly == null ? null : Number(listing.metadata.source_facts.hoa_monthly),
        pricePerSqft: listing.metadata?.source_facts?.price_per_sqft == null ? null : Number(listing.metadata.source_facts.price_per_sqft),
        propertyType: listing.property_type,
        status: listing.listing_status,
        image: listing.primary_image || listing.images?.[0] || '',
        images: listing.images || [],
        agent: listing.agent_name,
        brokerage: listing.brokerage,
        coordinates: listing.lat && listing.lng ? { lat: listing.lat, lng: listing.lng } : null,
        openHouse: futureOpenHouse(listing.open_house_start, listing.open_house_end),
        description: listing.description,
        features: listing.features || [],
        listingUrl: listing.listing_url,
        mlsId: listing.mls_id,
        disclaimer: listing.disclaimer,
      }))

      return NextResponse.json({
        listings,
        count: listings.length,
        query: { siteId, agent: agentName, collection },
      })
    }

    if (collection === 'past-sales') {
      return NextResponse.json({
        listings: [],
        count: 0,
        query: { siteId, agent: agentName, collection },
      })
    }

    let query = supabase
      .from('listings')
      .select('*')
      .eq('listing_status', 'Active')
      .order('price', { ascending: false })
      .limit(limit)
      .ilike('agent_name', `%${agentName}%`)

    const { data, error } = await query

    if (error) {
      console.log('[v0] Listings query error:', error)
      return NextResponse.json({ 
        error: error.message,
        listings: [] 
      }, { status: 500 })
    }

    // Transform to frontend format
    const listings = (data || []).map(listing => ({
      id: listing.mls_id,
      title: listing.title || listing.address,
      address: listing.address,
      city: listing.city,
      state: listing.state,
      zip: listing.zip,
      price: listing.price,
      beds: listing.beds,
      baths: listing.baths,
      sqft: listing.sqft,
      lotSize: listing.lot_size == null ? null : Number(listing.lot_size),
      yearBuilt: listing.year_built == null ? null : Number(listing.year_built),
      annualPropertyTaxes: listing.annual_property_taxes == null && listing.taxes == null ? null : Number(listing.annual_property_taxes || listing.taxes),
      monthlyHoa: listing.metadata?.source_facts?.hoa_monthly == null ? null : Number(listing.metadata.source_facts.hoa_monthly),
      pricePerSqft: listing.metadata?.source_facts?.price_per_sqft == null ? null : Number(listing.metadata.source_facts.price_per_sqft),
      propertyType: listing.property_type,
      status: listing.listing_status,
      image: listing.primary_image,
      images: listing.images || [],
      agent: listing.agent_name,
      brokerage: listing.brokerage,
      coordinates: listing.lat && listing.lng ? { lat: listing.lat, lng: listing.lng } : null,
      openHouse: futureOpenHouse(listing.open_house_start, listing.open_house_end),
      description: listing.description || '',
      features: listing.features || [],
      listingUrl: listing.listing_url || listing.url || null,
      mlsId: listing.mls_id,
      disclaimer: listing.disclaimer || '',
    }))

    return NextResponse.json({ 
      listings,
      count: listings.length,
      query: { siteId, agent: agentName, collection }
    })

  } catch (error) {
    console.error('[v0] Agent listings error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      listings: []
    }, { status: 500 })
  }
}
