import { createClient } from '@/lib/supabase/server'
import { fetchRel8tionBrokerageById } from '@/lib/rel8tion-api'
import { Agent, Testimonial } from '@/lib/types'
import { AgentWebsite } from '@/lib/builder'
import type { CSSProperties } from 'react'
import { readLocalSites } from '@/lib/local-sites-store'

export interface AgentSiteData {
  agent: Agent
  brandStyle: CSSProperties
}

function cssVars(vars: Record<string, string | null | undefined>) {
  return Object.fromEntries(
    Object.entries(vars).filter(([, value]) => Boolean(value))
  ) as CSSProperties
}

async function getBrandForSite(colorScheme?: string | null) {
  if (!colorScheme?.startsWith('rel8tion-')) return null
  const brokerageId = colorScheme.replace(/^rel8tion-/, '')
  return await fetchRel8tionBrokerageById(brokerageId)
}

function normalizeImageList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 8)
}

function normalizeTestimonials(value: unknown): Testimonial[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const source = item as Record<string, unknown>
      const text = String(source.text || '').trim()
      const clientName = String(source.clientName || source.client_name || '').trim()
      if (!text || !clientName) return null

      const rating = Math.max(1, Math.min(5, Number(source.rating || 5)))
      return {
        id: String(source.id || `testimonial-${index + 1}`),
        clientName,
        text,
        rating: Number.isFinite(rating) ? rating : 5,
        date: String(source.date || new Date().toISOString()),
        propertyType: String(source.propertyType || source.property_type || '').trim() || undefined,
      }
    })
    .filter((item): item is Testimonial => Boolean(item))
    .slice(0, 9)
}

function siteToAgent(site: AgentWebsite, brand: Awaited<ReturnType<typeof getBrandForSite>>): AgentSiteData {
  const primaryColor = brand?.primary_color || undefined
  const accentColor = brand?.accent_color || brand?.primary_color || undefined
  const backgroundColor = brand?.bg_color || undefined
  const textColor = brand?.text_color || undefined
  const galleryImages = normalizeImageList(site.gallery_image_urls)
  const testimonials = normalizeTestimonials(site.testimonials_json)

  return {
    agent: {
      id: site.id,
      name: site.name,
      title: site.title || 'Real Estate Agent',
      brokerage: site.brokerage || brand?.name || '',
      email: site.email || '',
      phone: site.phone || '',
      photo: site.photo_url || '',
      heroImage: site.hero_image_url || undefined,
      aboutImage: site.about_image_url || galleryImages[0] || undefined,
      galleryImages,
      bio: site.bio || `${site.name} is ready to help buyers and sellers with a professional, responsive real estate experience.`,
      specializations: ['Residential Real Estate', 'Open Houses', 'Buyer Guidance'],
      yearsExperience: 5,
      licenseNumber: site.license_number || '',
      testimonials,
      stats: {
        totalSales: 0,
        propertiesSold: 0,
        avgDaysOnMarket: 0,
        clientSatisfaction: 100,
      },
      socialLinks: {
        facebook: site.facebook_url || undefined,
        instagram: site.instagram_url || undefined,
        linkedin: site.linkedin_url || undefined,
      },
      colorScheme: site.color_scheme || 'warm-earth',
      fontPairing: site.font_pairing || 'classic-elegant',
      primaryColor,
    },
    brandStyle: cssVars({
      '--primary': primaryColor,
      '--accent': accentColor,
      '--background': backgroundColor,
      '--foreground': textColor,
      '--card-foreground': textColor,
    }),
  }
}

export async function getAgentSiteBySlug(slug: string): Promise<AgentSiteData | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('agent_websites')
    .select('*')
    .eq('slug', slug)
    .in('status', ['published', 'pending_dns'])
    .single()

  if (error || !data) {
    const localSite = (await readLocalSites()).find(
      (site) => site.slug === slug && ['published', 'pending_dns'].includes(site.status)
    )
    if (!localSite) return null
    const localBrand = await getBrandForSite(localSite.color_scheme)
    return siteToAgent(localSite, localBrand)
  }

  const brand = await getBrandForSite(data.color_scheme)
  return siteToAgent(data as AgentWebsite, brand)
}
