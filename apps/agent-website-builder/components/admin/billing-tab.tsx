'use client'

import { useEffect, useState } from 'react'
import { Check, CreditCard, ExternalLink, Loader2, Receipt, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PRODUCTS, ADDONS } from '@/lib/products'
import { AgentWebsite } from '@/lib/builder'

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

function intervalLabel(interval?: string): string {
  if (interval === 'month') return '/month'
  if (interval === 'year') return '/year'
  return ''
}

export function BillingTab() {
  const [sites, setSites] = useState<AgentWebsite[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [configured, setConfigured] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch('/api/admin/sites', { cache: 'no-store' })
        const data = await response.json()
        setSites(data.sites || [])
        setConfigured(Boolean(data.configured))
      } finally {
        setIsLoading(false)
      }
    }

    load()
  }, [])

  const published = sites.filter((site) => site.status === 'published').length
  const pendingDns = sites.filter((site) => site.status === 'pending_dns').length
  const estimatedBundleMrr = published * 1000
  const stripeConfigured = Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Billing Readiness</CardTitle>
              <CardDescription>Real counts from created agent websites. Stripe invoices are not faked here.</CardDescription>
            </div>
            <Badge className={configured ? 'bg-green-500/10 text-green-700' : 'bg-amber-500/10 text-amber-700'}>
              {configured ? 'Database connected' : 'Needs env'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-3 gap-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Published Sites</p>
                <p className="font-semibold">{published}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Receipt className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Pending DNS</p>
                <p className="font-semibold">{pendingDns}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <CreditCard className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Bundle MRR Estimate</p>
                <p className="font-semibold">{formatPrice(estimatedBundleMrr)}/mo</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        <div className="mb-6">
          <h2 className="text-xl font-semibold">Website Plans</h2>
          <p className="text-muted-foreground text-sm mt-1">Plans used by the public checkout flow.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {PRODUCTS.map((product) => (
            <Card key={product.id} className={product.highlight ? 'border-2 border-primary' : ''}>
              <CardHeader>
                <CardTitle>{product.name}</CardTitle>
                <CardDescription>{product.description}</CardDescription>
                <div className="mt-4 space-y-1">
                  {product.setupPriceInCents && (
                    <div className="text-sm text-muted-foreground">
                      {formatPrice(product.setupPriceInCents)} site creation
                    </div>
                  )}
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold">
                      {formatPrice(product.recurringPriceInCents || product.priceInCents)}
                    </span>
                    <span className="text-muted-foreground">{intervalLabel(product.interval)}</span>
                  </div>
                  {product.savingsText && (
                    <div className="text-sm font-medium text-primary">{product.savingsText}</div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {product.features.slice(0, 8).map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button variant={product.highlight ? 'default' : 'outline'} className="w-full" asChild>
                  <a href="/get-started" target="_blank" rel="noopener noreferrer">
                    Open Checkout Page
                    <ExternalLink className="h-4 w-4 ml-2" />
                  </a>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add-on Services</CardTitle>
          <CardDescription>Visible offer definitions. These are not invoice rows.</CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4">
          {ADDONS.map((addon) => (
            <div key={addon.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{addon.name}</p>
                <Badge variant="secondary">
                  {formatPrice(addon.priceInCents)}
                  {addon.interval === 'month' ? '/mo' : ''}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{addon.description}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stripe Status</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {stripeConfigured
            ? 'Stripe publishable key is present for the browser checkout component.'
            : 'Stripe publishable key is not present in this local environment. Checkout will show the configured-unavailable state.'}
        </CardContent>
      </Card>
    </div>
  )
}
