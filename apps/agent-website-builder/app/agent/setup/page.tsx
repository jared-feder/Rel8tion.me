'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { 
  Check, 
  ChevronRight, 
  Upload, 
  Palette, 
  Image as ImageIcon, 
  Link2, 
  User,
  Building,
  Mail,
  Phone,
  MapPin,
  Instagram,
  Facebook,
  Linkedin,
  X,
  Loader2,
  Sparkles,
  Globe
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FONT_PAIRINGS, COLOR_SCHEMES } from '@/lib/templates'

// Brand type from API
interface Brand {
  id: string
  name: string
  primary_color: string
  secondary_color: string
  accent_color?: string
  logo_url?: string
  font_heading?: string
  font_body?: string
  source: 'built-in' | 'rel8tion'
}

const fetcher = (url: string) => fetch(url).then(res => res.json())

type Step = 'profile' | 'branding' | 'photos' | 'listings' | 'review'

interface AgentProfile {
  name: string
  title: string
  brokerage: string
  email: string
  phone: string
  location: string
  bio: string
  instagram: string
  facebook: string
  linkedin: string
  twitter: string
}

interface SiteConfig {
  colorScheme: string
  fontPairing: string
  heroPhoto: string | null
  profilePhoto: string | null
  galleryPhotos: string[]
  listingsUrl: string
  rel8tionAgentId: string
  customDomain: string
}

const STEPS: { id: Step; label: string; icon: React.ElementType }[] = [
  { id: 'profile', label: 'Your Info', icon: User },
  { id: 'branding', label: 'Branding', icon: Palette },
  { id: 'photos', label: 'Photos', icon: ImageIcon },
  { id: 'listings', label: 'Listings', icon: Link2 },
  { id: 'review', label: 'Review', icon: Check },
]

export default function AgentSetupPage() {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState<Step>('profile')
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // Fetch brands from API (includes built-in + REL8TION brands)
  const { data: brandsData, isLoading: brandsLoading } = useSWR<{ brands: Brand[] }>('/api/brands', fetcher)
  const brands = brandsData?.brands || []
  const builtInBrands = brands.filter(b => b.source === 'built-in')
  const rel8tionBrands = brands.filter(b => b.source === 'rel8tion')
  
  const [profile, setProfile] = useState<AgentProfile>({
    name: '',
    title: 'Real Estate Agent',
    brokerage: '',
    email: '',
    phone: '',
    location: '',
    bio: '',
    instagram: '',
    facebook: '',
    linkedin: '',
    twitter: '',
  })

  const [config, setConfig] = useState<SiteConfig>({
    colorScheme: 'warm-earth',
    fontPairing: 'classic-elegant',
    heroPhoto: null,
    profilePhoto: null,
    galleryPhotos: [],
    listingsUrl: '',
    rel8tionAgentId: '',
    customDomain: '',
  })

  const currentStepIndex = STEPS.findIndex(s => s.id === currentStep)

  const handleNext = () => {
    const nextIndex = currentStepIndex + 1
    if (nextIndex < STEPS.length) {
      setCurrentStep(STEPS[nextIndex].id)
    }
  }

  const handleBack = () => {
    const prevIndex = currentStepIndex - 1
    if (prevIndex >= 0) {
      setCurrentStep(STEPS[prevIndex].id)
    }
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    // Here you would save to your backend/REL8TION
    await new Promise(resolve => setTimeout(resolve, 2000))
    router.push('/agent/setup/success')
  }

  const handleFileUpload = (field: 'heroPhoto' | 'profilePhoto') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const url = URL.createObjectURL(file)
      setConfig(prev => ({ ...prev, [field]: url }))
    }
  }

  const handleGalleryUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files) {
      const urls = Array.from(files).map(f => URL.createObjectURL(f))
      setConfig(prev => ({ 
        ...prev, 
        galleryPhotos: [...prev.galleryPhotos, ...urls].slice(0, 6) 
      }))
    }
  }

  const removeGalleryPhoto = (index: number) => {
    setConfig(prev => ({
      ...prev,
      galleryPhotos: prev.galleryPhotos.filter((_, i) => i !== index)
    }))
  }

  return (
    <div className="rel8tion-builder-surface min-h-screen">
      {/* Header */}
      <header className="rel8tion-builder-header">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="rel8tion-logo-mark w-8 h-8 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-sm">R8</span>
            </div>
            <span className="font-semibold text-foreground">Site Setup</span>
          </div>
          <span className="text-sm text-muted-foreground">
            Step {currentStepIndex + 1} of {STEPS.length}
          </span>
        </div>
      </header>

      {/* Progress Steps */}
      <div className="rel8tion-builder-header">
        <div className="mx-auto max-w-5xl px-6 py-4">
          <div className="flex items-center justify-between">
            {STEPS.map((step, index) => {
              const isActive = step.id === currentStep
              const isCompleted = index < currentStepIndex
              return (
                <button
                  key={step.id}
                  onClick={() => index <= currentStepIndex && setCurrentStep(step.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                    isActive 
                      ? 'bg-primary text-primary-foreground' 
                      : isCompleted 
                        ? 'text-primary cursor-pointer hover:bg-muted' 
                        : 'text-muted-foreground'
                  }`}
                  disabled={index > currentStepIndex}
                >
                  <step.icon className="w-4 h-4" />
                  <span className="hidden sm:inline text-sm font-medium">{step.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="mx-auto max-w-3xl px-6 py-8">
        {/* Profile Step */}
        {currentStep === 'profile' && (
          <Card>
            <CardHeader>
              <CardTitle>Your Information</CardTitle>
              <CardDescription>
                Tell us about yourself so we can personalize your site
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="name"
                      placeholder="Sarah Mitchell"
                      className="pl-10"
                      value={profile.name}
                      onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="title">Professional Title</Label>
                  <Input
                    id="title"
                    placeholder="Luxury Real Estate Specialist"
                    value={profile.title}
                    onChange={e => setProfile(p => ({ ...p, title: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="brokerage">Brokerage</Label>
                <div className="relative">
                  <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="brokerage"
                    placeholder="Luxury Homes International"
                    className="pl-10"
                    value={profile.brokerage}
                    onChange={e => setProfile(p => ({ ...p, brokerage: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="sarah@example.com"
                      className="pl-10"
                      value={profile.email}
                      onChange={e => setProfile(p => ({ ...p, email: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="(555) 123-4567"
                      className="pl-10"
                      value={profile.phone}
                      onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="location">Service Area</Label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="location"
                    placeholder="Los Angeles, CA"
                    className="pl-10"
                    value={profile.location}
                    onChange={e => setProfile(p => ({ ...p, location: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bio">About You</Label>
                <Textarea
                  id="bio"
                  placeholder="Share your experience, specialties, and what makes you unique..."
                  rows={4}
                  value={profile.bio}
                  onChange={e => setProfile(p => ({ ...p, bio: e.target.value }))}
                />
              </div>

              <div className="border-t border-border pt-6">
                <Label className="text-base font-medium mb-4 block">Social Media (Optional)</Label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="relative">
                    <Instagram className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Instagram username"
                      className="pl-10"
                      value={profile.instagram}
                      onChange={e => setProfile(p => ({ ...p, instagram: e.target.value }))}
                    />
                  </div>
                  <div className="relative">
                    <Facebook className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Facebook page URL"
                      className="pl-10"
                      value={profile.facebook}
                      onChange={e => setProfile(p => ({ ...p, facebook: e.target.value }))}
                    />
                  </div>
                  <div className="relative">
                    <Linkedin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="LinkedIn profile URL"
                      className="pl-10"
                      value={profile.linkedin}
                      onChange={e => setProfile(p => ({ ...p, linkedin: e.target.value }))}
                    />
                  </div>
                  <div className="relative">
                    <X className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="X (Twitter) handle"
                      className="pl-10"
                      value={profile.twitter}
                      onChange={e => setProfile(p => ({ ...p, twitter: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Branding Step */}
        {currentStep === 'branding' && (
          <Card>
            <CardHeader>
              <CardTitle>Choose Your Style</CardTitle>
              <CardDescription>
                Select colors and fonts that match your brand
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              {brandsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {/* Built-in Color Schemes */}
                  <div>
                    <Label className="text-base font-medium mb-4 block">Color Schemes</Label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      {builtInBrands.map((brand) => (
                        <button
                          key={brand.id}
                          onClick={() => setConfig(c => ({ ...c, colorScheme: brand.id }))}
                          className={`relative p-4 rounded-xl border-2 transition-all ${
                            config.colorScheme === brand.id
                              ? 'border-primary shadow-md'
                              : 'border-border hover:border-muted-foreground'
                          }`}
                        >
                          <div 
                            className="w-full h-12 rounded-lg mb-3 flex"
                            style={{ backgroundColor: brand.primary_color }}
                          >
                            <div 
                              className="w-1/3 h-full rounded-l-lg" 
                              style={{ backgroundColor: brand.primary_color }} 
                            />
                            <div 
                              className="w-1/3 h-full" 
                              style={{ backgroundColor: brand.secondary_color }} 
                            />
                            <div 
                              className="w-1/3 h-full rounded-r-lg" 
                              style={{ backgroundColor: brand.accent_color || brand.primary_color }} 
                            />
                          </div>
                          <span className="text-sm font-medium text-foreground">{brand.name}</span>
                          {config.colorScheme === brand.id && (
                            <div className="absolute top-2 right-2 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                              <Check className="w-3 h-3 text-primary-foreground" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* REL8TION Brands */}
                  {rel8tionBrands.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <Sparkles className="w-4 h-4 text-accent" />
                        <Label className="text-base font-medium">REL8TION Brands</Label>
                        <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full">
                          From your account
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {rel8tionBrands.map((brand) => (
                          <button
                            key={brand.id}
                            onClick={() => setConfig(c => ({ ...c, colorScheme: brand.id }))}
                            className={`relative p-4 rounded-xl border-2 transition-all ${
                              config.colorScheme === brand.id
                                ? 'border-accent shadow-md'
                                : 'border-border hover:border-muted-foreground'
                            }`}
                          >
                            {brand.logo_url ? (
                              <div className="w-full h-12 rounded-lg mb-3 flex items-center justify-center bg-muted">
                                <Image 
                                  src={brand.logo_url} 
                                  alt={brand.name} 
                                  width={80} 
                                  height={32}
                                  className="object-contain"
                                />
                              </div>
                            ) : (
                              <div 
                                className="w-full h-12 rounded-lg mb-3 flex"
                              >
                                <div 
                                  className="w-1/3 h-full rounded-l-lg" 
                                  style={{ backgroundColor: brand.primary_color }} 
                                />
                                <div 
                                  className="w-1/3 h-full" 
                                  style={{ backgroundColor: brand.secondary_color }} 
                                />
                                <div 
                                  className="w-1/3 h-full rounded-r-lg" 
                                  style={{ backgroundColor: brand.accent_color || brand.primary_color }} 
                                />
                              </div>
                            )}
                            <span className="text-sm font-medium text-foreground">{brand.name}</span>
                            {config.colorScheme === brand.id && (
                              <div className="absolute top-2 right-2 w-5 h-5 bg-accent rounded-full flex items-center justify-center">
                                <Check className="w-3 h-3 text-accent-foreground" />
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <Label className="text-base font-medium mb-4 block">Font Style</Label>
                    <div className="grid gap-4">
                      {FONT_PAIRINGS.map((font) => (
                        <button
                          key={font.id}
                          onClick={() => setConfig(c => ({ ...c, fontPairing: font.id }))}
                          className={`relative p-4 rounded-xl border-2 transition-all text-left ${
                            config.fontPairing === font.id
                              ? 'border-primary shadow-md'
                              : 'border-border hover:border-muted-foreground'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className={`text-lg font-semibold ${font.headingClass}`}>
                                {font.name}
                              </p>
                              <p className={`text-sm text-muted-foreground ${font.bodyClass}`}>
                                {font.headingFont} + {font.bodyFont}
                              </p>
                            </div>
                            {config.fontPairing === font.id && (
                              <div className="w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                                <Check className="w-3 h-3 text-primary-foreground" />
                              </div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Photos Step */}
        {currentStep === 'photos' && (
          <Card>
            <CardHeader>
              <CardTitle>Upload Your Photos</CardTitle>
              <CardDescription>
                Add your professional headshot and property photos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              <div className="grid gap-6 sm:grid-cols-2">
                {/* Profile Photo */}
                <div className="space-y-3">
                  <Label className="text-base font-medium">Profile Photo</Label>
                  <div 
                    className={`relative aspect-square rounded-xl border-2 border-dashed transition-colors ${
                      config.profilePhoto ? 'border-primary' : 'border-border hover:border-muted-foreground'
                    } overflow-hidden`}
                  >
                    {config.profilePhoto ? (
                      <>
                        <Image
                          src={config.profilePhoto}
                          alt="Profile preview"
                          fill
                          className="object-cover"
                        />
                        <button
                          onClick={() => setConfig(c => ({ ...c, profilePhoto: null }))}
                          className="absolute top-2 right-2 w-8 h-8 bg-background/80 rounded-full flex items-center justify-center hover:bg-background"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <label className="flex flex-col items-center justify-center h-full cursor-pointer">
                        <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                        <span className="text-sm text-muted-foreground">Upload headshot</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleFileUpload('profilePhoto')}
                        />
                      </label>
                    )}
                  </div>
                </div>

                {/* Hero Photo */}
                <div className="space-y-3">
                  <Label className="text-base font-medium">Hero Image</Label>
                  <div 
                    className={`relative aspect-square rounded-xl border-2 border-dashed transition-colors ${
                      config.heroPhoto ? 'border-primary' : 'border-border hover:border-muted-foreground'
                    } overflow-hidden`}
                  >
                    {config.heroPhoto ? (
                      <>
                        <Image
                          src={config.heroPhoto}
                          alt="Hero preview"
                          fill
                          className="object-cover"
                        />
                        <button
                          onClick={() => setConfig(c => ({ ...c, heroPhoto: null }))}
                          className="absolute top-2 right-2 w-8 h-8 bg-background/80 rounded-full flex items-center justify-center hover:bg-background"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <label className="flex flex-col items-center justify-center h-full cursor-pointer">
                        <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                        <span className="text-sm text-muted-foreground">Upload hero image</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleFileUpload('heroPhoto')}
                        />
                      </label>
                    )}
                  </div>
                </div>
              </div>

              {/* Gallery Photos */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-medium">Gallery Photos (Optional)</Label>
                  <span className="text-sm text-muted-foreground">
                    {config.galleryPhotos.length}/6 photos
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {config.galleryPhotos.map((photo, index) => (
                    <div key={index} className="relative aspect-square rounded-lg overflow-hidden">
                      <Image src={photo} alt={`Gallery ${index + 1}`} fill className="object-cover" />
                      <button
                        onClick={() => removeGalleryPhoto(index)}
                        className="absolute top-1 right-1 w-6 h-6 bg-background/80 rounded-full flex items-center justify-center hover:bg-background"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {config.galleryPhotos.length < 6 && (
                    <label className="aspect-square rounded-lg border-2 border-dashed border-border hover:border-muted-foreground flex flex-col items-center justify-center cursor-pointer transition-colors">
                      <Upload className="w-5 h-5 text-muted-foreground mb-1" />
                      <span className="text-xs text-muted-foreground">Add</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleGalleryUpload}
                      />
                    </label>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Listings Step */}
        {currentStep === 'listings' && (
          <Card>
            <CardHeader>
              <CardTitle>Connect Your Listings</CardTitle>
              <CardDescription>
                Current active listings can auto-populate once your site is created
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="agentId">REL8TION Agent ID</Label>
                <Input
                  id="agentId"
                  placeholder="Enter your REL8TION agent ID"
                  value={config.rel8tionAgentId}
                  onChange={e => setConfig(c => ({ ...c, rel8tionAgentId: e.target.value }))}
                />
                <p className="text-sm text-muted-foreground">
                  Find this in your REL8TION dashboard under Settings
                </p>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Or</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="listingsUrl">Manual Listings URL</Label>
                <Input
                  id="listingsUrl"
                  placeholder="https://your-mls.com/agent/listings"
                  value={config.listingsUrl}
                  onChange={e => setConfig(c => ({ ...c, listingsUrl: e.target.value }))}
                />
                <p className="text-sm text-muted-foreground">
                  Link to your MLS feed or external listings page
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4">
                <h4 className="font-medium text-foreground mb-2">How listings work</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>If we can match your active listings, they will auto-populate on your site.</li>
                  <li>New active listings are checked on a recurring schedule.</li>
                  <li>You can also enter listings directly if you prefer full manual control.</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Review Step */}
        {currentStep === 'review' && (
          <Card>
            <CardHeader>
              <CardTitle>Review Your Site</CardTitle>
              <CardDescription>
                Make sure everything looks good before we build your site
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Profile Summary */}
              <div className="p-4 bg-muted/50 rounded-lg">
                <h4 className="font-medium text-foreground mb-3">Profile</h4>
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Name</span>
                    <span className="text-foreground">{profile.name || 'Not set'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Title</span>
                    <span className="text-foreground">{profile.title || 'Not set'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Brokerage</span>
                    <span className="text-foreground">{profile.brokerage || 'Not set'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Location</span>
                    <span className="text-foreground">{profile.location || 'Not set'}</span>
                  </div>
                </div>
              </div>

              {/* Branding Summary */}
              <div className="p-4 bg-muted/50 rounded-lg">
                <h4 className="font-medium text-foreground mb-3">Branding</h4>
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Color Scheme</span>
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded ${COLOR_SCHEMES.find(c => c.id === config.colorScheme)?.preview}`} />
                      <span className="text-foreground">
                        {COLOR_SCHEMES.find(c => c.id === config.colorScheme)?.name}
                      </span>
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Font Style</span>
                    <span className="text-foreground">
                      {FONT_PAIRINGS.find(f => f.id === config.fontPairing)?.name}
                    </span>
                  </div>
                </div>
              </div>

              {/* Photos Summary */}
              <div className="p-4 bg-muted/50 rounded-lg">
                <h4 className="font-medium text-foreground mb-3">Photos</h4>
                <div className="flex gap-4">
                  {config.profilePhoto && (
                    <div className="relative w-16 h-16 rounded-lg overflow-hidden">
                      <Image src={config.profilePhoto} alt="Profile" fill className="object-cover" />
                    </div>
                  )}
                  {config.heroPhoto && (
                    <div className="relative w-16 h-16 rounded-lg overflow-hidden">
                      <Image src={config.heroPhoto} alt="Hero" fill className="object-cover" />
                    </div>
                  )}
                  {config.galleryPhotos.slice(0, 3).map((photo, i) => (
                    <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden">
                      <Image src={photo} alt={`Gallery ${i + 1}`} fill className="object-cover" />
                    </div>
                  ))}
                  {!config.profilePhoto && !config.heroPhoto && config.galleryPhotos.length === 0 && (
                    <span className="text-sm text-muted-foreground">No photos uploaded</span>
                  )}
                </div>
              </div>

              {/* Listings Summary */}
              <div className="p-4 bg-muted/50 rounded-lg">
                <h4 className="font-medium text-foreground mb-3">Listings</h4>
                <p className="text-sm text-foreground">
                  {config.rel8tionAgentId 
                    ? `REL8TION ID: ${config.rel8tionAgentId}`
                    : config.listingsUrl 
                      ? `External URL: ${config.listingsUrl}`
                      : 'No listings connected'
                  }
                </p>
              </div>

              {/* Custom Domain Section */}
              <div className="p-4 bg-muted/50 rounded-lg space-y-3">
                <h4 className="font-medium text-foreground">Custom Domain (Optional)</h4>
                <p className="text-sm text-muted-foreground">
                  Already have a domain? Enter it below to connect it to your site.
                </p>
                <Input
                  placeholder="yourdomain.com"
                  value={config.customDomain || ''}
                  onChange={e => setConfig(c => ({ ...c, customDomain: e.target.value }))}
                />
                
                {config.customDomain && (
                  <div className="mt-4 p-4 border rounded-lg bg-blue-50/50">
                    <h5 className="font-medium text-sm mb-2 flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      DNS Setup Required
                    </h5>
                    <p className="text-xs text-muted-foreground mb-3">
                      Add these records in your domain registrar (Hostinger, GoDaddy, Namecheap, etc.):
                    </p>
                    <div className="border rounded overflow-hidden bg-background">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-medium">Type</th>
                            <th className="px-2 py-1.5 text-left font-medium">Name/Host</th>
                            <th className="px-2 py-1.5 text-left font-medium">Value/Points to</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y font-mono">
                          <tr>
                            <td className="px-2 py-1.5">A</td>
                            <td className="px-2 py-1.5">@</td>
                            <td className="px-2 py-1.5">76.76.21.21</td>
                          </tr>
                          <tr>
                            <td className="px-2 py-1.5">CNAME</td>
                            <td className="px-2 py-1.5">www</td>
                            <td className="px-2 py-1.5">cname.vercel-dns.com</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      DNS changes can take 1-48 hours to propagate. Your site will be available at my.rel8tion.me/{profile.name?.toLowerCase().replace(/\s+/g, '-') || 'your-name'} immediately.
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStepIndex === 0}
          >
            Back
          </Button>
          
          {currentStep === 'review' ? (
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? 'Building Your Site...' : 'Launch My Site'}
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button onClick={handleNext}>
              Continue
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>
      </main>
    </div>
  )
}
