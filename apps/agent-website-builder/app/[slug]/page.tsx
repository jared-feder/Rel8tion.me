import { notFound } from 'next/navigation'
import { Navbar } from '@/components/navbar'
import { Hero } from '@/components/hero'
import { About } from '@/components/about'
import { PhotoGallery } from '@/components/photo-gallery'
import { AgentListings } from '@/components/agent-listings'
import { MortgageCalculator } from '@/components/mortgage-calculator'
import { Testimonials } from '@/components/testimonials'
import { Contact } from '@/components/contact'
import { Footer } from '@/components/footer'
import { demoAgent, demoTestimonials } from '@/lib/demo-data'
import { getAgentSiteBySlug } from '@/lib/site-agent'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function AgentSitePage({ params }: PageProps) {
  const { slug } = await params
  let site = await getAgentSiteBySlug(slug)

  if (!site && slug === 'sarah-mitchell') {
    site = { agent: demoAgent, brandStyle: {} }
  }

  if (!site) notFound()

  const { agent, brandStyle } = site

  return (
    <main id="top" className="min-h-screen bg-background" style={brandStyle}>
      <Navbar agent={agent} />
      <Hero
        agent={agent}
        colorScheme={agent.colorScheme}
        heroImage={agent.heroImage}
        primaryColor={agent.primaryColor}
      />
      <About agent={agent} />
      <PhotoGallery agent={agent} />
      <AgentListings siteId={agent.id} agentName={agent.name} brokerage={agent.brokerage} />
      <AgentListings siteId={agent.id} agentName={agent.name} brokerage={agent.brokerage} collection="past-sales" hideWhenEmpty />
      <MortgageCalculator />
      <Testimonials testimonials={agent.id === demoAgent.id ? demoTestimonials : agent.testimonials} />
      <Contact agent={agent} />
      <Footer agent={agent} />
    </main>
  )
}

export async function generateStaticParams() {
  return [{ slug: 'sarah-mitchell' }]
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params
  const site = await getAgentSiteBySlug(slug)
  const agent = site?.agent || (slug === 'sarah-mitchell' ? demoAgent : null)

  if (!agent) return { title: 'Agent Not Found' }

  return {
    title: `${agent.name} | ${agent.title}`,
    description: agent.bio || `Contact ${agent.name} for real estate guidance.`,
    openGraph: {
      title: `${agent.name} | ${agent.title}`,
      description: agent.bio || `Contact ${agent.name} for real estate guidance.`,
      images: [agent.heroImage, agent.aboutImage, agent.photo].filter((image): image is string => Boolean(image)),
    },
  }
}
