'use server'

import { stripe } from '@/lib/stripe'
import { getProductById } from '@/lib/products'

export async function startCheckoutSession(productId: string) {
  const product = getProductById(productId)
  if (!product) {
    throw new Error(`Product with id "${productId}" not found`)
  }

  const lineItems: Array<{
    price_data: {
      currency: string
      product_data: { name: string; description: string }
      unit_amount: number
      recurring?: { interval: 'month' | 'year' }
    }
    quantity: number
  }> = []
  const baseName = product.planGroup === 'standalone-site'
    ? 'Standalone Website'
    : product.planGroup === 'rel8tion-bundle'
      ? 'REL8TION Bundle Website Service'
      : product.name

  if (product.setupPriceInCents) {
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: {
          name: `${baseName} Site Creation`,
          description: 'One-time custom website creation and setup.',
        },
        unit_amount: product.setupPriceInCents,
      },
      quantity: 1,
    })
  }

  if (product.recurringPriceInCents && (product.interval === 'month' || product.interval === 'year')) {
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: {
          name: `${baseName} ${product.interval === 'year' ? 'Yearly' : 'Monthly'}`,
          description: product.description,
        },
        unit_amount: product.recurringPriceInCents,
        recurring: {
          interval: product.interval,
        },
      },
      quantity: 1,
    })
  }

  if (lineItems.length === 0) {
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: {
          name: product.name,
          description: product.description,
        },
        unit_amount: product.priceInCents,
      },
      quantity: 1,
    })
  }

  const isSubscription = lineItems.some((item) => Boolean(item.price_data.recurring))

  const session = await stripe.checkout.sessions.create({
    ui_mode: 'embedded_page',
    redirect_on_completion: 'never',
    line_items: lineItems,
    mode: isSubscription ? 'subscription' : 'payment',
    metadata: {
      product_id: product.id,
      plan_group: product.planGroup || '',
      interval: product.interval || '',
    },
  })

  return session.client_secret
}

export async function getCustomerSubscriptions(customerId: string) {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'active',
  })

  return subscriptions.data
}
