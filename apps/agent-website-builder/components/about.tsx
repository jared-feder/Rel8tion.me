import { Award, Users, Clock, TrendingUp } from 'lucide-react'
import { Agent } from '@/lib/types'

interface AboutProps {
  agent: Agent
}

export function About({ agent }: AboutProps) {
  const aboutImage = agent.aboutImage || agent.galleryImages?.[0] || agent.photo
  const accentImages = (agent.galleryImages || [])
    .filter((image) => image && image !== aboutImage)
    .slice(0, 3)
  const initials = agent.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'AG'

  const highlights = [
    {
      icon: Award,
      title: 'Licensed Professional',
      description: agent.licenseNumber ? `License #${agent.licenseNumber}` : agent.brokerage || 'Professional representation',
    },
    {
      icon: Users,
      title: 'Client-Focused',
      description: `${agent.stats.clientSatisfaction}% satisfaction rate`,
    },
    {
      icon: Clock,
      title: 'Quick Results',
      description: `${agent.stats.avgDaysOnMarket} days avg. on market`,
    },
    {
      icon: TrendingUp,
      title: 'Market Expert',
      description: `${agent.yearsExperience}+ years experience`,
    },
  ]

  return (
    <section id="about" className="py-20 lg:py-32 bg-secondary/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Image */}
          <div className="relative">
            <div className="aspect-[4/5] relative rounded-2xl overflow-hidden shadow-2xl">
              {aboutImage ? (
                <img
                  src={aboutImage}
                  alt={agent.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-primary/95 to-accent/80 p-10 text-center text-primary-foreground">
                  <div className="mb-5 flex h-28 w-28 items-center justify-center rounded-full border border-white/30 bg-white/18 text-4xl font-bold shadow-xl">
                    {initials}
                  </div>
                  <p className="text-xl font-semibold">{agent.name}</p>
                  <p className="mt-2 text-sm font-medium opacity-85">{agent.brokerage || agent.title}</p>
                </div>
              )}
            </div>
            {accentImages.length > 0 && (
              <div className="absolute -bottom-5 left-6 right-6 grid grid-cols-3 gap-2">
                {accentImages.map((image, index) => (
                  <div key={`${image}-${index}`} className="aspect-[4/3] overflow-hidden rounded-xl border-2 border-background bg-card shadow-lg">
                    <img src={image} alt="" className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            )}
            {/* Decorative element */}
            <div className="absolute -bottom-6 -right-6 w-48 h-48 bg-accent/10 rounded-2xl -z-10" />
            <div className="absolute -top-6 -left-6 w-32 h-32 bg-primary/10 rounded-2xl -z-10" />
          </div>

          {/* Content */}
          <div>
            <p className="text-accent font-medium tracking-wide uppercase text-sm mb-4">
              About Me
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-6">
              {agent.name}
            </h2>
            <p className="text-base text-muted-foreground mb-4 leading-relaxed">
              {[agent.title, agent.brokerage].filter(Boolean).join(' at ')}
            </p>

            {/* Bio paragraphs */}
            <div className="space-y-4 mb-8">
              {agent.bio.split('\n\n').map((paragraph, index) => (
                <p key={index} className="text-muted-foreground leading-relaxed">
                  {paragraph}
                </p>
              ))}
            </div>

            {/* Specializations */}
            <div className="mb-8">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-3">
                Specializations
              </h3>
              <div className="flex flex-wrap gap-2">
                {(agent.specializations.length ? agent.specializations : ['Residential Real Estate', 'Open Houses', 'Buyer Guidance']).map((spec) => (
                  <span
                    key={spec}
                    className="px-3 py-1.5 bg-primary/10 text-primary text-sm rounded-full font-medium"
                  >
                    {spec}
                  </span>
                ))}
              </div>
            </div>

            {/* Highlights Grid */}
            <div className="grid grid-cols-2 gap-4">
              {highlights.map((item) => (
                <div
                  key={item.title}
                  className="flex items-start gap-3 p-4 bg-card rounded-xl border border-border"
                >
                  <div className="p-2 bg-accent/10 rounded-lg shrink-0">
                    <item.icon className="h-5 w-5 text-accent" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground text-sm">
                      {item.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
