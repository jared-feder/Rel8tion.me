// REL8TION Integration
// Fetches brokerages (brands) and agent data from your REL8TION Supabase instance

// Set these environment variables:
// - REL8TION_SUPABASE_URL: Your REL8TION Supabase project URL
// - REL8TION_SUPABASE_ANON_KEY: Your REL8TION Supabase anon key

const DEFAULT_REL8TION_SUPABASE_URL = 'https://nicanqrfqlbnlmnoernb.supabase.co'
const DEFAULT_REL8TION_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pY2FucXJmcWxibmxtbm9lcm5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNjEwNzcsImV4cCI6MjA3NjczNzA3N30.FNE_8qVT4BZBrgdhYqvdwEzeCdbtUzBXndq_Us-WUjg'


// Matches your actual brokerages table schema
export interface Rel8tionBrokerage {
  id: string
  name: string | null
  logo_url: string | null
  primary_color: string | null
  accent_color: string | null
  font_family: string | null
  created_at: string | null
  match_keywords: string[] | null
  theme: string | null
  bg_color: string | null
  text_color: string | null
  button_style: string | null
}

// Fetch all brokerages from REL8TION
export async function fetchRel8tionBrokerages(): Promise<Rel8tionBrokerage[]> {
  const rel8tionUrl = process.env.REL8TION_SUPABASE_URL || DEFAULT_REL8TION_SUPABASE_URL
  const rel8tionKey = process.env.REL8TION_SUPABASE_ANON_KEY || DEFAULT_REL8TION_SUPABASE_ANON_KEY

  if (!rel8tionUrl || !rel8tionKey) {
    return []
  }

  try {
    const fetchUrl = `${rel8tionUrl}/rest/v1/brokerages?select=*`
    const response = await fetch(fetchUrl, {
      headers: {
        'apikey': rel8tionKey,
        'Authorization': `Bearer ${rel8tionKey}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store', // Disable cache for debugging
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch brokerages: ${response.status}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error('[REL8TION] Error fetching brokerages:', error)
    return []
  }
}

// Fetch a specific brokerage by ID
export async function fetchRel8tionBrokerageById(brokerageId: string): Promise<Rel8tionBrokerage | null> {
  const rel8tionUrl = process.env.REL8TION_SUPABASE_URL || DEFAULT_REL8TION_SUPABASE_URL
  const rel8tionKey = process.env.REL8TION_SUPABASE_ANON_KEY || DEFAULT_REL8TION_SUPABASE_ANON_KEY

  if (!rel8tionUrl || !rel8tionKey) {
    return null
  }

  try {
    const response = await fetch(
      `${rel8tionUrl}/rest/v1/brokerages?id=eq.${brokerageId}&select=*`,
      {
        headers: {
          'apikey': rel8tionKey,
          'Authorization': `Bearer ${rel8tionKey}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to fetch brokerage: ${response.status}`)
    }

    const brokerages = await response.json()
    return brokerages[0] || null
  } catch (error) {
    console.error('[REL8TION] Error fetching brokerage:', error)
    return null
  }
}

// Convert brokerage to color scheme for the template picker
export function brokerageToColorScheme(brokerage: Rel8tionBrokerage) {
  return {
    id: `rel8tion-${brokerage.id}`,
    name: brokerage.name || 'Unnamed Brokerage',
    primary: brokerage.primary_color || '#8B7355',
    secondary: brokerage.bg_color || '#f5f5f0',
    accent: brokerage.accent_color || brokerage.primary_color || '#8B7355',
    text: brokerage.text_color || '#1a1a1a',
    background: brokerage.bg_color || '#ffffff',
    muted: '#6b7280',
    logo: brokerage.logo_url,
    fontFamily: brokerage.font_family,
    theme: brokerage.theme,
    buttonStyle: brokerage.button_style,
  }
}

// Fetch agent data from REL8TION
export interface Rel8tionAgent {
  id: string
  name: string
  email?: string
  phone?: string
  photo_url?: string
  brokerage?: string
  license_number?: string
  bio?: string
  brand_id?: string
}

export async function fetchRel8tionAgent(agentId: string): Promise<Rel8tionAgent | null> {
  const rel8tionUrl = process.env.REL8TION_SUPABASE_URL || DEFAULT_REL8TION_SUPABASE_URL
  const rel8tionKey = process.env.REL8TION_SUPABASE_ANON_KEY || DEFAULT_REL8TION_SUPABASE_ANON_KEY

  if (!rel8tionUrl || !rel8tionKey) {
    return null
  }

  try {
    const response = await fetch(
      `${rel8tionUrl}/rest/v1/agents?id=eq.${agentId}&select=*`,
      {
        headers: {
          'apikey': rel8tionKey,
          'Authorization': `Bearer ${rel8tionKey}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to fetch agent: ${response.status}`)
    }

    const agents = await response.json()
    return agents[0] || null
  } catch (error) {
    console.error('[v0] Error fetching REL8TION agent:', error)
    return null
  }
}

// Fetch listings from REL8TION
export interface Rel8tionListing {
  id: string
  address: string
  city: string
  state: string
  zip: string
  price: number
  bedrooms: number
  bathrooms: number
  sqft: number
  description?: string
  images: string[]
  status: 'active' | 'pending' | 'sold'
  agent_id: string
}

export async function fetchRel8tionListings(agentId: string): Promise<Rel8tionListing[]> {
  const rel8tionUrl = process.env.REL8TION_SUPABASE_URL || DEFAULT_REL8TION_SUPABASE_URL
  const rel8tionKey = process.env.REL8TION_SUPABASE_ANON_KEY || DEFAULT_REL8TION_SUPABASE_ANON_KEY

  if (!rel8tionUrl || !rel8tionKey) {
    return []
  }

  try {
    const response = await fetch(
      `${rel8tionUrl}/rest/v1/listings?agent_id=eq.${agentId}&select=*`,
      {
        headers: {
          'apikey': rel8tionKey,
          'Authorization': `Bearer ${rel8tionKey}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to fetch listings: ${response.status}`)
    }

    const listings = await response.json()
    return listings as Rel8tionListing[]
  } catch (error) {
    console.error('[v0] Error fetching REL8TION listings:', error)
    return []
  }
}
