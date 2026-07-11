export type SiteStatus = 'published' | 'pending_dns' | 'draft'

export interface AgentWebsiteTestimonial {
  id: string
  clientName: string
  text: string
  rating: number
  date: string
  propertyType?: string
}

export interface AgentWebsite {
  id: string
  name: string
  slug: string
  title: string | null
  brokerage: string | null
  email: string | null
  phone: string | null
  bio: string | null
  photo_url: string | null
  hero_image_url: string | null
  about_image_url?: string | null
  gallery_image_urls?: string[] | null
  testimonials_json?: AgentWebsiteTestimonial[] | null
  license_number?: string | null
  rel8tion_agent_id?: string | null
  color_scheme: string | null
  font_pairing: string | null
  custom_domain: string | null
  status: SiteStatus
  facebook_url: string | null
  instagram_url: string | null
  linkedin_url: string | null
  views: number | null
  created_at: string
  updated_at?: string | null
}

export interface BrandOption {
  id: string
  name: string
  primary_color: string
  secondary_color: string
  accent_color: string
  text_color?: string
  logo_url?: string | null
  font_family?: string | null
  theme?: string | null
  source: 'built-in' | 'rel8tion'
}

export const DEFAULT_DOMAIN = 'my.rel8tion.me'

export function generateSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function normalizeDomain(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
}

export function siteUrl(site: Pick<AgentWebsite, 'slug' | 'custom_domain'>, local = false) {
  if (site.custom_domain) {
    return `https://${site.custom_domain}`
  }

  return local ? `/${site.slug}` : `https://${DEFAULT_DOMAIN}/${site.slug}`
}

export function formatDate(value?: string | null) {
  if (!value) return 'Not recorded'
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatRelative(value?: string | null) {
  if (!value) return 'recently'
  const time = new Date(value).getTime()
  const diffMs = Date.now() - time
  const diffHours = Math.max(1, Math.round(diffMs / 1000 / 60 / 60))
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.round(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  return formatDate(value)
}

export function statusLabel(status?: string | null) {
  switch (status) {
    case 'published':
      return 'Published'
    case 'pending_dns':
      return 'Pending DNS'
    case 'draft':
      return 'Draft'
    default:
      return 'Draft'
  }
}
