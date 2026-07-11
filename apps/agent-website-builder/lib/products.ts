export interface Product {
  id: string
  planGroup?: 'rel8tion-bundle' | 'standalone-site'
  name: string
  description: string
  priceInCents: number
  setupPriceInCents?: number
  recurringPriceInCents?: number
  interval?: 'month' | 'year' | 'one-time'
  features: string[]
  badge?: string
  highlight?: boolean
  requiresRel8tion?: boolean
  checkoutSummary?: string
  savingsText?: string
}

const WEBSITE_FEATURES = [
  'Beautiful custom agent website',
  'Unlimited property listings',
  'Custom domain support',
  'Mobile responsive design',
  'Social media integration',
  'Contact form with lead capture',
  'SEO optimization',
  'Analytics dashboard',
]

const BUNDLE_FEATURES = [
  ...WEBSITE_FEATURES,
  'REL8TION membership included',
  'Open House Kit purchase discount',
  'Priority support',
]

const STANDALONE_FEATURES = [
  ...WEBSITE_FEATURES,
  'Professional branding package',
  'Email support',
]

// Pricing plans for real estate agent website service
export const PRODUCTS: Product[] = [
  {
    id: 'rel8tion-bundle-monthly',
    planGroup: 'rel8tion-bundle',
    name: 'REL8TION Bundle Monthly',
    description: 'Open House Kit buyer rate for REL8TION website service.',
    priceInCents: 1000, // $10/month
    recurringPriceInCents: 1000,
    interval: 'month',
    badge: 'Best Value',
    highlight: true,
    requiresRel8tion: true,
    checkoutSummary: 'REL8TION Bundle - $10/month with Open House Kit purchase',
    savingsText: 'Open House Kit purchase unlocks a $200 savings.',
    features: BUNDLE_FEATURES,
  },
  {
    id: 'rel8tion-bundle-yearly',
    planGroup: 'rel8tion-bundle',
    name: 'REL8TION Bundle Yearly',
    description: 'Open House Kit buyer annual rate for REL8TION website service.',
    priceInCents: 10000, // $100/year
    recurringPriceInCents: 10000,
    interval: 'year',
    badge: 'Best Value',
    highlight: true,
    requiresRel8tion: true,
    checkoutSummary: 'REL8TION Bundle - $100/year with Open House Kit purchase',
    savingsText: 'Open House Kit purchase unlocks a $200 savings.',
    features: BUNDLE_FEATURES,
  },
  {
    id: 'standalone-site-monthly',
    planGroup: 'standalone-site',
    name: 'Standalone Website Monthly',
    description: '$199 site creation, then $20/month.',
    priceInCents: 2000, // $20/month
    setupPriceInCents: 19900, // $199 one-time site creation
    recurringPriceInCents: 2000,
    interval: 'month',
    checkoutSummary: 'Standalone Website - $199 site creation + $20/month',
    features: STANDALONE_FEATURES,
  },
  {
    id: 'standalone-site-yearly',
    planGroup: 'standalone-site',
    name: 'Standalone Website Yearly',
    description: '$199 site creation, then $200/year.',
    priceInCents: 20000, // $200/year
    setupPriceInCents: 19900, // $199 one-time site creation
    recurringPriceInCents: 20000,
    interval: 'year',
    checkoutSummary: 'Standalone Website - $199 site creation + $200/year',
    features: STANDALONE_FEATURES,
  },
]

const PRODUCT_ALIASES: Record<string, string> = {
  'rel8tion-bundle': 'rel8tion-bundle-monthly',
  'standalone-site': 'standalone-site-monthly',
}

export function getProductById(productId: string): Product | undefined {
  const resolvedId = PRODUCT_ALIASES[productId] || productId
  return PRODUCTS.find((product) => product.id === resolvedId)
}

export function getProductsByGroup(planGroup: Product['planGroup']): Product[] {
  return PRODUCTS.filter((product) => product.planGroup === planGroup)
}

// Add-on services
export const ADDONS: Product[] = [
  {
    id: 'monthly-maintenance',
    name: 'Monthly Maintenance',
    description: 'Ongoing updates, hosting, and support',
    priceInCents: 2900, // $29/month
    interval: 'month',
    features: [
      'Listing updates',
      'Content changes',
      'Technical support',
      'Hosting included',
      'SSL certificate',
    ],
  },
  {
    id: 'branding-package',
    name: 'Extended Branding',
    description: 'Full brand identity package',
    priceInCents: 9900, // $99 one-time
    interval: 'one-time',
    features: [
      'Logo design',
      'Business cards',
      'Email signature',
      'Social media templates',
      'Brand guidelines',
    ],
  },
]
