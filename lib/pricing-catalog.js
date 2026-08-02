const fs = require('node:fs');
const path = require('node:path');

const CATALOG_PATH = path.join(process.cwd(), 'config', 'pricing-catalog.json');

function readPricingCatalog() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  validatePricingCatalog(catalog);
  return catalog;
}

function validatePricingCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object') throw new Error('Pricing catalog is missing.');
  if (!catalog.version || !catalog.updated_at || catalog.currency !== 'usd') {
    throw new Error('Pricing catalog header is invalid.');
  }
  for (const [code, product] of Object.entries(catalog.products || {})) {
    if (!product.active) continue;
    if (!Number.isInteger(product.amount_cents) || product.amount_cents < 0) {
      throw new Error(`Pricing product ${code} has an invalid amount.`);
    }
    if (!['one_time', 'month', 'year'].includes(product.billing_interval)) {
      throw new Error(`Pricing product ${code} has an invalid billing interval.`);
    }
    if (!product.stripe_lookup_key) throw new Error(`Pricing product ${code} is missing a Stripe lookup key.`);
  }
  for (const [code, offer] of Object.entries(catalog.offers || {})) {
    if (!offer.active) continue;
    if (!Array.isArray(offer.line_items) || !offer.line_items.length) {
      throw new Error(`Pricing offer ${code} has no line items.`);
    }
    for (const productCode of offer.line_items) {
      if (!catalog.products?.[productCode]?.active) {
        throw new Error(`Pricing offer ${code} references inactive or missing product ${productCode}.`);
      }
    }
  }
  return catalog;
}

function publicPricingCatalog(catalog = readPricingCatalog()) {
  const publicProducts = Object.fromEntries(
    Object.entries(catalog.products)
      .filter(([, product]) => product.active && product.public)
      .map(([code, product]) => [code, { code, currency: catalog.currency, ...product }])
  );
  const publicOffers = Object.fromEntries(
    Object.entries(catalog.offers)
      .filter(([, offer]) => offer.active && offer.public)
      .map(([code, offer]) => [code, { code, currency: catalog.currency, ...offer }])
  );
  const informationalOffers = Object.fromEntries(
    Object.entries(catalog.informational_offers || {})
      .filter(([, offer]) => offer.active && offer.public)
      .map(([code, offer]) => [code, { code, ...offer }])
  );
  return {
    ok: true,
    version: catalog.version,
    updated_at: catalog.updated_at,
    currency: catalog.currency,
    products: publicProducts,
    offers: publicOffers,
    informational_offers: informationalOffers
  };
}

function getProduct(catalog, code) {
  const product = catalog.products?.[code];
  if (!product?.active) throw new Error(`Unknown or inactive pricing product: ${code}`);
  return { code, ...product };
}

function getOffer(catalog, code) {
  const offer = catalog.offers?.[code];
  if (!offer?.active) throw new Error(`Unknown or inactive pricing offer: ${code}`);
  return { code, ...offer };
}

module.exports = {
  CATALOG_PATH,
  getOffer,
  getProduct,
  publicPricingCatalog,
  readPricingCatalog,
  validatePricingCatalog
};
