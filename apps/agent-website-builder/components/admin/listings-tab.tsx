'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Bath, Bed, Check, ExternalLink, Home, Image as ImageIcon, Loader2, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AgentWebsite, siteUrl } from '@/lib/builder'

interface SitesResponse {
  sites: AgentWebsite[]
  error?: string
}

interface Listing {
  id: string
  agent_website_id: string
  source: string
  source_listing_id: string | null
  mls_id: string | null
  title: string | null
  address: string
  city: string | null
  state: string | null
  zip: string | null
  price: number | null
  beds: number | null
  baths: number | null
  sqft: number | null
  lot_size: number | null
  year_built: number | null
  annual_property_taxes: number | null
  property_type: string | null
  listing_status: string
  description: string | null
  features: string[]
  images: string[]
  primary_image: string | null
  listing_url: string | null
  open_house_start: string | null
  open_house_end: string | null
  sort_order: number
  is_featured: boolean
  disclaimer: string | null
}

interface ListingsResponse {
  listings: Listing[]
  error?: string
}

interface ListingFormData {
  agentWebsiteId: string
  title: string
  address: string
  city: string
  state: string
  zip: string
  price: string
  beds: string
  baths: string
  sqft: string
  lotSize: string
  yearBuilt: string
  annualPropertyTaxes: string
  propertyType: string
  status: string
  description: string
  features: string
  images: string[]
  listingUrl: string
  mlsId: string
  openHouseStart: string
  openHouseEnd: string
  sortOrder: string
  isFeatured: boolean
  disclaimer: string
}

const blankListing: ListingFormData = {
  agentWebsiteId: '',
  title: '',
  address: '',
  city: '',
  state: 'NY',
  zip: '',
  price: '',
  beds: '',
  baths: '',
  sqft: '',
  lotSize: '',
  yearBuilt: '',
  annualPropertyTaxes: '',
  propertyType: 'Residential',
  status: 'active',
  description: '',
  features: '',
  images: [],
  listingUrl: '',
  mlsId: '',
  openHouseStart: '',
  openHouseEnd: '',
  sortOrder: '0',
  isFeatured: true,
  disclaimer: '',
}

const statuses = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'sold', label: 'Sold' },
  { value: 'off_market', label: 'Off Market' },
  { value: 'draft', label: 'Draft' },
]

function money(value?: number | null) {
  if (!value) return 'Price not set'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function dateTimeInput(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60 * 1000)
  return local.toISOString().slice(0, 16)
}

function statusClass(status: string) {
  if (status === 'active') return 'bg-green-500/10 text-green-700 border-green-200'
  if (status === 'pending') return 'bg-amber-500/10 text-amber-700 border-amber-200'
  if (status === 'draft') return 'bg-muted text-muted-foreground border-border'
  return 'bg-blue-500/10 text-blue-700 border-blue-200'
}

function listingToForm(listing: Listing): ListingFormData {
  return {
    agentWebsiteId: listing.agent_website_id,
    title: listing.title || '',
    address: listing.address || '',
    city: listing.city || '',
    state: listing.state || 'NY',
    zip: listing.zip || '',
    price: listing.price ? String(listing.price) : '',
    beds: listing.beds ? String(listing.beds) : '',
    baths: listing.baths ? String(listing.baths) : '',
    sqft: listing.sqft ? String(listing.sqft) : '',
    lotSize: listing.lot_size ? String(listing.lot_size) : '',
    yearBuilt: listing.year_built ? String(listing.year_built) : '',
    annualPropertyTaxes: listing.annual_property_taxes ? String(listing.annual_property_taxes) : '',
    propertyType: listing.property_type || 'Residential',
    status: listing.listing_status || 'active',
    description: listing.description || '',
    features: (listing.features || []).join(', '),
    images: listing.images || [],
    listingUrl: listing.listing_url || '',
    mlsId: listing.mls_id || '',
    openHouseStart: dateTimeInput(listing.open_house_start),
    openHouseEnd: dateTimeInput(listing.open_house_end),
    sortOrder: String(listing.sort_order || 0),
    isFeatured: listing.is_featured !== false,
    disclaimer: listing.disclaimer || '',
  }
}

async function uploadListingImage(file: File) {
  const body = new FormData()
  body.append('file', file)
  body.append('kind', 'listing')

  const response = await fetch('/api/admin/assets', {
    method: 'POST',
    body,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.url) throw new Error(data.error || 'Image upload failed.')
  return data.url as string
}

function ListingDialog({
  sites,
  selectedSiteId,
  listing,
  onSaved,
}: {
  sites: AgentWebsite[]
  selectedSiteId: string
  listing?: Listing
  onSaved: (listing: Listing) => void
}) {
  const [open, setOpen] = useState(false)
  const [formData, setFormData] = useState<ListingFormData>({
    ...blankListing,
    agentWebsiteId: listing?.agent_website_id || selectedSiteId || sites[0]?.id || '',
  })
  const [draftImage, setDraftImage] = useState('')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setFormData(listing ? listingToForm(listing) : { ...blankListing, agentWebsiteId: selectedSiteId || sites[0]?.id || '' })
    setDraftImage('')
    setError('')
  }, [listing, open, selectedSiteId, sites])

  const addImage = (url: string) => {
    const clean = url.trim()
    if (!clean) return
    setFormData((current) => ({ ...current, images: [...current.images, clean].slice(0, 24) }))
    setDraftImage('')
  }

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      addImage(await uploadListingImage(file))
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Image upload failed.')
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  const removeImage = (index: number) => {
    setFormData((current) => ({ ...current, images: current.images.filter((_, currentIndex) => currentIndex !== index) }))
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')

    try {
      const method = listing ? 'PATCH' : 'POST'
      const response = await fetch('/api/admin/listings', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: listing?.id,
          ...formData,
          source: listing?.source || 'manual',
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.listing) throw new Error(data.error || 'Unable to save listing.')
      onSaved(data.listing)
      setOpen(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save listing.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {listing ? (
          <Button variant="outline" size="sm">
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
        ) : (
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Listing
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{listing ? 'Edit Listing' : 'Add Listing'}</DialogTitle>
          <DialogDescription>
            Add only listings this agent is allowed to advertise on their website.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-4">
          <div>
            <Label>Agent Website</Label>
            <select
              value={formData.agentWebsiteId}
              onChange={(event) => setFormData((current) => ({ ...current, agentWebsiteId: event.target.value }))}
              className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
            >
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Property Address *</Label>
              <Input value={formData.address} onChange={(event) => setFormData((current) => ({ ...current, address: event.target.value }))} className="mt-1.5" />
            </div>
            <div>
              <Label>Listing Title</Label>
              <Input value={formData.title} onChange={(event) => setFormData((current) => ({ ...current, title: event.target.value }))} placeholder="Beautiful updated colonial" className="mt-1.5" />
            </div>
            <div>
              <Label>City</Label>
              <Input value={formData.city} onChange={(event) => setFormData((current) => ({ ...current, city: event.target.value }))} className="mt-1.5" />
            </div>
            <div className="grid grid-cols-[1fr_1fr] gap-3">
              <div>
                <Label>State</Label>
                <Input value={formData.state} onChange={(event) => setFormData((current) => ({ ...current, state: event.target.value }))} className="mt-1.5" />
              </div>
              <div>
                <Label>ZIP</Label>
                <Input value={formData.zip} onChange={(event) => setFormData((current) => ({ ...current, zip: event.target.value }))} className="mt-1.5" />
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <Label>Price</Label>
              <Input value={formData.price} onChange={(event) => setFormData((current) => ({ ...current, price: event.target.value }))} inputMode="decimal" className="mt-1.5" />
            </div>
            <div>
              <Label>Beds</Label>
              <Input value={formData.beds} onChange={(event) => setFormData((current) => ({ ...current, beds: event.target.value }))} inputMode="decimal" className="mt-1.5" />
            </div>
            <div>
              <Label>Baths</Label>
              <Input value={formData.baths} onChange={(event) => setFormData((current) => ({ ...current, baths: event.target.value }))} inputMode="decimal" className="mt-1.5" />
            </div>
            <div>
              <Label>Sqft</Label>
              <Input value={formData.sqft} onChange={(event) => setFormData((current) => ({ ...current, sqft: event.target.value }))} inputMode="numeric" className="mt-1.5" />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Annual Property Taxes</Label>
              <Input value={formData.annualPropertyTaxes} onChange={(event) => setFormData((current) => ({ ...current, annualPropertyTaxes: event.target.value }))} inputMode="decimal" placeholder="Optional" className="mt-1.5" />
            </div>
            <div>
              <Label>Lot Size</Label>
              <Input value={formData.lotSize} onChange={(event) => setFormData((current) => ({ ...current, lotSize: event.target.value }))} inputMode="decimal" placeholder="Square feet or acres" className="mt-1.5" />
            </div>
            <div>
              <Label>Year Built</Label>
              <Input value={formData.yearBuilt} onChange={(event) => setFormData((current) => ({ ...current, yearBuilt: event.target.value }))} inputMode="numeric" placeholder="Optional" className="mt-1.5" />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Status</Label>
              <select value={formData.status} onChange={(event) => setFormData((current) => ({ ...current, status: event.target.value }))} className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
                {statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
              </select>
            </div>
            <div>
              <Label>Property Type</Label>
              <Input value={formData.propertyType} onChange={(event) => setFormData((current) => ({ ...current, propertyType: event.target.value }))} className="mt-1.5" />
            </div>
            <div>
              <Label>MLS ID</Label>
              <Input value={formData.mlsId} onChange={(event) => setFormData((current) => ({ ...current, mlsId: event.target.value }))} className="mt-1.5" />
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Textarea value={formData.description} onChange={(event) => setFormData((current) => ({ ...current, description: event.target.value }))} rows={4} className="mt-1.5" />
          </div>

          <div>
            <Label>Features</Label>
            <Input value={formData.features} onChange={(event) => setFormData((current) => ({ ...current, features: event.target.value }))} placeholder="Updated kitchen, finished basement, garage" className="mt-1.5" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Open House Start</Label>
              <Input type="datetime-local" value={formData.openHouseStart} onChange={(event) => setFormData((current) => ({ ...current, openHouseStart: event.target.value }))} className="mt-1.5" />
            </div>
            <div>
              <Label>Open House End</Label>
              <Input type="datetime-local" value={formData.openHouseEnd} onChange={(event) => setFormData((current) => ({ ...current, openHouseEnd: event.target.value }))} className="mt-1.5" />
            </div>
          </div>

          <div>
            <Label>External Listing URL</Label>
            <Input value={formData.listingUrl} onChange={(event) => setFormData((current) => ({ ...current, listingUrl: event.target.value }))} placeholder="Optional MLS/listing page URL" className="mt-1.5" />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <Label>Listing Images</Label>
              <span className="text-xs font-bold text-muted-foreground">{formData.images.length}/24</span>
            </div>
            {formData.images.length > 0 && (
              <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                {formData.images.map((url, index) => (
                  <div key={`${url}-${index}`} className="overflow-hidden rounded-xl border bg-white">
                    <img src={url} alt="" className="aspect-[4/3] w-full object-cover" />
                    <button type="button" onClick={() => removeImage(index)} className="flex w-full items-center justify-center gap-2 px-2 py-2 text-sm text-destructive">
                      <X className="h-4 w-4" />
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-[auto_1fr_auto]">
              <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-black text-primary-foreground">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? 'Uploading...' : 'Upload'}
                <input type="file" accept="image/*" disabled={uploading} onChange={handleUpload} className="hidden" />
              </label>
              <Input value={draftImage} onChange={(event) => setDraftImage(event.target.value)} placeholder="Or paste an image URL" />
              <Button type="button" variant="secondary" onClick={() => addImage(draftImage)} disabled={!draftImage.trim()}>
                Add URL
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[180px_1fr]">
            <div>
              <Label>Sort Order</Label>
              <Input value={formData.sortOrder} onChange={(event) => setFormData((current) => ({ ...current, sortOrder: event.target.value }))} inputMode="numeric" className="mt-1.5" />
            </div>
            <label className="mt-7 flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={formData.isFeatured} onChange={(event) => setFormData((current) => ({ ...current, isFeatured: event.target.checked }))} />
              Show on public site
            </label>
          </div>

          <div>
            <Label>Disclaimer</Label>
            <Textarea value={formData.disclaimer} onChange={(event) => setFormData((current) => ({ ...current, disclaimer: event.target.value }))} rows={2} className="mt-1.5" />
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || uploading}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            {saving ? 'Saving...' : 'Save Listing'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ListingsTab() {
  const [sites, setSites] = useState<AgentWebsite[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadSites() {
      try {
        const response = await fetch('/api/admin/sites', { cache: 'no-store' })
        const data: SitesResponse = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to load sites.')
        const loadedSites = data.sites || []
        setSites(loadedSites)
        setSelectedSiteId((current) => current || loadedSites[0]?.id || '')
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load sites.')
        setLoading(false)
      }
    }

    loadSites()
  }, [])

  useEffect(() => {
    if (!selectedSiteId) {
      setListings([])
      setLoading(false)
      return
    }

    async function loadListings() {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(`/api/admin/listings?siteId=${encodeURIComponent(selectedSiteId)}`, { cache: 'no-store' })
        const data: ListingsResponse = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to load listings.')
        setListings(data.listings || [])
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load listings.')
      } finally {
        setLoading(false)
      }
    }

    loadListings()
  }, [selectedSiteId])

  const selectedSite = useMemo(() => sites.find((site) => site.id === selectedSiteId) || null, [selectedSiteId, sites])

  const handleSaved = (listing: Listing) => {
    setListings((current) => [listing, ...current.filter((item) => item.id !== listing.id)])
  }

  const handleDelete = async (listing: Listing) => {
    if (!confirm(`Delete ${listing.address}?`)) return
    const response = await fetch(`/api/admin/listings?id=${encodeURIComponent(listing.id)}`, { method: 'DELETE' })
    if (response.ok) {
      setListings((current) => current.filter((item) => item.id !== listing.id))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-black">Agent Website Listings</h2>
          <p className="text-sm text-muted-foreground">Manage only the listings this agent is allowed to show on their public website.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <select
            value={selectedSiteId}
            onChange={(event) => setSelectedSiteId(event.target.value)}
            className="h-11 rounded-xl border border-input bg-background px-3 text-sm"
          >
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
          <ListingDialog sites={sites} selectedSiteId={selectedSiteId} onSaved={handleSaved} />
        </div>
      </div>

      {selectedSite && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">{selectedSite.name}</p>
              <p className="text-sm text-muted-foreground">{selectedSite.custom_domain || `my.rel8tion.me/${selectedSite.slug}`}</p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href={siteUrl(selectedSite)} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                View Site
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/30 bg-destructive/10">
          <CardContent className="flex items-start gap-3 p-4 text-destructive">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm font-semibold">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : listings.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <Home className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="font-semibold">No listings yet.</p>
            <p className="mb-4 text-sm text-muted-foreground">Add the agent's own listing or import it from your scraper.</p>
            <ListingDialog sites={sites} selectedSiteId={selectedSiteId} onSaved={handleSaved} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {listings.map((listing) => (
            <Card key={listing.id} className="overflow-hidden">
              <div className="grid md:grid-cols-[180px_1fr]">
                <div className="bg-muted">
                  {listing.primary_image || listing.images?.[0] ? (
                    <img src={listing.primary_image || listing.images[0]} alt="" className="h-full min-h-48 w-full object-cover" />
                  ) : (
                    <div className="flex h-full min-h-48 items-center justify-center text-muted-foreground">
                      <ImageIcon className="h-9 w-9" />
                    </div>
                  )}
                </div>
                <CardContent className="space-y-4 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-black">{listing.address}</h3>
                      <p className="text-sm text-muted-foreground">{[listing.city, listing.state, listing.zip].filter(Boolean).join(', ')}</p>
                    </div>
                    <Badge className={statusClass(listing.listing_status)}>{listing.listing_status.replace('_', ' ')}</Badge>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-sm">
                    <div>
                      <p className="text-muted-foreground">Price</p>
                      <p className="font-bold">{money(listing.price)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Beds</p>
                      <p className="flex items-center gap-1 font-bold"><Bed className="h-4 w-4" />{listing.beds || '-'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Baths</p>
                      <p className="flex items-center gap-1 font-bold"><Bath className="h-4 w-4" />{listing.baths || '-'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Sqft</p>
                      <p className="font-bold">{listing.sqft ? listing.sqft.toLocaleString() : '-'}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <ListingDialog sites={sites} selectedSiteId={selectedSiteId} listing={listing} onSaved={handleSaved} />
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDelete(listing)}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
