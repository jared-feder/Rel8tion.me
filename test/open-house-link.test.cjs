const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildPropertyProfile, renderListingPage } = require('../api/open-house-link.js').__test;

test('rich property profile stores source gallery and facts', () => {
  const profile = buildPropertyProfile({
    house: { id: 'M00000489-970452', source: 'onekey', image: 'https://images.example/original.webp' },
    oneKeyImages: ['https://images.example/hero.webp', 'https://images.example/kitchen.webp'],
    oneKeyRecord: {
      UniqueListingId: 'M00000489-970452',
      DisplayName: '85-71 67th Avenue, Rego Park, NY 11374',
      PropertyType: 'Single Family Residence',
      PublicRemarks: 'Enriched public remarks.',
      Computed: { BedroomsTotalInteger: 3, BathroomsTotalInteger: 2, LivingAreaSquareFeet: 1450 },
      Structure: { YearBuilt: 1940 },
      StructureDerived: { GarageYN: true },
      Listing: { Price: { ListPrice: 889000 }, StandardStatus: 'Active' }
    }
  });

  assert.equal(profile.price, 889000);
  assert.equal(profile.year_built, 1940);
  assert.equal(profile.images.length, 3);
  assert.ok(profile.features.includes('Garage'));
});

test('missing numeric facts stay absent and the buyer page keeps event navigation', () => {
  const profile = buildPropertyProfile({
    house: { id: 'M00000489-1023777', address: '23 3rd Ave, Farmingdale, NY 11735' }
  });
  assert.equal(profile.year_built, null);
  assert.equal(profile.hoa_monthly, null);

  const html = renderListingPage({
    id: profile.open_house_id,
    house: { id: profile.open_house_id, address: profile.address, image: 'https://images.example/home.webp' },
    profile,
    targetUrl: '',
    externalCheck: { available: false },
    buyerEventId: 'event-123',
    origin: 'https://app.rel8tion.me'
  });
  assert.match(html, /About this property/);
  assert.match(html, /Back to check-in/);
  assert.doesNotMatch(html, /<span>Year built<\/span><strong><\/strong>/);
});

test('property profile migration keeps the raw profile server-managed', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/20260801055717_open_house_property_profiles.sql'),
    'utf8'
  );
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.open_house_property_profiles from anon, authenticated/);
});
