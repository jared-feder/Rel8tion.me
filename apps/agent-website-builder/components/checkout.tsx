'use client'

import { useCallback } from 'react'
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'

import { startCheckoutSession } from '@/app/actions/stripe'

// Only load Stripe if the key is available
const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null

interface CheckoutProps {
  productId: string
}

export default function Checkout({ productId }: CheckoutProps) {
  const fetchClientSecret = useCallback(
    () => startCheckoutSession(productId),
    [productId]
  )

  // Show message if Stripe is not configured
  if (!stripePromise) {
    return (
      <div className="w-full p-8 text-center border rounded-lg bg-muted/50">
        <p className="text-muted-foreground">
          Payment system is being configured. Please try again shortly.
        </p>
      </div>
    )
  }

  return (
    <div id="checkout" className="w-full">
      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={{ fetchClientSecret }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  )
}
