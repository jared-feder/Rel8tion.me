'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Loader2, Mail, Phone } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface Lead {
  id: string
  agent_name: string | null
  agent_email: string | null
  name: string
  email: string
  phone: string | null
  message: string
  preferred_contact: string
  status: string
  email_sent: boolean
  email_error: string | null
  source_url: string | null
  created_at: string
}

interface LeadsResponse {
  leads: Lead[]
  error?: string
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function LeadsTab() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadLeads() {
      try {
        const response = await fetch('/api/admin/leads', { cache: 'no-store' })
        const data: LeadsResponse = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to load leads.')
        setLeads(data.leads || [])
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load leads.')
      } finally {
        setIsLoading(false)
      }
    }

    loadLeads()
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <Card className="border-destructive/30 bg-destructive/10">
        <CardContent className="flex items-start gap-3 p-4 text-destructive">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm font-semibold">{error}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Website Leads</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {leads.map((lead) => (
            <div key={lead.id} className="rounded-2xl border border-white/70 bg-white/60 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-black">{lead.name}</h3>
                    <Badge variant="secondary">{lead.preferred_contact}</Badge>
                    <Badge className={lead.email_sent ? 'bg-green-500/10 text-green-700' : 'bg-amber-500/10 text-amber-700'}>
                      {lead.email_sent ? 'Email sent' : 'Saved only'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-muted-foreground">
                    For {lead.agent_name || lead.agent_email || 'Agent site'} · {formatDate(lead.created_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <a href={`mailto:${lead.email}`}>
                      <Mail className="mr-2 h-4 w-4" />
                      Email
                    </a>
                  </Button>
                  {lead.phone && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={`tel:${lead.phone}`}>
                        <Phone className="mr-2 h-4 w-4" />
                        Call
                      </a>
                    </Button>
                  )}
                </div>
              </div>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground">{lead.message}</p>
              {lead.email_error && <p className="mt-3 text-xs font-semibold text-amber-700">{lead.email_error}</p>}
              {lead.source_url && <p className="mt-3 truncate text-xs text-muted-foreground">{lead.source_url}</p>}
            </div>
          ))}
          {!leads.length && (
            <div className="py-12 text-center text-muted-foreground">
              <p className="font-semibold">No website leads yet.</p>
              <p className="text-sm">Contact form submissions will appear here.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
