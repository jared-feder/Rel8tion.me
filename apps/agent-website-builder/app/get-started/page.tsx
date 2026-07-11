'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, ArrowRight, Home, Users, Globe, Palette, Tag, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Checkout from '@/components/checkout'
import { getProductById, getProductsByGroup } from '@/lib/products'

type BillingCadence = 'month' | 'year'

export default function GetStartedPage() {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [bundleBilling, setBundleBilling] = useState<BillingCadence>('month')
  const [standaloneBilling, setStandaloneBilling] = useState<BillingCadence>('month')
  const [promoCode, setPromoCode] = useState('')
  const [promoVerified, setPromoVerified] = useState(false)
  const [promoError, setPromoError] = useState('')
  const [verifyingPromo, setVerifyingPromo] = useState(false)
  
  const bundlePlans = getProductsByGroup('rel8tion-bundle')
  const standalonePlans = getProductsByGroup('standalone-site')
  const bundleProductId = bundleBilling === 'year' ? 'rel8tion-bundle-yearly' : 'rel8tion-bundle-monthly'
  const standaloneProductId = standaloneBilling === 'year' ? 'standalone-site-yearly' : 'standalone-site-monthly'
  const selectedProduct = selectedPlan ? getProductById(selectedPlan) : null
  const bundleFeatures = bundlePlans[0]?.features || []
  const standaloneFeatures = standalonePlans[0]?.features || []

  const verifyPromoCode = async () => {
    if (!promoCode.trim()) {
      setPromoError('Please enter a promo code')
      return
    }
    
    setVerifyingPromo(true)
    setPromoError('')
    
    try {
      const res = await fetch('/api/verify-promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: promoCode.trim().toUpperCase() })
      })
      
      const data = await res.json()
      
      if (data.valid) {
        setPromoVerified(true)
        setPromoError('')
      } else {
        setPromoError(data.message || 'Invalid promo code. Please check your Open House Kit for the correct code.')
      }
    } catch {
      setPromoError('Unable to verify code. Please try again.')
    } finally {
      setVerifyingPromo(false)
    }
  }

  const handleBundleSelect = () => {
    if (!promoVerified) {
      setPromoError('Please verify your promo code first')
      return
    }
    setSelectedPlan(bundleProductId)
  }

  if (selectedPlan) {
    return (
      <div className="rel8tion-builder-surface min-h-screen">
        <header className="rel8tion-builder-header sticky top-0 z-40">
          <div className="mx-auto flex w-screen max-w-screen items-center justify-between gap-3 px-4 py-4 sm:max-w-7xl sm:px-6">
            <Link href="/get-started" className="flex items-center gap-3 font-black text-xl text-foreground">
              <img
                src="https://rel8tion.me/wp-content/uploads/2026/04/logo150x100trans.png"
                alt="Rel8tion"
                className="h-10 w-auto"
              />
              <span>Sites</span>
            </Link>
            <Button variant="ghost" onClick={() => setSelectedPlan(null)}>
              Back to Plans
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-12">
          <div className="mb-8 text-center">
            <h1 className="font-serif text-3xl font-semibold text-foreground">
              Complete Your Purchase
            </h1>
            <p className="mt-2 text-muted-foreground">
              {selectedProduct?.checkoutSummary || 'Website plan checkout'}
            </p>
          </div>
          <Checkout productId={selectedPlan} />
        </main>
      </div>
    )
  }

  return (
    <div className="rel8tion-builder-surface min-h-screen">
      {/* Header */}
      <header className="rel8tion-builder-header sticky top-0 z-40">
        <div className="mx-auto flex w-screen max-w-screen items-center justify-between gap-3 px-4 py-4 sm:max-w-7xl sm:px-6">
          <Link href="/" className="flex items-center gap-3 font-black text-xl text-foreground">
            <img
              src="https://rel8tion.me/wp-content/uploads/2026/04/logo150x100trans.png"
              alt="Rel8tion"
              className="h-10 w-auto"
            />
            <span>Sites</span>
          </Link>
          <Link href="/agent/login" className="hidden sm:block">
            <Button variant="outline" className="px-3 text-sm sm:px-4">
              <span className="hidden sm:inline">Agent Login</span>
              <span className="sm:hidden">Login</span>
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="px-4 py-16 text-center sm:px-6 md:py-20">
        <Badge variant="secondary" className="mb-4 border-white/70 bg-white/60">
          For Real Estate Professionals
        </Badge>
        <h1 className="mx-auto max-w-[18rem] font-serif text-[29px] font-semibold leading-tight text-foreground sm:max-w-4xl sm:text-4xl md:text-5xl lg:text-6xl text-balance">
          Your Professional Website in Minutes
        </h1>
        <p className="mx-auto mt-6 max-w-[18rem] text-base text-muted-foreground text-pretty sm:max-w-2xl sm:text-lg">
          Beautiful, customizable real estate websites that showcase your listings and build your brand. 
          No design skills needed.
        </p>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-7xl px-6 py-10 md:py-14">
        <div className="grid gap-8 md:grid-cols-4">
          {[
            { icon: Home, title: 'Showcase Listings', desc: 'Display your properties beautifully' },
            { icon: Users, title: 'Build Trust', desc: 'Professional presence that converts' },
            { icon: Globe, title: 'Custom Domain', desc: 'YourName.com or any domain you own' },
            { icon: Palette, title: 'Easy Customization', desc: 'Colors, photos, and branding' },
          ].map((feature) => (
            <div key={feature.title} className="rel8tion-glass-panel rounded-2xl p-5 text-center">
              <div className="rel8tion-logo-mark mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl">
                <feature.icon className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-medium text-foreground">{feature.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <h2 className="font-serif text-3xl font-semibold text-foreground">
              Simple, Transparent Pricing
            </h2>
            <p className="mt-3 text-muted-foreground">
              Choose the plan that works best for you
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            {/* REL8TION Bundle */}
            <Card className="relative border-2 border-accent">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="bg-accent text-accent-foreground">Best Value</Badge>
              </div>
              <CardHeader className="text-center">
                <CardTitle className="font-serif text-2xl">REL8TION Bundle</CardTitle>
                <CardDescription>For Open House Kit buyers joining REL8TION</CardDescription>
                <div className="mt-4 inline-flex rounded-full border border-white/70 bg-white/70 p-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={bundleBilling === 'month' ? 'default' : 'ghost'}
                    className="rounded-full px-4"
                    onClick={() => setBundleBilling('month')}
                  >
                    Monthly
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={bundleBilling === 'year' ? 'default' : 'ghost'}
                    className="rounded-full px-4"
                    onClick={() => setBundleBilling('year')}
                  >
                    Yearly
                  </Button>
                </div>
                <div className="mt-4">
                  <span className="font-serif text-5xl font-semibold text-foreground">
                    {bundleBilling === 'year' ? '$100' : '$10'}
                  </span>
                  <span className="text-muted-foreground">
                    {bundleBilling === 'year' ? '/year' : '/month'}
                  </span>
                </div>
                <p className="mt-2 text-sm text-accent">
                  Requires Open House Kit purchase. Includes a $200 savings.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Promo Code Input */}
                <div className="rounded-2xl border border-white/70 bg-white/56 p-4 backdrop-blur">
                  <Label htmlFor="promo" className="flex items-center gap-2 text-sm font-medium">
                    <Tag className="h-4 w-4" />
                    Enter your Open House Kit promo code
                  </Label>
                  <div className="mt-2 flex gap-2">
                    <Input
                      id="promo"
                      placeholder="e.g., OHKIT-XXXX"
                      value={promoCode}
                      onChange={(e) => {
                        setPromoCode(e.target.value.toUpperCase())
                        setPromoError('')
                        setPromoVerified(false)
                      }}
                      disabled={promoVerified}
                      className={promoVerified ? 'border-green-500 bg-green-50' : ''}
                    />
                    <Button 
                      type="button"
                      variant={promoVerified ? 'outline' : 'secondary'}
                      onClick={verifyPromoCode}
                      disabled={verifyingPromo || promoVerified}
                    >
                      {verifyingPromo ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : promoVerified ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        'Verify'
                      )}
                    </Button>
                  </div>
                  {promoError && (
                    <p className="mt-2 flex items-center gap-1 text-sm text-destructive">
                      <AlertCircle className="h-3 w-3" />
                      {promoError}
                    </p>
                  )}
                  {promoVerified && (
                    <p className="mt-2 flex items-center gap-1 text-sm text-green-600">
                      <Check className="h-3 w-3" />
                      Promo code verified! You qualify for the bundle price.
                    </p>
                  )}
                </div>

                <ul className="space-y-3">
                  {bundleFeatures.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent" />
                      <span className="text-sm text-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button 
                  className="w-full" 
                  size="lg"
                  onClick={handleBundleSelect}
                  disabled={!promoVerified}
                >
                  {promoVerified ? 'Get Started' : 'Verify Code to Continue'}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>

            {/* Standalone */}
            <Card>
              <CardHeader className="text-center">
                <CardTitle className="font-serif text-2xl">Standalone Website</CardTitle>
                <CardDescription>Premium site without REL8TION</CardDescription>
                <div className="mt-4 inline-flex rounded-full border border-white/70 bg-white/70 p-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={standaloneBilling === 'month' ? 'default' : 'ghost'}
                    className="rounded-full px-4"
                    onClick={() => setStandaloneBilling('month')}
                  >
                    Monthly
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={standaloneBilling === 'year' ? 'default' : 'ghost'}
                    className="rounded-full px-4"
                    onClick={() => setStandaloneBilling('year')}
                  >
                    Yearly
                  </Button>
                </div>
                <div className="mt-4">
                  <span className="font-serif text-4xl font-semibold text-foreground">$199</span>
                  <span className="text-muted-foreground"> site creation</span>
                </div>
                <div className="mt-1">
                  <span className="text-xl font-semibold text-foreground">
                    + {standaloneBilling === 'year' ? '$200' : '$20'}
                  </span>
                  <span className="text-muted-foreground">
                    {standaloneBilling === 'year' ? '/year' : '/month'}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {standaloneFeatures.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                      <span className="text-sm text-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button 
                  className="w-full" 
                  variant="outline"
                  size="lg"
                  onClick={() => setSelectedPlan(standaloneProductId)}
                >
                  Get Started
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="mb-12 text-center font-serif text-3xl font-semibold text-foreground">
          How It Works
        </h2>
        <div className="grid gap-8 md:grid-cols-3">
          {[
            { step: '1', title: 'Choose Your Plan', desc: 'Select the bundle or standalone option that fits your needs.' },
            { step: '2', title: 'Customize Your Site', desc: 'Pick colors, upload photos, and connect your listings.' },
            { step: '3', title: 'Go Live', desc: 'Connect your domain and start attracting clients.' },
          ].map((item) => (
            <div key={item.step} className="rel8tion-glass-panel rounded-2xl p-6 text-center">
              <div className="rel8tion-logo-mark mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-white font-semibold">
                {item.step}
              </div>
              <h3 className="font-medium text-foreground">{item.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-16 text-center">
        <div className="rel8tion-glass-panel mx-auto max-w-4xl rounded-[28px] px-6 py-12">
        <h2 className="font-serif text-3xl font-semibold text-foreground">
          Ready to Elevate Your Real Estate Brand?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Join hundreds of agents who have transformed their online presence.
        </p>
        <Button 
          size="lg" 
          className="mt-8"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          Get Started Today
        </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="rel8tion-builder-header px-6 py-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Powered by REL8TION
          </p>
          <div className="flex gap-6">
            <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground">
              Terms
            </Link>
            <Link href="/privacy-policy" className="text-sm text-muted-foreground hover:text-foreground">
              Privacy
            </Link>
            <Link href="mailto:support@rel8tion.me" className="text-sm text-muted-foreground hover:text-foreground">
              Contact
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
