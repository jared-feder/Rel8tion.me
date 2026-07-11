import { NextRequest, NextResponse } from 'next/server'

// Search for agent listings using web scraping fallback
// This searches public real estate sites when OneKey doesn't have the agent

export async function GET(req: NextRequest) {
  const agentName = req.nextUrl.searchParams.get('name')
  const location = req.nextUrl.searchParams.get('location') || 'New York'
  
  if (!agentName) {
    return NextResponse.json({ error: 'Agent name required' }, { status: 400 })
  }

  try {
    // Try Zillow's public agent search
    const zillowListings = await searchZillowAgent(agentName, location)
    
    if (zillowListings.length > 0) {
      return NextResponse.json({
        source: 'zillow',
        count: zillowListings.length,
        listings: zillowListings
      })
    }

    // Try Realtor.com as fallback
    const realtorListings = await searchRealtorAgent(agentName, location)
    
    return NextResponse.json({
      source: realtorListings.length > 0 ? 'realtor' : 'none',
      count: realtorListings.length,
      listings: realtorListings
    })

  } catch (error) {
    console.error('[v0] Agent listing search error:', error)
    return NextResponse.json({ 
      error: 'Search failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}

async function searchZillowAgent(agentName: string, location: string) {
  try {
    // Zillow's public agent profile search
    const encodedName = encodeURIComponent(agentName)
    const encodedLocation = encodeURIComponent(location)
    
    // Use Zillow's public API endpoint for agent search
    const searchUrl = `https://www.zillow.com/webservice/ProReviewBoard.htm?screenname=${encodedName}`
    
    // Note: This is a placeholder - Zillow requires API key for full access
    // For now, return empty and rely on OneKey or manual import
    console.log(`[v0] Would search Zillow for: ${agentName} in ${location}`)
    
    return []
  } catch (error) {
    console.error('[v0] Zillow search error:', error)
    return []
  }
}

async function searchRealtorAgent(agentName: string, location: string) {
  try {
    // Realtor.com agent search
    const encodedName = encodeURIComponent(agentName.replace(/\s+/g, '-').toLowerCase())
    
    // Note: This is a placeholder - Realtor.com has rate limits
    console.log(`[v0] Would search Realtor.com for: ${agentName} in ${location}`)
    
    return []
  } catch (error) {
    console.error('[v0] Realtor search error:', error)
    return []
  }
}

// POST - Import listings from a URL or MLS numbers
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { agentName, mlsNumbers, importUrl } = body

    if (!agentName) {
      return NextResponse.json({ error: 'Agent name required' }, { status: 400 })
    }

    // If MLS numbers provided, look them up in OneKey
    if (mlsNumbers && Array.isArray(mlsNumbers) && mlsNumbers.length > 0) {
      const listings = await lookupMlsNumbers(mlsNumbers, agentName)
      return NextResponse.json({
        imported: listings.length,
        listings
      })
    }

    // If import URL provided (like Zillow profile), scrape it
    if (importUrl) {
      const listings = await importFromUrl(importUrl, agentName)
      return NextResponse.json({
        imported: listings.length,
        listings
      })
    }

    return NextResponse.json({ 
      error: 'Provide either mlsNumbers array or importUrl' 
    }, { status: 400 })

  } catch (error) {
    console.error('[v0] Import error:', error)
    return NextResponse.json({ 
      error: 'Import failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

async function lookupMlsNumbers(mlsNumbers: string[], agentName: string) {
  const listings = []
  
  for (const mlsId of mlsNumbers) {
    try {
      // Search OneKey for this specific MLS number
      const url = `https://www.onekeymls.com/api/search?ListingId=${encodeURIComponent(mlsId)}`
      const res = await fetch(url)
      const data = await res.json()
      
      if (data?.Results?.[0]) {
        const p = data.Results[0]
        listings.push({
          mls_id: mlsId,
          address: p.DisplayName,
          city: p.Location?.City,
          price: p.Listing?.Price?.ListPrice,
          beds: p.Structure?.BedroomsTotal,
          baths: p.Structure?.BathroomsTotalInteger,
          sqft: p.Structure?.LivingArea,
          primary_image: p.Media?.[0]?.MediaURL || p.ImagesHero,
          agent_name: agentName, // Override with the agent claiming this listing
          source: 'onekey-manual'
        })
      }
    } catch (err) {
      console.log(`[v0] Failed to lookup MLS ${mlsId}:`, err)
    }
  }
  
  return listings
}

async function importFromUrl(url: string, agentName: string) {
  // This would scrape the URL for listing data
  // For now, return empty - would need a scraping service
  console.log(`[v0] Would import from URL: ${url} for agent: ${agentName}`)
  return []
}
