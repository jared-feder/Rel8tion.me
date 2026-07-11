'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, Copy, ExternalLink, Globe, Loader2, Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AgentWebsite, BrandOption, DEFAULT_DOMAIN, generateSlug, normalizeDomain, siteUrl, statusLabel } from '@/lib/builder'
import { getHeroImageForTheme } from '@/lib/theme-images'

interface SitesResponse {
  configured: boolean
  sites: AgentWebsite[]
  error?: string
}

interface BrandsResponse {
  brands: BrandOption[]
}

const fallbackBrands: BrandOption[] = [
  {
    id: 'warm-earth',
    name: 'Warm Earth',
    primary_color: '#8B7355',
    secondary_color: '#D4C4B0',
    accent_color: '#C4956A',
    source: 'built-in',
  },
  {
    id: 'ocean-blue',
    name: 'Ocean Blue',
    primary_color: '#1E3A5F',
    secondary_color: '#E8F0F8',
    accent_color: '#4A90C2',
    source: 'built-in',
  },
  {
    id: 'forest-green',
    name: 'Forest Green',
    primary_color: '#2D4A3E',
    secondary_color: '#E8F0EC',
    accent_color: '#5B8A72',
    source: 'built-in',
  },
  {
    id: 'charcoal',
    name: 'Charcoal',
    primary_color: '#2C2C2C',
    secondary_color: '#F5F5F5',
    accent_color: '#666666',
    source: 'built-in',
  },
  {
    id: 'burgundy',
    name: 'Burgundy',
    primary_color: '#722F37',
    secondary_color: '#F8F0F1',
    accent_color: '#A94452',
    source: 'built-in',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    primary_color: '#1A1A2E',
    secondary_color: '#EEEEF2',
    accent_color: '#4A4A6A',
    source: 'built-in',
  },
]

function statusColor(status: string) {
  if (status === 'published') return 'bg-green-500/10 text-green-700 border-green-200'
  if (status === 'pending_dns') return 'bg-amber-500/10 text-amber-700 border-amber-200'
  return 'bg-muted text-muted-foreground border-border'
}

function DomainRecords({ domain }: { domain?: string }) {
  const [copied, setCopied] = useState('')
  const records = [
    { type: 'A', name: '@', value: '76.76.21.21' },
    { type: 'CNAME', name: 'www', value: 'cname.vercel-dns.com' },
  ]

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value)
    setCopied(value)
    window.setTimeout(() => setCopied(''), 1600)
  }

  return (
    <div className="rounded-md border bg-blue-50/50 p-4">
      <h4 className="font-medium text-sm mb-2">Hostinger DNS for {domain || 'your domain'}</h4>
      <p className="text-xs text-muted-foreground mb-3">
        Add these records in Hostinger. After DNS is saved, the domain still needs to be attached to the Vercel project for SSL.
      </p>
      <div className="overflow-hidden rounded-md border bg-background">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Type</th>
              <th className="px-2 py-1.5 text-left font-medium">Name</th>
              <th className="px-2 py-1.5 text-left font-medium">Value</th>
              <th className="px-2 py-1.5 text-right font-medium">Copy</th>
            </tr>
          </thead>
          <tbody className="divide-y font-mono">
            {records.map((record) => (
              <tr key={record.type}>
                <td className="px-2 py-1.5">{record.type}</td>
                <td className="px-2 py-1.5">{record.name}</td>
                <td className="px-2 py-1.5">{record.value}</td>
                <td className="px-2 py-1.5 text-right">
                  <button type="button" onClick={() => copy(record.value)} className="text-primary">
                    {copied === record.value ? 'Copied' : 'Copy'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CreateSiteDialog({
  brands,
  onSiteCreated,
}: {
  brands: BrandOption[]
  onSiteCreated: (site: AgentWebsite) => void
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    title: '',
    brokerage: '',
    email: '',
    phone: '',
    bio: '',
    colorScheme: brands[0]?.id || 'warm-earth',
    websiteSlug: '',
    customDomain: '',
    facebook: '',
    instagram: '',
    linkedin: '',
  })

  useEffect(() => {
    if (!formData.colorScheme && brands[0]?.id) {
      setFormData((current) => ({ ...current, colorScheme: brands[0].id }))
    }
  }, [brands, formData.colorScheme])

  const selectedBrand = brands.find((brand) => brand.id === formData.colorScheme) || brands[0]

  const handleNameChange = (name: string) => {
    setFormData((current) => ({
      ...current,
      name,
      websiteSlug: current.websiteSlug || generateSlug(name),
    }))
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setError('')

    try {
      const customDomain = formData.customDomain ? normalizeDomain(formData.customDomain) : ''
      const response = await fetch('/api/admin/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          slug: formData.websiteSlug,
          title: formData.title || 'Real Estate Agent',
          brokerage: formData.brokerage,
          email: formData.email,
          phone: formData.phone,
          bio: formData.bio,
          colorScheme: formData.colorScheme,
          customDomain,
          facebook: formData.facebook,
          instagram: formData.instagram,
          linkedin: formData.linkedin,
        }),
      })
      const data = await response.json()

      if (!response.ok || !data.site) {
        throw new Error(data.error || 'Failed to create site.')
      }

      onSiteCreated(data.site)
      setOpen(false)
      setStep(1)
      setFormData({
        name: '',
        title: '',
        brokerage: '',
        email: '',
        phone: '',
        bio: '',
        colorScheme: brands[0]?.id || 'warm-earth',
        websiteSlug: '',
        customDomain: '',
        facebook: '',
        instagram: '',
        linkedin: '',
      })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to create site.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Create Site
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Agent Website</DialogTitle>
          <DialogDescription>
            Build a live agent site with REL8TION brokerage branding, matching homepage image, and optional Hostinger domain.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-6">
          {[1, 2, 3].map((item) => (
            <div key={item} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                item === step ? 'bg-primary text-primary-foreground' :
                item < step ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
              }`}>
                {item}
              </div>
              {item < 3 && <div className={`w-12 h-0.5 ${item < step ? 'bg-primary' : 'bg-muted'}`} />}
            </div>
          ))}
          <span className="text-sm text-muted-foreground ml-2">
            {step === 1 ? 'Agent Info' : step === 2 ? 'Branding & Image' : 'URL & Hostinger Domain'}
          </span>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="site-name">Full Name *</Label>
                <Input
                  id="site-name"
                  value={formData.name}
                  onChange={(event) => handleNameChange(event.target.value)}
                  placeholder="Agent name"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="site-title">Title</Label>
                <Input
                  id="site-title"
                  value={formData.title}
                  onChange={(event) => setFormData((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Real Estate Agent"
                  className="mt-1.5"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="site-brokerage">Brokerage</Label>
              <Input
                id="site-brokerage"
                value={formData.brokerage}
                onChange={(event) => setFormData((current) => ({ ...current, brokerage: event.target.value }))}
                placeholder="Brokerage name"
                className="mt-1.5"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="site-email">Email</Label>
                <Input
                  id="site-email"
                  type="email"
                  value={formData.email}
                  onChange={(event) => setFormData((current) => ({ ...current, email: event.target.value }))}
                  placeholder="agent@example.com"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="site-phone">Phone</Label>
                <Input
                  id="site-phone"
                  value={formData.phone}
                  onChange={(event) => setFormData((current) => ({ ...current, phone: event.target.value }))}
                  placeholder="(555) 123-4567"
                  className="mt-1.5"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="site-bio">Bio</Label>
              <Textarea
                id="site-bio"
                value={formData.bio}
                onChange={(event) => setFormData((current) => ({ ...current, bio: event.target.value }))}
                placeholder="Short agent bio"
                className="mt-1.5"
                rows={3}
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div>
              <Label className="text-base font-medium mb-3 block">Brand / Template</Label>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {brands.map((brand) => (
                  <button
                    type="button"
                    key={brand.id}
                    onClick={() => setFormData((current) => ({ ...current, colorScheme: brand.id }))}
                    className={`relative rounded-lg border-2 p-3 text-left transition-all ${
                      formData.colorScheme === brand.id
                        ? 'border-primary shadow-md'
                        : 'border-border hover:border-muted-foreground'
                    }`}
                  >
                    <div className="mb-3 flex h-9 overflow-hidden rounded">
                      <span className="flex-1" style={{ backgroundColor: brand.primary_color }} />
                      <span className="flex-1" style={{ backgroundColor: brand.secondary_color }} />
                      <span className="flex-1" style={{ backgroundColor: brand.accent_color }} />
                    </div>
                    <p className="line-clamp-1 text-sm font-medium">{brand.name}</p>
                    <p className="text-xs capitalize text-muted-foreground">{brand.source}</p>
                    {formData.colorScheme === brand.id && (
                      <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-[180px_1fr]">
              <div className="aspect-[4/3] overflow-hidden rounded-md bg-muted">
                <img
                  src={getHeroImageForTheme(formData.colorScheme, selectedBrand?.primary_color)}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
              <div>
                <p className="font-medium">{selectedBrand?.name || 'Selected brand'}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  The homepage hero image is matched automatically to the selected palette. REL8TION brokerages use their stored colors and logo data from the `brokerages` table when available.
                </p>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div>
              <Label htmlFor="site-slug">Website URL *</Label>
              <div className="flex items-center mt-1.5">
                <span className="bg-muted px-3 py-2 rounded-l-md border border-r-0 text-sm text-muted-foreground">
                  {DEFAULT_DOMAIN}/
                </span>
                <Input
                  id="site-slug"
                  value={formData.websiteSlug}
                  onChange={(event) => setFormData((current) => ({ ...current, websiteSlug: generateSlug(event.target.value) }))}
                  placeholder="agent-name"
                  className="rounded-l-none"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="custom-domain">Hostinger Domain (optional)</Label>
              <Input
                id="custom-domain"
                value={formData.customDomain}
                onChange={(event) => setFormData((current) => ({ ...current, customDomain: event.target.value }))}
                placeholder="agentdomain.com"
                className="mt-1.5"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Paste the domain you bought in Hostinger. No `https://` needed.
              </p>
            </div>

            {formData.customDomain && <DomainRecords domain={normalizeDomain(formData.customDomain)} />}

            <div className="rounded-lg border bg-muted/45 p-4 text-sm text-muted-foreground">
              <p className="font-semibold text-foreground">Listing sync</p>
              <p className="mt-1">
                If this agent has active listings we can match, they will auto-populate on the site. You can also add or edit listings directly from the Listings tab.
              </p>
            </div>

            <div className="rounded-lg bg-muted/50 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Agent</span>
                <span className="font-medium">{formData.name || '-'}</span>
              </div>
              <div className="mt-2 flex justify-between gap-4">
                <span className="text-muted-foreground">Brand</span>
                <span>{selectedBrand?.name || '-'}</span>
              </div>
              <div className="mt-2 flex justify-between gap-4">
                <span className="text-muted-foreground">Default URL</span>
                <span className="font-mono text-xs">{DEFAULT_DOMAIN}/{formData.websiteSlug || 'agent-name'}</span>
              </div>
              {formData.customDomain && (
                <div className="mt-2 flex justify-between gap-4">
                  <span className="text-muted-foreground">Custom Domain</span>
                  <span className="font-mono text-xs">{normalizeDomain(formData.customDomain)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter className="mt-6">
          {step > 1 && (
            <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {step < 3 ? (
            <Button type="button" onClick={() => setStep(step + 1)} disabled={step === 1 && !formData.name.trim()}>
              Continue
            </Button>
          ) : (
            <Button type="button" onClick={handleSubmit} disabled={!formData.websiteSlug || isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
              {isSubmitting ? 'Creating...' : 'Create Site'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DomainConfigDialog({ site }: { site: AgentWebsite }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          DNS
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Hostinger Domain Setup</DialogTitle>
          <DialogDescription>
            DNS records for {site.custom_domain || `my.rel8tion.me/${site.slug}`}.
          </DialogDescription>
        </DialogHeader>
        <DomainRecords domain={site.custom_domain || undefined} />
      </DialogContent>
    </Dialog>
  )
}

export function SitesTab() {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sites, setSites] = useState<AgentWebsite[]>([])
  const [brands, setBrands] = useState<BrandOption[]>(fallbackBrands)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadSites() {
      try {
        const response = await fetch('/api/admin/sites', { cache: 'no-store' })
        const data: SitesResponse = await response.json()
        setSites(data.sites || [])
        setError(data.configured === false ? data.error || 'Database is not configured.' : '')
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load sites.')
      } finally {
        setIsLoading(false)
      }
    }

    async function loadBrands() {
      try {
        const response = await fetch('/api/brands', { cache: 'no-store' })
        const data: BrandsResponse = await response.json()
        if (Array.isArray(data.brands) && data.brands.length > 0) {
          setBrands(data.brands)
        }
      } catch {
        setBrands(fallbackBrands)
      }
    }

    loadSites()
    loadBrands()
  }, [])

  const brandById = useMemo(() => new Map(brands.map((brand) => [brand.id, brand])), [brands])

  const filteredSites = sites.filter((site) => {
    const query = searchQuery.toLowerCase()
    const matchesSearch =
      site.name.toLowerCase().includes(query) ||
      site.slug.toLowerCase().includes(query) ||
      (site.custom_domain || '').toLowerCase().includes(query)
    const matchesStatus = statusFilter === 'all' || site.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const handleSiteCreated = (newSite: AgentWebsite) => {
    setSites((current) => [newSite, ...current])
  }

  const handleDeleteSite = async (id: string) => {
    if (!confirm('Delete this agent website?')) return

    const response = await fetch(`/api/admin/sites?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (response.ok) {
      setSites((current) => current.filter((site) => site.id !== id))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-1">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search sites..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="pending_dns">Pending DNS</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <CreateSiteDialog brands={brands} onSiteCreated={handleSiteCreated} />
      </div>

      {error && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-start gap-3 p-4 text-amber-900">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredSites.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No sites yet</h3>
            <p className="text-muted-foreground mb-4">Create an agent website with brokerage branding and optional Hostinger domain.</p>
            <CreateSiteDialog brands={brands} onSiteCreated={handleSiteCreated} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSites.map((site) => {
            const brand = brandById.get(site.color_scheme || '')
            return (
              <Card key={site.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">{site.name}</CardTitle>
                      <CardDescription className="mt-1">{site.views || 0} views</CardDescription>
                    </div>
                    <Badge className={statusColor(site.status)}>{statusLabel(site.status)}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="overflow-hidden rounded-md border bg-muted">
                    <img
                      src={getHeroImageForTheme(site.color_scheme || 'warm-earth', brand?.primary_color)}
                      alt=""
                      className="h-28 w-full object-cover"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      <a
                        href={siteUrl(site)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-muted-foreground hover:text-foreground"
                      >
                        {site.custom_domain || `${DEFAULT_DOMAIN}/${site.slug}`}
                      </a>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: brand?.primary_color || '#8B7355' }} />
                      {brand?.name || site.color_scheme || 'Warm Earth'}
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" className="flex-1" asChild>
                      <a href={siteUrl(site)} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 mr-2" />
                        View
                      </a>
                    </Button>
                    <DomainConfigDialog site={site} />
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteSite(site.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
