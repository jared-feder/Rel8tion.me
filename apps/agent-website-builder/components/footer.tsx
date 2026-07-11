import Link from 'next/link'
import { Instagram, Facebook, Linkedin, Youtube, Twitter } from 'lucide-react'
import { Agent } from '@/lib/types'

interface FooterProps {
  agent: Agent
}

const socialIcons = {
  instagram: Instagram,
  facebook: Facebook,
  linkedin: Linkedin,
  youtube: Youtube,
  twitter: Twitter,
  tiktok: () => (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
    </svg>
  ),
}

export function Footer({ agent }: FooterProps) {
  const socialLinks = Object.entries(agent.socialLinks).filter(
    ([, url]) => url
  ) as [keyof typeof socialIcons, string][]

  return (
    <footer className="bg-primary text-primary-foreground py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="lg:col-span-2">
            <Link href="#top" className="inline-block mb-4">
              <span className="text-2xl font-bold">{agent.name}</span>
            </Link>
            <p className="text-primary-foreground/80 max-w-md leading-relaxed mb-6">
              {agent.title} dedicated to helping clients achieve their real estate
              dreams with expertise, integrity, and personalized service.
            </p>
            {/* Social Links */}
            {socialLinks.length > 0 && (
              <div className="flex gap-3">
                {socialLinks.map(([platform, url]) => {
                  const Icon = socialIcons[platform]
                  return (
                    <a
                      key={platform}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2.5 bg-primary-foreground/10 rounded-lg hover:bg-primary-foreground/20 transition-colors"
                      aria-label={`Follow on ${platform}`}
                    >
                      <Icon />
                    </a>
                  )
                })}
              </div>
            )}
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-semibold mb-4">Quick Links</h3>
            <nav className="flex flex-col gap-3">
              <Link
                href="#about"
                className="text-primary-foreground/80 hover:text-primary-foreground transition-colors"
              >
                About
              </Link>
              <Link
                href="#listings"
                className="text-primary-foreground/80 hover:text-primary-foreground transition-colors"
              >
                Listings
              </Link>
              <Link
                href="#mortgage-calculator"
                className="text-primary-foreground/80 hover:text-primary-foreground transition-colors"
              >
                Calculator
              </Link>
              <Link
                href="#testimonials"
                className="text-primary-foreground/80 hover:text-primary-foreground transition-colors"
              >
                Testimonials
              </Link>
              <Link
                href="#contact"
                className="text-primary-foreground/80 hover:text-primary-foreground transition-colors"
              >
                Contact
              </Link>
            </nav>
          </div>

          {/* Contact Info */}
          <div>
            <h3 className="font-semibold mb-4">Contact</h3>
            <div className="space-y-3 text-primary-foreground/80">
              <p>{agent.phone}</p>
              <p>{agent.email}</p>
              {agent.brokerage && <p>{agent.brokerage}</p>}
              {agent.licenseNumber && <p className="text-sm">License #{agent.licenseNumber}</p>}
            </div>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t border-primary-foreground/20 mt-12 pt-8 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-sm text-primary-foreground/60">
            &copy; {new Date().getFullYear()} {agent.name}. All rights reserved.
          </p>
          <p className="text-sm text-primary-foreground/60">
            Powered by{' '}
            <a href="https://rel8tion.me" className="underline hover:text-primary-foreground">
              REL8TION
            </a>
          </p>
        </div>
      </div>
    </footer>
  )
}
