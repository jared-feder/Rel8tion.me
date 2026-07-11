'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Check,
  ExternalLink,
  Globe,
  Image as ImageIcon,
  Loader2,
  Palette,
  Plus,
  Search,
  Upload,
  User,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import { Badge } from '@/components/ui/badge'
import {
  AgentWebsite,
  AgentWebsiteTestimonial,
  BrandOption,
  DEFAULT_DOMAIN,
  generateSlug,
  normalizeDomain,
  siteUrl,
  statusLabel,
} from '@/lib/builder'
import { getHeroImageForTheme } from '@/lib/theme-images'

interface SitesResponse {
  configured: boolean
  sites: AgentWebsite[]
  error?: string
}

interface BrandsResponse {
  brands: BrandOption[]
}

interface AgentFormData {
  name: string
  email: string
  phone: string
  title: string
  bio: string
  brokerage: string
  licenseNumber: string
  rel8tionAgentId: string
  slug: string
  customDomain: string
  colorScheme: string
  photoUrl: string
  heroImageUrl: string
  aboutImageUrl: string
  galleryImageUrls: string[]
  facebook: string
  instagram: string
  linkedin: string
}

type AgentImageKind = 'photo' | 'hero' | 'about' | 'gallery'

const fallbackBrands: BrandOption[] = [
  { id: 'warm-earth', name: 'Warm Earth', primary_color: '#8B7355', secondary_color: '#D4C4B0', accent_color: '#C4956A', source: 'built-in' },
  { id: 'ocean-blue', name: 'Ocean Blue', primary_color: '#1E3A5F', secondary_color: '#E8F0F8', accent_color: '#4A90C2', source: 'built-in' },
  { id: 'forest-green', name: 'Forest Green', primary_color: '#2D4A3E', secondary_color: '#E8F0EC', accent_color: '#5B8A72', source: 'built-in' },
  { id: 'charcoal', name: 'Charcoal', primary_color: '#2C2C2C', secondary_color: '#F5F5F5', accent_color: '#666666', source: 'built-in' },
  { id: 'burgundy', name: 'Burgundy', primary_color: '#722F37', secondary_color: '#F8F0F1', accent_color: '#A94452', source: 'built-in' },
  { id: 'midnight', name: 'Midnight', primary_color: '#1A1A2E', secondary_color: '#EEEEF2', accent_color: '#4A4A6A', source: 'built-in' },
]

const blankForm: AgentFormData = {
  name: '',
  email: '',
  phone: '',
  title: 'Real Estate Agent',
  bio: '',
  brokerage: '',
  licenseNumber: '',
  rel8tionAgentId: '',
  slug: '',
  customDomain: '',
  colorScheme: 'ocean-blue',
  photoUrl: '',
  heroImageUrl: '',
  aboutImageUrl: '',
  galleryImageUrls: [],
  facebook: '',
  instagram: '',
  linkedin: '',
}

const setupSteps = ['Profile', 'Brand', 'Photos', 'URL', 'Review']

function stableId(prefix: string) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`
}

function normalizedRating(value: unknown) {
  const parsed = Number(value || 5)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(5, parsed)) : 5
}

function statusColor(status: string) {
  if (status === 'published') return 'bg-green-500/10 text-green-700 border-green-200'
  if (status === 'pending_dns') return 'bg-amber-500/10 text-amber-700 border-amber-200'
  return 'bg-muted text-muted-foreground border-border'
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'AG'
}

async function uploadAsset(file: File, kind: AgentImageKind) {
  const body = new FormData()
  body.append('file', file)
  body.append('kind', kind)

  const response = await fetch('/api/admin/assets', {
    method: 'POST',
    body,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.url) {
    throw new Error(data.error || 'Image upload failed.')
  }
  return data.url as string
}

function ImageUploader({
  label,
  value,
  fallback,
  onChange,
  kind,
  uploading,
  onUploadStart,
  onUploadEnd,
}: {
  label: string
  value: string
  fallback?: string
  onChange: (url: string) => void
  kind: AgentImageKind
  uploading: boolean
  onUploadStart: () => void
  onUploadEnd: () => void
}) {
  const visibleImage = value || fallback || ''
  const previewClass = kind === 'hero' ? 'aspect-[16/10]' : 'aspect-square'

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    onUploadStart()
    try {
      onChange(await uploadAsset(file, kind))
    } finally {
      onUploadEnd()
    }
  }

  return (
    <div className="space-y-3">
      <Label className="text-base font-medium">{label}</Label>
      <div className="overflow-hidden rounded-2xl border border-white/70 bg-white/60">
        <div className={previewClass}>
          {visibleImage ? (
            <img src={visibleImage} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <ImageIcon className="h-8 w-8" />
              <span className="text-sm font-semibold">No image selected</span>
            </div>
          )}
        </div>
        <div className="grid gap-3 p-4">
          <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-black text-primary-foreground shadow-sm">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? 'Uploading...' : 'Upload Image'}
            <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading} />
          </label>
          <Input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Or paste an image URL"
          />
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
              <X className="mr-2 h-4 w-4" />
              Clear custom image
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function GalleryImagesEditor({
  value,
  onChange,
  uploading,
  onUploadStart,
  onUploadEnd,
}: {
  value: string[]
  onChange: (urls: string[]) => void
  uploading: boolean
  onUploadStart: () => void
  onUploadEnd: () => void
}) {
  const [draftUrl, setDraftUrl] = useState('')
  const images = value.filter(Boolean).slice(0, 8)

  const addImage = (url: string) => {
    const clean = url.trim()
    if (!clean) return
    onChange([...images, clean].slice(0, 8))
    setDraftUrl('')
  }

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    onUploadStart()
    try {
      addImage(await uploadAsset(file, 'gallery'))
    } finally {
      onUploadEnd()
      event.target.value = ''
    }
  }

  const updateImage = (index: number, url: string) => {
    onChange(images.map((item, currentIndex) => (currentIndex === index ? url : item)).filter(Boolean))
  }

  const removeImage = (index: number) => {
    onChange(images.filter((_, currentIndex) => currentIndex !== index))
  }

  return (
    <div className="space-y-3 lg:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-base font-medium">Extra Homepage Images</Label>
        <span className="text-xs font-bold text-muted-foreground">{images.length}/8</span>
      </div>
      <div className="rounded-2xl border border-white/70 bg-white/60 p-4">
        {images.length > 0 && (
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {images.map((url, index) => (
              <div key={`${url}-${index}`} className="overflow-hidden rounded-xl border border-white/70 bg-white">
                <div className="aspect-[4/3] bg-muted">
                  <img src={url} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="grid gap-2 p-2">
                  <Input value={url} onChange={(event) => updateImage(index, event.target.value)} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeImage(index)}>
                    <X className="mr-2 h-4 w-4" />
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto]">
          <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-black text-primary-foreground shadow-sm">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? 'Uploading...' : 'Upload'}
            <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading || images.length >= 8} />
          </label>
          <Input
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            placeholder="Or paste an image URL"
            disabled={images.length >= 8}
          />
          <Button type="button" variant="secondary" onClick={() => addImage(draftUrl)} disabled={!draftUrl.trim() || images.length >= 8}>
            <Plus className="mr-2 h-4 w-4" />
            Add
          </Button>
        </div>
      </div>
    </div>
  )
}

function normalizeTestimonialsForEditor(value?: AgentWebsiteTestimonial[] | null): AgentWebsiteTestimonial[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => ({
      id: item.id || `testimonial-${index + 1}`,
      clientName: item.clientName || '',
      text: item.text || '',
      rating: normalizedRating(item.rating),
      date: item.date || new Date().toISOString().slice(0, 10),
      propertyType: item.propertyType || '',
    }))
    .filter((item) => item.clientName || item.text)
    .slice(0, 9)
}

function EditTestimonialsDialog({
  site,
  onSiteUpdated,
}: {
  site: AgentWebsite
  onSiteUpdated: (site: AgentWebsite) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [testimonials, setTestimonials] = useState<AgentWebsiteTestimonial[]>(normalizeTestimonialsForEditor(site.testimonials_json))
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [statusMessage, setStatusMessage] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setTestimonials(normalizeTestimonialsForEditor(site.testimonials_json))
    setErrorMessage('')
    setStatusMessage('')
  }, [isOpen, site])

  const updateTestimonial = (id: string, patch: Partial<AgentWebsiteTestimonial>) => {
    setTestimonials((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const addTestimonial = () => {
    setTestimonials((current) => [
      ...current,
      {
        id: stableId('testimonial'),
        clientName: '',
        text: '',
        rating: 5,
        date: new Date().toISOString().slice(0, 10),
        propertyType: '',
      },
    ].slice(0, 9))
  }

  const removeTestimonial = (id: string) => {
    setTestimonials((current) => current.filter((item) => item.id !== id))
  }

  const handleSave = async () => {
    setIsSaving(true)
    setErrorMessage('')
    setStatusMessage('')

    try {
      const cleaned = testimonials
        .map((item) => ({
          ...item,
          clientName: item.clientName.trim(),
          text: item.text.trim(),
          propertyType: item.propertyType?.trim() || '',
          rating: normalizedRating(item.rating),
        }))
        .filter((item) => item.clientName && item.text)

      const response = await fetch('/api/admin/sites', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: site.id,
          testimonials: cleaned,
        }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok || !data.site) {
        throw new Error(data.error || 'Unable to update testimonials.')
      }

      setTestimonials(normalizeTestimonialsForEditor(data.site.testimonials_json))
      onSiteUpdated(data.site)
      setStatusMessage('Testimonials saved.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to update testimonials.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Testimonials
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Testimonials for {site.name}</DialogTitle>
          <DialogDescription>
            Add real client quotes for this public agent website. Only completed client name and quote rows are published.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {testimonials.map((testimonial, index) => (
            <div key={testimonial.id} className="rounded-2xl border border-white/70 bg-white/60 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="font-black">Testimonial {index + 1}</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeTestimonial(testimonial.id)}>
                  <X className="mr-2 h-4 w-4" />
                  Remove
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Client Name</Label>
                  <Input value={testimonial.clientName} onChange={(event) => updateTestimonial(testimonial.id, { clientName: event.target.value })} className="mt-1.5" />
                </div>
                <div>
                  <Label>Context</Label>
                  <Input value={testimonial.propertyType || ''} onChange={(event) => updateTestimonial(testimonial.id, { propertyType: event.target.value })} placeholder="Buyer, seller, first-time buyer..." className="mt-1.5" />
                </div>
                <div>
                  <Label>Rating</Label>
                  <Input value={String(testimonial.rating)} onChange={(event) => updateTestimonial(testimonial.id, { rating: Number(event.target.value) })} inputMode="numeric" className="mt-1.5" />
                </div>
                <div>
                  <Label>Date</Label>
                  <Input value={testimonial.date.slice(0, 10)} onChange={(event) => updateTestimonial(testimonial.id, { date: event.target.value })} type="date" className="mt-1.5" />
                </div>
                <div className="sm:col-span-2">
                  <Label>Quote</Label>
                  <Textarea value={testimonial.text} onChange={(event) => updateTestimonial(testimonial.id, { text: event.target.value })} rows={3} className="mt-1.5" />
                </div>
              </div>
            </div>
          ))}

          {testimonials.length < 9 && (
            <Button type="button" variant="secondary" onClick={addTestimonial}>
              <Plus className="mr-2 h-4 w-4" />
              Add Testimonial
            </Button>
          )}
        </div>

        {statusMessage && <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{statusMessage}</div>}
        {errorMessage && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
            Close
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            {isSaving ? 'Saving...' : 'Save Testimonials'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddAgentDialog({
  children,
  openRequest,
  onAgentCreated,
}: {
  children: React.ReactNode
  openRequest: number
  onAgentCreated: (agent: AgentWebsite) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [uploading, setUploading] = useState<AgentImageKind | ''>('')
  const [errorMessage, setErrorMessage] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [formData, setFormData] = useState<AgentFormData>(blankForm)
  const [brands, setBrands] = useState<BrandOption[]>(fallbackBrands)

  useEffect(() => {
    if (openRequest > 0) setIsOpen(true)
  }, [openRequest])

  useEffect(() => {
    async function loadBrands() {
      try {
        const response = await fetch('/api/brands', { cache: 'no-store' })
        const data: BrandsResponse = await response.json()
        if (Array.isArray(data.brands) && data.brands.length) {
          setBrands(data.brands)
        }
      } catch {
        setBrands(fallbackBrands)
      }
    }
    if (isOpen) loadBrands()
  }, [isOpen])

  const selectedBrand = brands.find((brand) => brand.id === formData.colorScheme) || brands[0] || fallbackBrands[0]
  const matchedHero = getHeroImageForTheme(formData.colorScheme, selectedBrand?.primary_color)
  const finalHeroImage = formData.heroImageUrl || matchedHero

  const updateName = (name: string) => {
    setFormData((current) => ({
      ...current,
      name,
      slug: current.slug || generateSlug(name),
    }))
  }

  const resetDialog = () => {
    setStep(0)
    setFormData(blankForm)
    setErrorMessage('')
    setStatusMessage('')
    setUploading('')
  }

  const handleImport = async () => {
    const agentId = formData.rel8tionAgentId.trim()
    if (!agentId) {
      setErrorMessage('Enter a REL8TION Agent ID first.')
      return
    }

    setErrorMessage('')
    setStatusMessage('Looking up REL8TION agent details...')

    try {
      const response = await fetch(`/api/agent/${encodeURIComponent(agentId)}`)
      const data = await response.json()
      if (!response.ok || !data?.success || !data?.data) {
        throw new Error(data?.error || 'Agent was not found.')
      }

      const agent = data.data
      setFormData((current) => ({
        ...current,
        name: agent.name || current.name,
        email: agent.email || current.email,
        phone: agent.phone || current.phone,
        title: agent.title || current.title,
        bio: agent.bio || current.bio,
        brokerage: agent.brokerage || current.brokerage,
        licenseNumber: agent.licenseNumber || current.licenseNumber,
        photoUrl: agent.photo || current.photoUrl,
        slug: current.slug || generateSlug(agent.name || current.name),
      }))
      setStatusMessage('Imported what REL8TION had. Continue through the rest of setup before creating the site.')
    } catch (error) {
      setStatusMessage('')
      setErrorMessage(error instanceof Error ? error.message : 'Unable to import this agent.')
    }
  }

  const nextStep = () => {
    setErrorMessage('')
    if (step === 0 && !formData.name.trim()) {
      setErrorMessage('Full name is required.')
      return
    }
    if (step === 3 && !formData.slug.trim()) {
      setErrorMessage('Website slug is required.')
      return
    }
    setStep((current) => Math.min(current + 1, setupSteps.length - 1))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setErrorMessage('')

    const name = formData.name.trim()
    const slug = generateSlug(formData.slug || name)
    if (!name || !slug) {
      setErrorMessage('Full name and website slug are required.')
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch('/api/admin/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          slug,
          title: formData.title || 'Real Estate Agent',
          brokerage: formData.brokerage,
          email: formData.email,
          phone: formData.phone,
          bio: formData.bio,
          licenseNumber: formData.licenseNumber,
          rel8tionAgentId: formData.rel8tionAgentId,
          photoUrl: formData.photoUrl || null,
          heroImageUrl: finalHeroImage,
          aboutImageUrl: formData.aboutImageUrl || null,
          galleryImageUrls: formData.galleryImageUrls,
          colorScheme: formData.colorScheme,
          customDomain: formData.customDomain ? normalizeDomain(formData.customDomain) : '',
          facebook: formData.facebook,
          instagram: formData.instagram,
          linkedin: formData.linkedin,
          status: 'published',
        }),
      })
      const data = await response.json()

      if (!response.ok || !data?.site) {
        throw new Error(data?.error || 'Unable to create the agent site.')
      }

      onAgentCreated(data.site)
      resetDialog()
      setIsOpen(false)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to create the agent site.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      setIsOpen(open)
      if (!open) resetDialog()
    }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Full Agent Website Setup</DialogTitle>
          <DialogDescription>
            Complete the full setup before creating the site, even for one agent. No demo-person photos are used for new sites.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          <div className="grid gap-2 sm:grid-cols-5">
            {setupSteps.map((label, index) => (
              <button
                key={label}
                type="button"
                onClick={() => index <= step && setStep(index)}
                className={`rounded-2xl px-3 py-3 text-sm font-black transition ${
                  index === step
                    ? 'bg-primary text-primary-foreground'
                    : index < step
                      ? 'bg-primary/10 text-primary'
                      : 'bg-white/60 text-muted-foreground'
                }`}
              >
                {index + 1}. {label}
              </button>
            ))}
          </div>

          {step === 0 && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-white/70 bg-white/56 p-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div>
                    <Label htmlFor="agent-rel8tion-id">REL8TION Agent ID</Label>
                    <Input
                      id="agent-rel8tion-id"
                      className="mt-1.5"
                      placeholder="Optional existing REL8TION agent id"
                      value={formData.rel8tionAgentId}
                      onChange={(event) => setFormData({ ...formData, rel8tionAgentId: event.target.value })}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button type="button" variant="secondary" onClick={handleImport}>Import</Button>
                  </div>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="agent-name">Full Name *</Label>
                  <Input id="agent-name" value={formData.name} onChange={(event) => updateName(event.target.value)} placeholder="Melissa Lastname" className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="agent-title">Title</Label>
                  <Input id="agent-title" value={formData.title} onChange={(event) => setFormData({ ...formData, title: event.target.value })} placeholder="Real Estate Agent" className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="agent-email">Email</Label>
                  <Input id="agent-email" type="email" value={formData.email} onChange={(event) => setFormData({ ...formData, email: event.target.value })} placeholder="agent@example.com" className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="agent-phone">Phone</Label>
                  <Input id="agent-phone" value={formData.phone} onChange={(event) => setFormData({ ...formData, phone: event.target.value })} placeholder="(555) 123-4567" className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="agent-brokerage">Company / Brokerage</Label>
                  <Input id="agent-brokerage" value={formData.brokerage} onChange={(event) => setFormData({ ...formData, brokerage: event.target.value })} placeholder="Brokerage" className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="agent-license">License Number</Label>
                  <Input id="agent-license" value={formData.licenseNumber} onChange={(event) => setFormData({ ...formData, licenseNumber: event.target.value })} placeholder="Optional" className="mt-1.5" />
                </div>
              </div>
              <div>
                <Label htmlFor="agent-bio">Bio</Label>
                <Textarea id="agent-bio" value={formData.bio} onChange={(event) => setFormData({ ...formData, bio: event.target.value })} placeholder="Short agent bio" rows={4} className="mt-1.5" />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {brands.map((brand) => (
                  <button
                    type="button"
                    key={brand.id}
                    onClick={() => setFormData((current) => ({ ...current, colorScheme: brand.id }))}
                    className={`relative rounded-2xl border-2 p-3 text-left transition-all ${
                      formData.colorScheme === brand.id ? 'border-primary shadow-md' : 'border-white/70 hover:border-primary/40'
                    }`}
                  >
                    <div className="mb-3 flex h-10 overflow-hidden rounded-xl">
                      <span className="flex-1" style={{ backgroundColor: brand.primary_color }} />
                      <span className="flex-1" style={{ backgroundColor: brand.secondary_color }} />
                      <span className="flex-1" style={{ backgroundColor: brand.accent_color }} />
                    </div>
                    <p className="line-clamp-1 text-sm font-black">{brand.name}</p>
                    <p className="text-xs capitalize text-muted-foreground">{brand.source}</p>
                    {formData.colorScheme === brand.id && (
                      <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="grid gap-4 rounded-2xl border border-white/70 bg-white/56 p-4 md:grid-cols-[220px_1fr]">
                <img src={matchedHero} alt="" className="aspect-[4/3] w-full rounded-xl object-cover" />
                <div>
                  <div className="flex items-center gap-2 font-black">
                    <Palette className="h-5 w-5 text-primary" />
                    {selectedBrand?.name}
                  </div>
                  <p className="mt-2 text-sm font-semibold text-muted-foreground">
                    This palette also picks a matching homepage hero if you do not upload a custom one.
                  </p>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-6 lg:grid-cols-2">
              <ImageUploader
                label="Agent Headshot"
                value={formData.photoUrl}
                onChange={(url) => setFormData((current) => ({ ...current, photoUrl: url }))}
                kind="photo"
                uploading={uploading === 'photo'}
                onUploadStart={() => setUploading('photo')}
                onUploadEnd={() => setUploading('')}
              />
              <ImageUploader
                label="Homepage Hero Image"
                value={formData.heroImageUrl}
                fallback={matchedHero}
                onChange={(url) => setFormData((current) => ({ ...current, heroImageUrl: url }))}
                kind="hero"
                uploading={uploading === 'hero'}
                onUploadStart={() => setUploading('hero')}
                onUploadEnd={() => setUploading('')}
              />
              <ImageUploader
                label="About Section Image"
                value={formData.aboutImageUrl}
                onChange={(url) => setFormData((current) => ({ ...current, aboutImageUrl: url }))}
                kind="about"
                uploading={uploading === 'about'}
                onUploadStart={() => setUploading('about')}
                onUploadEnd={() => setUploading('')}
              />
              <GalleryImagesEditor
                value={formData.galleryImageUrls}
                onChange={(urls) => setFormData((current) => ({ ...current, galleryImageUrls: urls }))}
                uploading={uploading === 'gallery'}
                onUploadStart={() => setUploading('gallery')}
                onUploadEnd={() => setUploading('')}
              />
              <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm font-semibold text-blue-900 lg:col-span-2">
                If no headshot is uploaded, the site shows a branded initials panel. Extra images are used on the homepage gallery and can also fill the about section.
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <Label htmlFor="agent-slug">Website URL *</Label>
                <div className="mt-1.5 flex">
                  <span className="rounded-l-xl border border-r-0 bg-white/70 px-3 py-2 text-sm font-semibold text-muted-foreground">{DEFAULT_DOMAIN}/</span>
                  <Input id="agent-slug" value={formData.slug} onChange={(event) => setFormData({ ...formData, slug: generateSlug(event.target.value) })} placeholder="melissa-lastname" className="rounded-l-none" />
                </div>
              </div>
              <div>
                <Label htmlFor="agent-domain">Hostinger Domain</Label>
                <Input id="agent-domain" value={formData.customDomain} onChange={(event) => setFormData({ ...formData, customDomain: event.target.value })} placeholder="melissasellshomes.com" className="mt-1.5" />
                <p className="mt-1 text-xs font-semibold text-muted-foreground">Optional. You can add this now or later.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="agent-facebook">Facebook</Label>
                  <Input id="agent-facebook" value={formData.facebook} onChange={(event) => setFormData({ ...formData, facebook: event.target.value })} className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="agent-instagram">Instagram</Label>
                  <Input id="agent-instagram" value={formData.instagram} onChange={(event) => setFormData({ ...formData, instagram: event.target.value })} className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="agent-linkedin">LinkedIn</Label>
                  <Input id="agent-linkedin" value={formData.linkedin} onChange={(event) => setFormData({ ...formData, linkedin: event.target.value })} className="mt-1.5" />
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
              <div className="overflow-hidden rounded-3xl border border-white/70 bg-white/60">
                <img src={finalHeroImage} alt="" className="aspect-[4/3] w-full object-cover" />
                <div className="p-4">
                  {formData.photoUrl ? (
                    <img src={formData.photoUrl} alt="" className="-mt-14 h-24 w-24 rounded-2xl border-4 border-white object-cover shadow-lg" />
                  ) : (
                    <div className="-mt-14 flex h-24 w-24 items-center justify-center rounded-2xl border-4 border-white bg-primary text-2xl font-black text-primary-foreground shadow-lg">
                      {initials(formData.name)}
                    </div>
                  )}
                  <h3 className="mt-3 text-xl font-black">{formData.name || 'Agent Name'}</h3>
                  <p className="text-sm font-semibold text-muted-foreground">{formData.title}</p>
                </div>
              </div>
              <div className="space-y-3 rounded-3xl border border-white/70 bg-white/60 p-5 text-sm">
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Brokerage</span><b>{formData.brokerage || 'Not set'}</b></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Phone</span><b>{formData.phone || 'Not set'}</b></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Email</span><b>{formData.email || 'Not set'}</b></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">License</span><b>{formData.licenseNumber || 'Not set'}</b></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Brand</span><b>{selectedBrand?.name}</b></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">About image</span><b>{formData.aboutImageUrl ? 'Custom' : formData.galleryImageUrls.length ? 'First gallery image' : 'Headshot fallback'}</b></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Gallery images</span><b>{formData.galleryImageUrls.length}</b></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">URL</span><b>{DEFAULT_DOMAIN}/{formData.slug || 'agent-name'}</b></div>
                {formData.customDomain && <div className="flex justify-between gap-4"><span className="text-muted-foreground">Domain</span><b>{normalizeDomain(formData.customDomain)}</b></div>}
              </div>
            </div>
          )}

          {statusMessage && <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{statusMessage}</div>}
          {errorMessage && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => step ? setStep(step - 1) : setIsOpen(false)}>
              {step ? 'Back' : 'Cancel'}
            </Button>
            {step < setupSteps.length - 1 ? (
              <Button type="button" onClick={nextStep}>Continue</Button>
            ) : (
              <Button type="submit" disabled={isSubmitting || Boolean(uploading)}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                {isSubmitting ? 'Creating...' : 'Create Website'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditImagesDialog({
  site,
  onSiteUpdated,
}: {
  site: AgentWebsite
  onSiteUpdated: (site: AgentWebsite) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [photoUrl, setPhotoUrl] = useState(site.photo_url || '')
  const [heroImageUrl, setHeroImageUrl] = useState(site.hero_image_url || '')
  const [aboutImageUrl, setAboutImageUrl] = useState(site.about_image_url || '')
  const [galleryImageUrls, setGalleryImageUrls] = useState<string[]>(site.gallery_image_urls || [])
  const [uploading, setUploading] = useState<AgentImageKind | ''>('')
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const fallbackHero = getHeroImageForTheme(site.color_scheme || 'warm-earth')

  useEffect(() => {
    if (!isOpen) return
    setPhotoUrl(site.photo_url || '')
    setHeroImageUrl(site.hero_image_url || '')
    setAboutImageUrl(site.about_image_url || '')
    setGalleryImageUrls(site.gallery_image_urls || [])
    setUploading('')
    setErrorMessage('')
    setStatusMessage('')
  }, [isOpen, site])

  const handleSave = async () => {
    setIsSaving(true)
    setErrorMessage('')
    setStatusMessage('')

    try {
      const response = await fetch('/api/admin/sites', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: site.id,
          photoUrl,
          heroImageUrl,
          aboutImageUrl,
          galleryImageUrls,
        }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok || !data.site) {
        throw new Error(data.error || 'Unable to update images.')
      }

      onSiteUpdated(data.site)
      setStatusMessage('Images saved.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to update images.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ImageIcon className="h-4 w-4 mr-2" />
          Images
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Images for {site.name}</DialogTitle>
          <DialogDescription>
            Replace the headshot, homepage hero, about image, and extra homepage gallery images. Changes apply to the live site after save.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4 lg:grid-cols-2">
          <ImageUploader
            label="Agent Headshot"
            value={photoUrl}
            onChange={setPhotoUrl}
            kind="photo"
            uploading={uploading === 'photo'}
            onUploadStart={() => setUploading('photo')}
            onUploadEnd={() => setUploading('')}
          />
          <ImageUploader
            label="Homepage Hero Image"
            value={heroImageUrl}
            fallback={fallbackHero}
            onChange={setHeroImageUrl}
            kind="hero"
            uploading={uploading === 'hero'}
            onUploadStart={() => setUploading('hero')}
            onUploadEnd={() => setUploading('')}
          />
          <ImageUploader
            label="About Section Image"
            value={aboutImageUrl}
            onChange={setAboutImageUrl}
            kind="about"
            uploading={uploading === 'about'}
            onUploadStart={() => setUploading('about')}
            onUploadEnd={() => setUploading('')}
          />
          <GalleryImagesEditor
            value={galleryImageUrls}
            onChange={setGalleryImageUrls}
            uploading={uploading === 'gallery'}
            onUploadStart={() => setUploading('gallery')}
            onUploadEnd={() => setUploading('')}
          />
        </div>

        {statusMessage && <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{statusMessage}</div>}
        {errorMessage && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
            Close
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSaving || Boolean(uploading)}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            {isSaving ? 'Saving...' : 'Save Images'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AgentsTab({ addAgentRequest = 0 }: { addAgentRequest?: number }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sites, setSites] = useState<AgentWebsite[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch('/api/admin/sites', { cache: 'no-store' })
        const data: SitesResponse = await response.json()
        setSites(data.sites || [])
        setError(data.configured === false ? data.error || 'Database is not configured.' : '')
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load agents.')
      } finally {
        setIsLoading(false)
      }
    }

    load()
  }, [])

  const filteredSites = useMemo(() => {
    const query = searchQuery.toLowerCase()
    return sites.filter((site) => {
      return (
        site.name.toLowerCase().includes(query) ||
        (site.email || '').toLowerCase().includes(query) ||
        (site.brokerage || '').toLowerCase().includes(query)
      )
    })
  }, [searchQuery, sites])

  const handleAgentCreated = (site: AgentWebsite) => {
    setSites((current) => [site, ...current.filter((item) => item.id !== site.id)])
  }

  const handleAgentUpdated = (site: AgentWebsite) => {
    setSites((current) => current.map((item) => (item.id === site.id ? site : item)))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search agents..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="pl-10" />
        </div>
        <AddAgentDialog openRequest={addAgentRequest} onAgentCreated={handleAgentCreated}>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Add Agent
          </Button>
        </AddAgentDialog>
      </div>

      {error && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-start gap-3 p-4 text-amber-900">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <CardTitle className="text-base font-medium">Agents From Created Sites</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/20">
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Agent</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Site</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Brokerage</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Status</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSites.map((site) => (
                    <tr key={site.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          {site.photo_url ? (
                            <img src={site.photo_url} alt={site.name} className="h-10 w-10 rounded-full object-cover" />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-black text-primary-foreground">
                              {initials(site.name)}
                            </div>
                          )}
                          <div>
                            <p className="font-medium">{site.name}</p>
                            <p className="text-sm text-muted-foreground">{site.email || 'No email yet'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-sm text-muted-foreground">{site.custom_domain || `my.rel8tion.me/${site.slug}`}</td>
                      <td className="py-4 px-4 text-sm">{site.brokerage || 'Not set'}</td>
                      <td className="py-4 px-4"><Badge className={statusColor(site.status)}>{statusLabel(site.status)}</Badge></td>
                      <td className="py-4 px-4">
                        <div className="flex justify-end gap-2">
                          <EditImagesDialog site={site} onSiteUpdated={handleAgentUpdated} />
                          <EditTestimonialsDialog site={site} onSiteUpdated={handleAgentUpdated} />
                          <Button variant="outline" size="sm" asChild>
                            <a href={siteUrl(site)} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4 mr-2" />
                              Site
                            </a>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading && filteredSites.length === 0 && (
            <div className="text-center py-12">
              <User className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="font-medium">No agents found</p>
              <p className="text-sm text-muted-foreground">Create an agent site to populate this list.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
