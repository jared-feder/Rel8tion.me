'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BarChart3, ExternalLink, Globe, Image as ImageIcon, Loader2, LogOut, Sparkles, Users } from 'lucide-react'
import { AiStudioTab } from '@/components/admin/ai-studio-tab'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { AgentWebsite } from '@/lib/builder'
import { siteUrl, statusLabel } from '@/lib/builder'
import { createClient } from '@/lib/supabase/client'

interface AgentMeResponse {
  site?: AgentWebsite
  summary?: {
    leads: number
    listings: number
    aiMedia: number
  }
  error?: string
}

export default function AgentDashboardPage() {
  const router = useRouter()
  const [site, setSite] = useState<AgentWebsite | null>(null)
  const [summary, setSummary] = useState({ leads: 0, listings: 0, aiMedia: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadDashboard() {
      try {
        const response = await fetch('/api/agent/me', { cache: 'no-store' })
        const data: AgentMeResponse = await response.json().catch(() => ({}))
        if (!response.ok || !data.site) throw new Error(data.error || 'Unable to load your agent dashboard.')
        setSite(data.site)
        setSummary(data.summary || { leads: 0, listings: 0, aiMedia: 0 })
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load your agent dashboard.')
      } finally {
        setIsLoading(false)
      }
    }

    loadDashboard()
  }, [])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/agent/login')
  }

  if (isLoading) {
    return (
      <div className="rel8tion-builder-surface flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !site) {
    return (
      <div className="rel8tion-builder-surface flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-lg text-center">
          <CardHeader>
            <CardTitle>Agent Site Not Connected</CardTitle>
            <CardDescription>{error || 'No website is connected to this login yet.'}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center gap-2">
            <Button asChild>
              <Link href="/agent/login">Try Another Email</Link>
            </Button>
            <Button variant="outline" onClick={handleLogout}>Sign Out</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const publicUrl = siteUrl(site)

  return (
    <div className="rel8tion-builder-surface min-h-screen">
      <header className="rel8tion-builder-header">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rel8tion-logo-mark flex h-9 w-9 items-center justify-center rounded-xl">
              <span className="text-sm font-bold text-white">R8</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-muted-foreground">Agent Portal</p>
              <h1 className="font-semibold text-foreground">{site.name}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                View Site
              </a>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="rel8tion-glass-panel mb-6 flex flex-col gap-4 rounded-2xl p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="rel8tion-logo-mark flex h-12 w-12 items-center justify-center rounded-2xl">
              <Globe className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-foreground">{site.custom_domain || site.slug}</h2>
                <Badge>{statusLabel(site.status)}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{site.brokerage || site.title || 'Real estate website'}</p>
            </div>
          </div>
          <Button asChild>
            <a href={publicUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              Open Site
            </a>
          </Button>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Website Leads</CardDescription>
              <CardTitle className="flex items-center gap-2 text-3xl">
                <Users className="h-6 w-6 text-primary" />
                {summary.leads}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Active Listings</CardDescription>
              <CardTitle className="flex items-center gap-2 text-3xl">
                <BarChart3 className="h-6 w-6 text-primary" />
                {summary.listings}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>AI Media</CardDescription>
              <CardTitle className="flex items-center gap-2 text-3xl">
                <ImageIcon className="h-6 w-6 text-primary" />
                {summary.aiMedia}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">AI Tools</h2>
        </div>

        <AiStudioTab
          fixedSite={site}
          mediaEndpoint="/api/agent/ai-media"
          statusEndpoint="/api/agent/ai-media/status"
          showSiteSelector={false}
          title="Agent AI Studio"
        />
      </main>
    </div>
  )
}
