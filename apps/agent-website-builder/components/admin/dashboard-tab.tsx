'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ExternalLink, Globe, Loader2, Palette, Settings2, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AgentWebsite, formatDate, formatRelative, siteUrl, statusLabel } from '@/lib/builder'

interface SitesResponse {
  configured: boolean
  sites: AgentWebsite[]
  summary: {
    total: number
    published: number
    pendingDns: number
    draft: number
    totalViews: number
  }
  error?: string
}

function statusColor(status: string) {
  if (status === 'published') return 'bg-green-500/10 text-green-700 border-green-200'
  if (status === 'pending_dns') return 'bg-amber-500/10 text-amber-700 border-amber-200'
  return 'bg-muted text-muted-foreground border-border'
}

export function DashboardTab() {
  const [data, setData] = useState<SitesResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch('/api/admin/sites', { cache: 'no-store' })
        if (response.status === 401) {
          localStorage.removeItem('admin_auth')
          throw new Error('Admin session expired. Refresh the page and sign in again.')
        }
        const payload = await response.json()
        setData(payload)
      } catch (error) {
        setData({
          configured: false,
          sites: [],
          summary: { total: 0, published: 0, pendingDns: 0, draft: 0, totalViews: 0 },
          error: error instanceof Error ? error.message : 'Unable to load sites',
        })
      } finally {
        setIsLoading(false)
      }
    }

    load()
  }, [])

  const sites = data?.sites || []
  const needsDns = sites.filter((site) => site.status === 'pending_dns' || site.custom_domain)
  const recent = useMemo(() => sites.slice(0, 6), [sites])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const summary = data?.summary || { total: 0, published: 0, pendingDns: 0, draft: 0, totalViews: 0 }
  const sessionError = data?.error?.toLowerCase().includes('admin session')

  return (
    <div className="space-y-8">
      {!data?.configured && (
        <Card className={sessionError ? 'border-destructive/30 bg-destructive/10' : 'border-amber-200 bg-amber-50'}>
          <CardContent className={`flex items-start gap-3 p-4 ${sessionError ? 'text-destructive' : 'text-amber-900'}`}>
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">
                {sessionError ? 'Admin session expired.' : 'Database is not connected in this environment.'}
              </p>
              <p className={`text-sm ${sessionError ? 'text-destructive' : 'text-amber-800'}`}>
                {sessionError
                  ? 'Refresh the page and sign in again so the server can set the admin cookie.'
                  : 'Add `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to persist sites. The dashboard is ready, but there are no live website rows to show yet.'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Agent Sites</CardTitle>
            <Users className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.total}</div>
            <p className="text-xs text-muted-foreground mt-1">{summary.published} published</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Custom Domains</CardTitle>
            <Globe className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{needsDns.length}</div>
            <p className="text-xs text-muted-foreground mt-1">{summary.pendingDns} pending DNS</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Views</CardTitle>
            <ExternalLink className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalViews.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Tracked from site rows</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Brand Sources</CardTitle>
            <Palette className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Set(sites.map((site) => site.color_scheme || 'warm-earth')).size}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Built-in and REL8TION brokerages</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent Sites</CardTitle>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <div className="py-10 text-center">
                <Globe className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
                <p className="font-medium">No agent websites yet</p>
                <p className="text-sm text-muted-foreground">Create the first site from Agents or Sites.</p>
              </div>
            ) : (
              <div className="divide-y">
                {recent.map((site) => (
                  <div key={site.id} className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0">
                      <p className="font-medium">{site.name}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {site.custom_domain || `my.rel8tion.me/${site.slug}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge className={statusColor(site.status)}>{statusLabel(site.status)}</Badge>
                      <Button variant="outline" size="sm" asChild>
                        <a href={siteUrl(site)} target="_blank" rel="noopener noreferrer">
                          Open
                        </a>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Domain Queue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {needsDns.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No Hostinger domains are waiting on DNS right now.
              </p>
            ) : (
              needsDns.slice(0, 5).map((site) => (
                <div key={site.id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{site.custom_domain || site.slug}</p>
                      <p className="text-xs text-muted-foreground">Created {formatRelative(site.created_at)}</p>
                    </div>
                    <Settings2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Hostinger DNS: A `@` to `76.76.21.21`, CNAME `www` to `cname.vercel-dns.com`.
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Operational Notes</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
          <p>Last site created: {recent[0] ? formatDate(recent[0].created_at) : 'none yet'}.</p>
          <p>Default site URL: `https://my.rel8tion.me/[slug]`.</p>
          <p>Custom domains stay pending until Hostinger DNS and Vercel domain assignment are complete.</p>
        </CardContent>
      </Card>
    </div>
  )
}
