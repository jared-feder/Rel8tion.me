#!/usr/bin/env node

const { readPricingCatalog } = require('../lib/pricing-catalog');

const STRIPE_API_VERSION = '2026-02-25.clover';
const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');

if (apply === dryRun) {
  console.error('Choose exactly one mode: --dry-run or --apply.');
  process.exit(2);
}

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  console.error('STRIPE_SECRET_KEY is required. The key was not printed.');
  process.exit(2);
}

async function stripeRequest(path, { method = 'GET', body = null } = {}) {
  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\/+/, '')}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': STRIPE_API_VERSION
    },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Stripe request failed: ${response.status}`);
  return data;
}

async function listAll(path, query = {}) {
  const rows = [];
  let startingAfter = '';
  do {
    const params = new URLSearchParams({ ...query, limit: '100' });
    if (startingAfter) params.set('starting_after', startingAfter);
    const page = await stripeRequest(`${path}?${params.toString()}`);
    rows.push(...(page.data || []));
    startingAfter = page.has_more && page.data?.length ? page.data.at(-1).id : '';
  } while (startingAfter);
  return rows;
}

function metadataFor(code, product) {
  return {
    plan_code: code,
    role: product.role,
    entitlement_codes: product.entitlement_codes.join(','),
    physical_product: String(Boolean(product.physical_fulfillment_required)),
    renewal_amount_cents: String(product.renewal_cents || 0),
    trial_days: String(product.trial_days || 0)
  };
}

function addMetadata(params, metadata) {
  for (const [key, value] of Object.entries(metadata)) params.set(`metadata[${key}]`, value);
}

function priceMatches(price, product, currency) {
  const interval = product.billing_interval === 'one_time' ? null : product.billing_interval;
  return price?.currency === currency
    && price?.unit_amount === product.amount_cents
    && (price?.recurring?.interval || null) === interval
    && Number(price?.recurring?.interval_count || 1) === Number(product.interval_count || 1);
}

async function findProduct(code, product, products) {
  const existing = products.find((candidate) => candidate.active && candidate.metadata?.plan_code === code);
  if (existing) return { product: existing, created: false };
  if (!apply) return { product: null, created: false };
  const params = new URLSearchParams({
    name: product.display_name,
    description: product.short_description,
    active: 'true'
  });
  addMetadata(params, metadataFor(code, product));
  const created = await stripeRequest('products', { method: 'POST', body: params });
  products.push(created);
  return { product: created, created: true };
}

async function pricesByLookupKey(lookupKey) {
  const params = new URLSearchParams({ limit: '100' });
  params.set('lookup_keys[0]', lookupKey);
  const result = await stripeRequest(`prices?${params.toString()}`);
  return result.data || [];
}

async function createPrice(code, product, stripeProductId, currency, transferLookupKey) {
  const params = new URLSearchParams({
    currency,
    unit_amount: String(product.amount_cents),
    product: stripeProductId,
    lookup_key: product.stripe_lookup_key
  });
  if (transferLookupKey) params.set('transfer_lookup_key', 'true');
  if (product.billing_interval !== 'one_time') {
    params.set('recurring[interval]', product.billing_interval);
    params.set('recurring[interval_count]', String(product.interval_count || 1));
  }
  addMetadata(params, metadataFor(code, product));
  return stripeRequest('prices', { method: 'POST', body: params });
}

async function run() {
  const catalog = readPricingCatalog();
  const products = await listAll('products', { active: 'true' });
  const summary = { reused: [], created_products: [], created_prices: [], assigned_lookup_keys: [], deactivated: [], changes_needed: [] };

  for (const [code, product] of Object.entries(catalog.products).filter(([, value]) => value.active)) {
    const productResult = await findProduct(code, product, products);
    if (productResult.created) summary.created_products.push(productResult.product.id);
    if (!productResult.product) {
      summary.changes_needed.push(`${code}: create Product and Price ${product.amount_cents} ${catalog.currency}/${product.billing_interval}`);
      continue;
    }

    const lookupPrices = await pricesByLookupKey(product.stripe_lookup_key);
    const correctLookupPrice = lookupPrices.find((price) => price.active && priceMatches(price, product, catalog.currency));
    if (correctLookupPrice) {
      summary.reused.push(correctLookupPrice.id);
      continue;
    }

    const productPrices = await listAll('prices', { product: productResult.product.id, active: 'true' });
    const correctUnkeyedPrice = productPrices.find((price) => priceMatches(price, product, catalog.currency) && !price.lookup_key);
    const replaced = lookupPrices.find((price) => price.active) || null;

    if (!apply) {
      summary.changes_needed.push(correctUnkeyedPrice
        ? `${code}: assign lookup key to existing Price ${correctUnkeyedPrice.id}`
        : `${code}: create replacement Price ${product.amount_cents} ${catalog.currency}/${product.billing_interval}${replaced ? ` and deactivate ${replaced.id}` : ''}`);
      continue;
    }

    let correctPrice;
    if (correctUnkeyedPrice && !replaced) {
      const params = new URLSearchParams({ lookup_key: product.stripe_lookup_key });
      correctPrice = await stripeRequest(`prices/${correctUnkeyedPrice.id}`, { method: 'POST', body: params });
      summary.assigned_lookup_keys.push(correctPrice.id);
    } else {
      correctPrice = await createPrice(code, product, productResult.product.id, catalog.currency, Boolean(replaced));
      summary.created_prices.push(correctPrice.id);
    }

    if (!correctPrice.active || correctPrice.lookup_key !== product.stripe_lookup_key || !priceMatches(correctPrice, product, catalog.currency)) {
      throw new Error(`Replacement Price verification failed for ${code}; no prior Price was deactivated.`);
    }
    if (replaced && replaced.id !== correctPrice.id) {
      const params = new URLSearchParams({ active: 'false' });
      const deactivated = await stripeRequest(`prices/${replaced.id}`, { method: 'POST', body: params });
      if (deactivated.active) throw new Error(`Could not deactivate replaced Price ${replaced.id}.`);
      summary.deactivated.push(replaced.id);
    }
  }

  if (apply) {
    for (const [code, product] of Object.entries(catalog.products).filter(([, value]) => value.active)) {
      const lookupPrices = await pricesByLookupKey(product.stripe_lookup_key);
      const exact = lookupPrices.filter((price) => price.active && priceMatches(price, product, catalog.currency));
      if (exact.length !== 1) throw new Error(`Live Stripe verification failed for ${code}.`);
    }
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...summary }, null, 2));
}

run().catch((error) => {
  console.error(`Stripe pricing sync failed: ${error.message}`);
  process.exitCode = 1;
});
