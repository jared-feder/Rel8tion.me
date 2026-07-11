'use client'

import useSWR from 'swr'

export interface AgentListing {
  id: string
  address: string
  city: string
  state: string
  zip: string
  price: number
  beds: number
  baths: number
  sqft: number
  propertyType: string
  status: string
  image: string
  images: string[]
  agent: string
  brokerage: string
  coordinates: { lat: number; lng: number } | null
  openHouse: { start: string; end: string } | null
}

interface AgentListingsResponse {
  listings: AgentListing[]
  count: number
  query: { agent: string | null; brokerage: string | null }
}

const fetcher = (url: string) => fetch(url).then(res => res.json())

export function useAgentListings(agentName?: string, brokerage?: string) {
  const params = new URLSearchParams()
  if (agentName) params.set('agent', agentName)
  else if (brokerage) params.set('brokerage', brokerage)

  const shouldFetch = agentName || brokerage
  const url = shouldFetch ? `/api/agent-listings?${params.toString()}` : null

  const { data, error, isLoading, mutate } = useSWR<AgentListingsResponse>(
    url,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 60000, // Cache for 1 minute
    }
  )

  return {
    listings: data?.listings || [],
    count: data?.count || 0,
    isLoading,
    isError: !!error,
    error,
    refresh: mutate,
  }
}
