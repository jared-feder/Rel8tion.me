// REL8TION Data Types for Real Estate Agent Website Template

export interface Agent {
  id: string
  name: string
  title: string
  email: string
  phone: string
  photo: string
  heroImage?: string
  aboutImage?: string
  galleryImages?: string[]
  bio: string
  specializations: string[]
  yearsExperience: number
  licenseNumber: string
  brokerage: string
  socialLinks: SocialLinks
  testimonials: Testimonial[]
  stats: AgentStats
  colorScheme?: string
  fontPairing?: string
  primaryColor?: string
}

export interface SocialLinks {
  instagram?: string
  facebook?: string
  linkedin?: string
  twitter?: string
  youtube?: string
  tiktok?: string
}

export interface Testimonial {
  id: string
  clientName: string
  clientPhoto?: string
  text: string
  rating: number
  date: string
  propertyType?: string
}

export interface AgentStats {
  totalSales: number
  propertiesSold: number
  avgDaysOnMarket: number
  clientSatisfaction: number
}

export interface Listing {
  id: string
  title: string
  address: string
  city: string
  state: string
  zipCode: string
  price: number
  bedrooms: number
  bathrooms: number
  squareFeet: number
  lotSize?: number
  yearBuilt?: number
  propertyType: 'house' | 'condo' | 'townhouse' | 'land' | 'commercial'
  status: 'active' | 'pending' | 'sold'
  description: string
  features: string[]
  images: string[]
  virtualTourUrl?: string
  mlsNumber?: string
  listedDate: string
  soldDate?: string
  soldPrice?: number
}

export interface ContactFormData {
  name: string
  email: string
  phone: string
  message: string
  preferredContact: 'email' | 'phone'
  listingId?: string
}

export interface SiteConfig {
  agentId: string
  slug: string
  customDomain: string | null
  colorScheme: ColorScheme
  fontPairing: string
  heroImage?: string
  logoUrl?: string
  tagline?: string
  metaTitle?: string
  metaDescription?: string
  isPublished: boolean
  createdAt: string
  updatedAt: string
}

export interface ColorScheme {
  id: string
  name: string
  primary: string
  secondary: string
  accent: string
  text: string
  background: string
  muted: string
}

// API Response Types
export interface Rel8tionResponse<T> {
  success: boolean
  data?: T
  error?: string
}
