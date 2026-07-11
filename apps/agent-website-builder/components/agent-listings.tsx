'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { Bed, Bath, Square, MapPin, ArrowRight, Loader2, Home, Calendar, ExternalLink, Landmark } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { currency, DEFAULT_DOWN_PAYMENT_PERCENT, DEFAULT_INTEREST_RATE, estimateMonthlyMortgage } from '@/lib/mortgage'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface OnekeyListing {
  id: string
  title?: string
  address: string
  city: string
  state: string
  zip: string
  price: number
  beds: number
  baths: number
  sqft: number
  lotSize?: number | null
  yearBuilt?: number | null
  annualPropertyTaxes?: number | null
  monthlyHoa?: number | null
  pricePerSqft?: number | null
  propertyType: string
  status: string
  image: string
  images: string[]
  agent: string
  brokerage: string
  coordinates: { lat: number; lng: number } | null
  openHouse: { start: string; end: string } | null
  listingUrl?: string
  description?: string
  features?: string[]
  mlsId?: string
  disclaimer?: string
  source?: string
}

interface AgentListingsProps {
  siteId?: string
  agentName: string
  brokerage?: string
  collection?: 'current' | 'past-sales'
  hideWhenEmpty?: boolean
}

type ListingCollection = NonNullable<AgentListingsProps['collection']>

const sectionCopy: Record<ListingCollection, {
  id: string
  eyebrow: string
  title: string
  description: string
  loading: string
  emptyTitle: string
  emptyDescription: string
  notice: string
}> = {
  current: {
    id: 'listings',
    eyebrow: 'Featured Properties',
    title: 'Current Listings',
    description: 'Explore my curated selection of exceptional properties. Each listing represents the finest homes in the most desirable locations.',
    loading: 'Loading listings...',
    emptyTitle: 'No active listings at this time.',
    emptyDescription: 'Contact me to discuss upcoming properties or your home search.',
    notice: 'Listings provided by the listing agent or synced from authorized listing sources.',
  },
  'past-sales': {
    id: 'past-sales',
    eyebrow: 'Sold Portfolio',
    title: 'Past Sales',
    description: 'A selected look at homes I have represented, marketed, and helped move successfully through the market.',
    loading: 'Loading past sales...',
    emptyTitle: 'No past sales featured yet.',
    emptyDescription: 'Past sales can be added from the admin listing manager as sold properties.',
    notice: 'Past sales are displayed from approved agent website records.',
  },
}

function formatPrice(price: number): string {
  if (price >= 1000000) {
    return `$${(price / 1000000).toFixed(price % 1000000 === 0 ? 0 : 2)}M`
  }
  return `$${price.toLocaleString()}`
}

function formatOpenHouse(start: string, end: string): string {
  const startDate = new Date(start)
  const endDate = new Date(end)
  const options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }
  const timeOptions: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }
  
  return `${startDate.toLocaleDateString('en-US', options)} ${startDate.toLocaleTimeString('en-US', timeOptions)} - ${endDate.toLocaleTimeString('en-US', timeOptions)}`
}

function statusLabel(status: string) {
  const normalized = status.replace('_', ' ').toLowerCase()
  if (normalized === 'sold') return 'Sold'
  if (normalized === 'pending') return 'Pending'
  if (normalized === 'off market') return 'Off Market'
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

function statusBadgeClass(status: string, collection: ListingCollection) {
  if (collection === 'past-sales' || status === 'sold') return 'bg-blue-600/90 text-white border-0'
  if (status === 'pending') return 'bg-amber-500/90 text-white border-0'
  return 'bg-green-500/90 text-white border-0'
}

function listingTitle(listing: OnekeyListing) {
  return listing.title || listing.address
}

function cleanPropertyType(value: string | undefined) {
  return (value || 'Residential').replace('RES-', '').trim() || 'Residential'
}

function fullAddress(listing: OnekeyListing) {
  const address = listing.address || ''
  const cityStateZip = [listing.city, listing.state, listing.zip].filter(Boolean).join(', ')
  if (!cityStateZip) return address
  if (address.toLowerCase().includes(cityStateZip.toLowerCase())) return address
  return [address, cityStateZip].filter(Boolean).join(', ')
}

function locationLine(listing: OnekeyListing) {
  const parts = [listing.city, listing.state, listing.zip].filter(Boolean)
  if (parts.length > 1) return parts.join(', ')
  if (listing.brokerage) return listing.brokerage
  return ''
}

function propertyDescription(listing: OnekeyListing, collection: ListingCollection) {
  if (listing.description?.trim()) return listing.description.trim()
  const facts = [
    listing.beds ? `${listing.beds} beds` : '',
    listing.baths ? `${listing.baths} baths` : '',
    listing.sqft ? `${listing.sqft.toLocaleString()} square feet` : '',
    listing.lotSize ? `${Math.round(listing.lotSize).toLocaleString()} square foot lot` : '',
  ].filter(Boolean).join(', ')
  if (collection === 'past-sales') {
    return `${listingTitle(listing)} is a past sale${facts ? ` with ${facts}` : ''}. Contact the agent for neighborhood context, pricing strategy, and current market guidance.`
  }
  return `${listingTitle(listing)} is an active ${cleanPropertyType(listing.propertyType).toLowerCase()} listing${facts ? ` with ${facts}` : ''}. Contact the listing agent for full property details, disclosures, and showing information.`
}

function listingImages(listing: OnekeyListing) {
  return [listing.image, ...(listing.images || [])].filter(Boolean).filter((url, index, urls) => urls.indexOf(url) === index)
}

function propertyFacts(listing: OnekeyListing) {
  return [
    { label: 'Beds', value: listing.beds ? String(listing.beds) : '-' },
    { label: 'Baths', value: listing.baths ? String(listing.baths) : '-' },
    { label: 'Sqft', value: listing.sqft ? listing.sqft.toLocaleString() : '-' },
    { label: 'Annual Taxes', value: listing.annualPropertyTaxes ? currency(listing.annualPropertyTaxes) : 'Not available' },
    listing.monthlyHoa ? { label: 'HOA', value: `${currency(listing.monthlyHoa)}/mo` } : null,
    listing.pricePerSqft ? { label: '$/Sqft', value: currency(listing.pricePerSqft) } : null,
    listing.lotSize ? { label: 'Lot', value: `${Math.round(listing.lotSize).toLocaleString()} sqft` } : null,
    listing.yearBuilt ? { label: 'Built', value: String(listing.yearBuilt) } : null,
    { label: 'Type', value: cleanPropertyType(listing.propertyType) },
  ].filter(Boolean) as { label: string; value: string }[]
}

function ListingDetailsDialog({ listing, collection }: { listing: OnekeyListing; collection: ListingCollection }) {
  const images = listingImages(listing)
  const features = (listing.features || []).filter(Boolean)
  const detailDescription = propertyDescription(listing, collection)
  const subtitle = fullAddress(listing)
  const isPastSale = collection === 'past-sales'

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full group/btn">
          View Details
          <ArrowRight className="ml-2 h-4 w-4 group-hover/btn:translate-x-1 transition-transform" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto p-0 sm:max-w-5xl">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
          <div className="bg-muted">
            <div className="relative aspect-[4/3] min-h-[260px] overflow-hidden bg-muted">
              {images[0] ? (
                <Image src={images[0]} alt={listingTitle(listing)} fill className="object-cover" />
              ) : (
                <div className="flex h-full min-h-[260px] items-center justify-center text-muted-foreground">
                  <Home className="h-12 w-12" />
                </div>
              )}
            </div>
            {images.length > 1 && (
              <div className="grid grid-cols-4 gap-2 p-3">
                {images.slice(1, 5).map((image) => (
                  <div key={image} className="relative aspect-[4/3] overflow-hidden rounded-md bg-background">
                    <Image src={image} alt="" fill className="object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-5 p-6">
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={isPastSale ? 'bg-blue-500/10 text-blue-700 border-blue-200' : 'bg-green-500/10 text-green-700 border-green-200'}>{statusLabel(listing.status)}</Badge>
                {listing.openHouse && (
                  <Badge className="bg-amber-500/10 text-amber-700 border-amber-200">
                    <Calendar className="mr-1 h-3 w-3" />
                    Open House
                  </Badge>
                )}
              </div>
              <DialogTitle className="text-2xl leading-tight">{listingTitle(listing)}</DialogTitle>
              {subtitle && subtitle !== listingTitle(listing) && <DialogDescription>{subtitle}</DialogDescription>}
            </DialogHeader>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{isPastSale ? 'Sold Price' : 'List Price'}</p>
              <p className="text-3xl font-black text-foreground">{formatPrice(listing.price)}</p>
              {listing.openHouse && (
                <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                  Open House: {formatOpenHouse(listing.openHouse.start, listing.openHouse.end)}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {propertyFacts(listing).map((fact) => (
                <div key={fact.label} className="rounded-md border bg-background px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{fact.label}</p>
                  <p className="min-w-0 break-words text-sm font-bold leading-tight sm:text-base">{fact.value}</p>
                </div>
              ))}
            </div>

            <div>
              <h4 className="mb-2 font-bold">Property Details</h4>
              <p className="text-sm leading-6 text-muted-foreground">{detailDescription}</p>
            </div>

            {features.length > 0 && (
              <div>
                <h4 className="mb-2 font-bold">Features</h4>
                <div className="flex flex-wrap gap-2">
                  {features.map((feature) => (
                    <span key={feature} className="rounded-md bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                      {feature}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(listing.mlsId || listing.disclaimer) && (
              <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
                {listing.mlsId && <p>MLS ID: {listing.mlsId}</p>}
                {listing.disclaimer && <p>{listing.disclaimer}</p>}
              </div>
            )}

            {listing.listingUrl && (
              <DialogFooter>
                <Button asChild>
                  <a href={listing.listingUrl} target="_blank" rel="noopener noreferrer">
                    Open Listing Page
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </a>
                </Button>
              </DialogFooter>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ListingCard({ listing, collection }: { listing: OnekeyListing; collection: ListingCollection }) {
  const isPastSale = collection === 'past-sales'
  const estimatedPayment = estimateMonthlyMortgage({
    price: listing.price,
    annualTaxes: listing.annualPropertyTaxes || 0,
    monthlyHoa: listing.monthlyHoa || 0,
  })

  function prefillMortgageCalculator() {
    window.dispatchEvent(new CustomEvent('rel8tion:mortgage-prefill', {
      detail: {
        price: listing.price,
        annualTaxes: listing.annualPropertyTaxes || null,
        monthlyHoa: listing.monthlyHoa || null,
      },
    }))
    document.getElementById('mortgage-calculator')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <Card className="group overflow-hidden border-border hover:shadow-xl transition-all duration-300">
      {/* Image */}
      <div className="relative aspect-[4/3] overflow-hidden">
        <Image
          src={listing.image || '/placeholder.jpg'}
          alt={listing.address}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div className="absolute top-4 left-4 flex gap-2">
          <Badge className={statusBadgeClass(listing.status, collection)}>
            {statusLabel(listing.status)}
          </Badge>
          {listing.openHouse && (
            <Badge className="bg-amber-500/90 text-white border-0 flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Open House
            </Badge>
          )}
        </div>
        <div className="absolute top-4 right-4">
          <Badge variant="secondary" className="bg-card/90 backdrop-blur-sm text-foreground capitalize">
            {cleanPropertyType(listing.propertyType).toLowerCase()}
          </Badge>
        </div>
        {/* Price overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
          <p className="text-2xl font-bold text-white">
            {formatPrice(listing.price)}
          </p>
        </div>
      </div>

      <CardContent className="p-5">
        <h3 className="font-semibold text-lg text-foreground mb-2 line-clamp-1 group-hover:text-primary transition-colors">
          {listingTitle(listing)}
        </h3>
        
        {locationLine(listing) && (
          <div className="flex items-center gap-1.5 text-muted-foreground mb-4">
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="text-sm line-clamp-1">{locationLine(listing)}</span>
          </div>
        )}

        {/* Features */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
          <div className="flex items-center gap-1.5">
            <Bed className="h-4 w-4" />
            <span>{listing.beds} Beds</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Bath className="h-4 w-4" />
            <span>{listing.baths} Baths</span>
          </div>
          {listing.sqft > 0 && (
            <div className="flex items-center gap-1.5">
              <Square className="h-4 w-4" />
              <span>{listing.sqft.toLocaleString()} sqft</span>
            </div>
          )}
          {Boolean(listing.annualPropertyTaxes) && (
            <div className="flex items-center gap-1.5">
              <Landmark className="h-4 w-4" />
              <span>{currency(listing.annualPropertyTaxes || 0)} taxes</span>
            </div>
          )}
          {!listing.annualPropertyTaxes && Boolean(listing.monthlyHoa) && (
            <div className="flex items-center gap-1.5">
              <Landmark className="h-4 w-4" />
              <span>{currency(listing.monthlyHoa || 0)}/mo HOA</span>
            </div>
          )}
        </div>

        {isPastSale ? (
          <div className="mb-4 rounded-md border border-blue-100 bg-blue-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Represented Sale</p>
            <p className="text-sm text-blue-900">
              A proof point for pricing strategy, local demand, and buyer/seller guidance.
            </p>
          </div>
        ) : (
          <div className="mb-4 rounded-md border bg-secondary/45 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Estimated mortgage</p>
            <p className="text-lg font-black text-foreground">{currency(estimatedPayment.total)}/mo</p>
            <p className="text-xs text-muted-foreground">
              {DEFAULT_DOWN_PAYMENT_PERCENT}% down, {DEFAULT_INTEREST_RATE}% rate, {listing.annualPropertyTaxes ? 'property taxes included' : 'taxes pending'}, $200/mo insurance
              {listing.monthlyHoa ? `, ${currency(listing.monthlyHoa)}/mo HOA` : ''}
            </p>
          </div>
        )}

        {/* Open House Info */}
        {listing.openHouse && (
          <div className="mb-4 p-2 bg-amber-50 rounded-md border border-amber-200">
            <p className="text-xs font-medium text-amber-800">
              Open House: {formatOpenHouse(listing.openHouse.start, listing.openHouse.end)}
            </p>
          </div>
        )}

        {isPastSale ? (
          <ListingDetailsDialog listing={listing} collection={collection} />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <ListingDetailsDialog listing={listing} collection={collection} />
            <Button type="button" variant="secondary" className="w-full" onClick={prefillMortgageCalculator}>
              Estimate Payment
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function AgentListings({ siteId, agentName, brokerage, collection = 'current', hideWhenEmpty = false }: AgentListingsProps) {
  const [listings, setListings] = useState<OnekeyListing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'openhouse'>('all')
  const copy = sectionCopy[collection]
  const showOpenHouseFilters = collection === 'current'

  useEffect(() => {
    async function fetchListings() {
      try {
        setLoading(true)
        const params = new URLSearchParams()
        if (siteId) params.set('siteId', siteId)
        if (agentName) params.set('agent', agentName)
        if (brokerage) params.set('brokerage', brokerage)
        params.set('collection', collection)
        params.set('limit', '24')
        
        const res = await fetch(`/api/agent-listings?${params}`)
        const data = await res.json()
        
        if (data.error) {
          setError(data.error)
          setListings([])
        } else {
          setListings(data.listings || [])
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load listings')
        setListings([])
      } finally {
        setLoading(false)
      }
    }
    
    if (agentName || brokerage) {
      fetchListings()
    }
  }, [agentName, brokerage, collection, siteId])

  const openHouseListings = listings.filter(l => l.openHouse)
  const filteredListings = showOpenHouseFilters && filter === 'openhouse' ? openHouseListings : listings

  if (loading) {
    if (hideWhenEmpty) return null
    return (
      <section id={copy.id} className="py-20 lg:py-32 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-accent font-medium tracking-wide uppercase text-sm mb-4">
              {copy.eyebrow}
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
              {copy.title}
            </h2>
          </div>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="ml-3 text-muted-foreground">{copy.loading}</span>
          </div>
        </div>
      </section>
    )
  }

  if (listings.length === 0) {
    if (hideWhenEmpty) return null
    return (
      <section id={copy.id} className="py-20 lg:py-32 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-accent font-medium tracking-wide uppercase text-sm mb-4">
              {copy.eyebrow}
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
              {copy.title}
            </h2>
          </div>
          <div className="text-center py-12">
            <Home className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground mb-2">
              {copy.emptyTitle}
            </p>
            <p className="text-sm text-muted-foreground">
              {copy.emptyDescription}
            </p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section id={copy.id} className="py-20 lg:py-32 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <p className="text-accent font-medium tracking-wide uppercase text-sm mb-4">
            {copy.eyebrow}
          </p>
          <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
            {copy.title}
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            {copy.description}
          </p>
        </div>

        {/* Filter Tabs */}
        {showOpenHouseFilters && (
          <div className="flex flex-wrap justify-center gap-2 mb-10">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              filter === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
          >
            All Listings ({listings.length})
          </button>
          {openHouseListings.length > 0 && (
            <button
              onClick={() => setFilter('openhouse')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 ${
                filter === 'openhouse'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              <Calendar className="h-3.5 w-3.5" />
              Open Houses ({openHouseListings.length})
            </button>
          )}
          </div>
        )}

        {/* Listings Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredListings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} collection={collection} />
          ))}
        </div>

        {filteredListings.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              No listings found in this category.
            </p>
          </div>
        )}

        {/* Auto-update notice */}
        <p className="text-center text-xs text-muted-foreground mt-8">
          {copy.notice}
        </p>
      </div>
    </section>
  )
}
