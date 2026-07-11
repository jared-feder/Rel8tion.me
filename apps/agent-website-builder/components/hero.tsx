import Link from 'next/link'
import { ArrowRight, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Agent } from '@/lib/types'
import { THEME_HERO_IMAGES, getHeroImageForTheme, mapColorToTheme } from '@/lib/theme-images'

interface HeroProps {
  agent: Agent
  heroImage?: string
  colorScheme?: string
  primaryColor?: string
}

export function Hero({ agent, heroImage, colorScheme, primaryColor }: HeroProps) {
  const initials = agent.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'AG'

  // Determine the hero image based on color scheme or primary color
  const getHeroImage = () => {
    // If a custom hero image is provided, use it
    if (heroImage) return heroImage
    
    // If a color scheme is specified, use the matching theme image
    if (colorScheme) {
      return getHeroImageForTheme(colorScheme, primaryColor)
    }
    
    // If a primary color is provided (from brokerage), map it to a theme
    if (primaryColor) {
      const theme = mapColorToTheme(primaryColor)
      return THEME_HERO_IMAGES[theme]
    }
    
    // Default to warm earth theme
    return THEME_HERO_IMAGES['warm-earth']
  }

  return (
    <section className="relative min-h-screen flex items-center overflow-hidden pt-16 lg:pt-20">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <img
          src={getHeroImage()}
          alt="Luxury property"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/70 to-transparent" />
      </div>

      {/* Content */}
      <div className="relative z-10 mx-auto min-w-0 w-full max-w-full px-4 py-20 sm:px-6 lg:max-w-7xl lg:px-8 lg:py-32">
        <div className="grid min-w-0 items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
          <div className="min-w-0 w-full max-w-[calc(100vw-2rem)] sm:max-w-2xl">
            <p className="text-accent font-medium tracking-wide uppercase text-sm mb-4">
              {agent.title}
            </p>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6 text-balance">
              {agent.name}
            </h1>

            <div className="mb-8 flex lg:hidden">
              <div className="flex w-full max-w-sm items-center gap-4 rounded-2xl border border-border/60 bg-card/90 p-3 shadow-xl backdrop-blur-md">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-primary text-primary-foreground">
                  {agent.photo ? (
                    <img src={agent.photo} alt={agent.name} className="h-full w-full object-cover object-center" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xl font-bold">
                      {initials}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{agent.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{agent.brokerage || agent.title}</p>
                </div>
              </div>
            </div>

            <p className="w-full max-w-[calc(100vw-2rem)] break-words text-base leading-relaxed text-muted-foreground mb-8 sm:max-w-xl sm:text-lg">
              {agent.bio || `${agent.title} at ${agent.brokerage}. Local market guidance, listing support, and clear communication from first conversation to closing.`}
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mb-8 lg:mb-12">
              <Button size="lg" asChild>
                <Link href="#listings">
                  View Listings
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="#contact">Schedule Consultation</Link>
              </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-6 sm:gap-8 pt-8 border-t border-border/50">
              <div>
                <p className="text-2xl sm:text-3xl font-bold text-foreground">
                  {agent.stats.totalSales > 0 ? `$${Math.round(agent.stats.totalSales / 1000000)}M+` : 'Local'}
                </p>
                <p className="text-sm text-muted-foreground">Market Focus</p>
              </div>
              <div>
                <p className="text-2xl sm:text-3xl font-bold text-foreground">
                  {agent.stats.propertiesSold > 0 ? `${agent.stats.propertiesSold}+` : 'Ready'}
                </p>
                <p className="text-sm text-muted-foreground">Buyer Support</p>
              </div>
              <div>
                <p className="text-2xl sm:text-3xl font-bold text-foreground">
                  {agent.stats.clientSatisfaction}%
                </p>
                <p className="text-sm text-muted-foreground">Client Satisfaction</p>
              </div>
            </div>
          </div>

          <div className="hidden lg:flex justify-end">
            <div className="relative w-full max-w-[360px]">
              <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] border border-white/70 bg-card/35 shadow-2xl backdrop-blur-sm">
                {agent.photo ? (
                  <img
                    src={agent.photo}
                    alt={agent.name}
                    className="h-full w-full object-cover object-center"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-primary/95 to-accent/80 p-8 text-center text-primary-foreground">
                    <div className="mb-4 flex h-28 w-28 items-center justify-center rounded-full border border-white/30 bg-white/18 text-4xl font-bold shadow-xl">
                      {initials}
                    </div>
                    <p className="text-xl font-semibold">{agent.name}</p>
                    <p className="mt-2 text-sm font-medium opacity-85">{agent.brokerage || agent.title}</p>
                  </div>
                )}
              </div>
              <div className="absolute -bottom-5 right-5 flex max-w-[82%] items-center gap-2 rounded-lg bg-card/95 px-4 py-3 shadow-lg backdrop-blur-sm">
                <MapPin className="h-5 w-5 shrink-0 text-accent" />
                <span className="truncate text-sm font-medium text-foreground">
                  {agent.brokerage || 'Real estate guidance'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
