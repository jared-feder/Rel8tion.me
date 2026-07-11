'use client'

import Image from 'next/image'
import { useState } from 'react'
import { Bed, Bath, Square, MapPin, ArrowRight, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Listing } from '@/lib/types'

interface ListingsProps {
  listings: Listing[]
}

function formatPrice(price: number): string {
  if (price >= 1000000) {
    return `$${(price / 1000000).toFixed(price % 1000000 === 0 ? 0 : 2)}M`
  }
  return `$${price.toLocaleString()}`
}

function getStatusColor(status: Listing['status']) {
  switch (status) {
    case 'active':
      return 'bg-green-500/10 text-green-700 border-green-200'
    case 'pending':
      return 'bg-amber-500/10 text-amber-700 border-amber-200'
    case 'sold':
      return 'bg-muted text-muted-foreground border-border'
    default:
      return ''
  }
}

function fullAddress(listing: Listing) {
  return [listing.address, listing.city, listing.state, listing.zipCode].filter(Boolean).join(', ')
}

function ListingDetailsDialog({ listing }: { listing: Listing }) {
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
              <Image
                src={listing.images[0] || '/images/listing-placeholder.jpg'}
                alt={listing.title}
                fill
                className="object-cover"
              />
            </div>
            {listing.images.length > 1 && (
              <div className="grid grid-cols-4 gap-2 p-3">
                {listing.images.slice(1, 5).map((image) => (
                  <div key={image} className="relative aspect-[4/3] overflow-hidden rounded-md bg-background">
                    <Image src={image} alt="" fill className="object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-5 p-6">
            <DialogHeader>
              <Badge className={`${getStatusColor(listing.status)} w-fit capitalize`}>{listing.status}</Badge>
              <DialogTitle className="text-2xl leading-tight">{listing.title}</DialogTitle>
              <DialogDescription>{fullAddress(listing)}</DialogDescription>
            </DialogHeader>

            <p className="text-3xl font-black text-foreground">{formatPrice(listing.price)}</p>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Beds', value: listing.bedrooms },
                { label: 'Baths', value: listing.bathrooms },
                { label: 'Sqft', value: listing.squareFeet.toLocaleString() },
                { label: 'Type', value: listing.propertyType },
              ].map((fact) => (
                <div key={fact.label} className="rounded-md border bg-background px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{fact.label}</p>
                  <p className="font-bold">{fact.value}</p>
                </div>
              ))}
            </div>

            {listing.description && (
              <div>
                <h4 className="mb-2 font-bold">Property Details</h4>
                <p className="text-sm leading-6 text-muted-foreground">{listing.description}</p>
              </div>
            )}

            {listing.features.length > 0 && (
              <div>
                <h4 className="mb-2 font-bold">Features</h4>
                <div className="flex flex-wrap gap-2">
                  {listing.features.map((feature) => (
                    <span key={feature} className="rounded-md bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                      {feature}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(listing.mlsNumber || listing.virtualTourUrl) && (
              <DialogFooter>
                {listing.virtualTourUrl && (
                  <Button asChild>
                    <a href={listing.virtualTourUrl} target="_blank" rel="noopener noreferrer">
                      Open Virtual Tour
                      <ExternalLink className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                )}
                {listing.mlsNumber && (
                  <p className="self-center text-xs text-muted-foreground">MLS ID: {listing.mlsNumber}</p>
                )}
              </DialogFooter>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ListingCard({ listing }: { listing: Listing }) {
  return (
    <Card className="group overflow-hidden border-border hover:shadow-xl transition-all duration-300">
      {/* Image */}
      <div className="relative aspect-[4/3] overflow-hidden">
        <Image
          src={listing.images[0] || '/images/listing-placeholder.jpg'}
          alt={listing.title}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div className="absolute top-4 left-4">
          <Badge className={`${getStatusColor(listing.status)} capitalize`}>
            {listing.status}
          </Badge>
        </div>
        <div className="absolute top-4 right-4">
          <Badge variant="secondary" className="bg-card/90 backdrop-blur-sm text-foreground">
            {listing.propertyType}
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
          {listing.title}
        </h3>
        
        <div className="flex items-center gap-1.5 text-muted-foreground mb-4">
          <MapPin className="h-4 w-4 shrink-0" />
          <span className="text-sm line-clamp-1">
            {listing.address}, {listing.city}, {listing.state}
          </span>
        </div>

        {/* Features */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
          <div className="flex items-center gap-1.5">
            <Bed className="h-4 w-4" />
            <span>{listing.bedrooms} Beds</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Bath className="h-4 w-4" />
            <span>{listing.bathrooms} Baths</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Square className="h-4 w-4" />
            <span>{listing.squareFeet.toLocaleString()} sqft</span>
          </div>
        </div>

        {/* Feature Tags */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {listing.features.slice(0, 3).map((feature) => (
            <span
              key={feature}
              className="text-xs px-2 py-1 bg-secondary rounded-md text-secondary-foreground"
            >
              {feature}
            </span>
          ))}
          {listing.features.length > 3 && (
            <span className="text-xs px-2 py-1 text-muted-foreground">
              +{listing.features.length - 3} more
            </span>
          )}
        </div>

        <ListingDetailsDialog listing={listing} />
      </CardContent>
    </Card>
  )
}

export function Listings({ listings }: ListingsProps) {
  const [filter, setFilter] = useState<'all' | 'active' | 'pending' | 'sold'>('all')

  const filteredListings = listings.filter(
    (listing) => filter === 'all' || listing.status === filter
  )

  const activeCount = listings.filter((l) => l.status === 'active').length
  const pendingCount = listings.filter((l) => l.status === 'pending').length
  const soldCount = listings.filter((l) => l.status === 'sold').length

  return (
    <section id="listings" className="py-20 lg:py-32 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <p className="text-accent font-medium tracking-wide uppercase text-sm mb-4">
            Featured Properties
          </p>
          <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
            Current Listings
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Explore my curated selection of exceptional properties. Each listing
            represents the finest homes in the most desirable locations.
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {[
            { key: 'all', label: 'All', count: listings.length },
            { key: 'active', label: 'Active', count: activeCount },
            { key: 'pending', label: 'Pending', count: pendingCount },
            { key: 'sold', label: 'Sold', count: soldCount },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key as typeof filter)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                filter === tab.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        {/* Listings Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredListings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>

        {filteredListings.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              No listings found in this category.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
