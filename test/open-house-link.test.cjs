const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const openHouseLink = require('../api/open-house-link.js');
const {
  buildPropertyProfile,
  propertyImages,
  propertyProfileIsFresh,
  renderListingPage,
  uniqueExternalUrls
} = openHouseLink.__test;

test('property image collection keeps safe unique images in display order', () => {
  const urls = uniqueExternalUrls([
    'https://images.example/one.webp',
    'javascript:alert(1)',
    'https://images.example/one.webp',
    'https://images.example/two.webp'
  ]);

  assert.deepEqual(urls, [
    'https://images.example/one.webp',
    'https://images.example/two.webp'
  ]);

  assert.deepEqual(propertyImages({
    image: 'https://images.example/hero.webp',
    images: ['https://images.example/stored.webp']
  }, urls), [
    'https://images.example/hero.webp',
    'https://images.example/stored.webp',
    'https://images.example/one.webp',
    'https://images.example/two.webp'
  ]);
});

test('dedicated property page renders gallery, facts, host actions, and check-in return', () => {
  const html = renderListingPage({
    id: 'M00000489-970452',
    house: {
      id: 'M00000489-970452',
      source: 'onekey',
      address: '8571 67th Ave, Rego Park, NY 11374',
      image: 'https://images.example/hero.webp',
      price: 889000,
      beds: 2,
      baths: 1,
      sqft: 1078,
      agent: 'Example Agent',
      agent_phone: '516-555-0101',
      brokerage: 'Example Realty',
      description: 'A complete property description.'
    },
    profile: {
      property_type: 'Single Family Residence',
      listing_status: 'Active',
      year_built: 1952,
      lot_size_sqft: 6000,
      annual_property_taxes: 12850,
      features: ['Garage', 'Finished basement'],
      images: [
        'https://images.example/hero.webp',
        'https://images.example/kitchen.webp',
        'https://images.example/yard.webp'
      ],
      primary_image: 'https://images.example/hero.webp'
    },
    targetUrl: 'https://listing.example/property',
    externalCheck: { available: true },
    images: [
      'https://images.example/hero.webp',
      'https://images.example/kitchen.webp',
      'https://images.example/yard.webp'
    ],
    buyerEventId: 'event-123',
    origin: 'https://app.rel8tion.me'
  });

  assert.match(html, /3 photos · tap to expand/);
  assert.match(html, /data-gallery-index="2"/);
  assert.match(html, /About this property/);
  assert.match(html, /Single Family Residence/);
  assert.match(html, /Year built/);
  assert.match(html, /Property features/);
  assert.match(html, /Finished basement/);
  assert.match(html, /Example Agent/);
  assert.match(html, /Back to check-in/);
  assert.match(html, /event\?event=event-123/);
  assert.match(html, /propertyLightbox/);
});

test('rich property profile merges MLS facts and preserves a durable gallery', () => {
  const now = '2026-08-01T12:00:00.000Z';
  const profile = buildPropertyProfile({
    now,
    house: {
      id: 'M00000489-970452',
      source: 'onekey',
      address: '8571 67th Ave, Rego Park, NY 11374',
      image: 'https://images.example/original.webp',
      agent: 'Local Agent',
      brokerage: 'Local Realty'
    },
    stored: {
      images: ['https://images.example/saved.webp'],
      description: 'Saved description',
      source_checked_at: '2026-07-31T12:00:00.000Z'
    },
    oneKeyImages: [
      'https://images.example/hero.webp',
      'https://images.example/kitchen.webp'
    ],
    oneKeyRecord: {
      UniqueListingId: 'M00000489-970452',
      DisplayName: '85-71 67th Avenue, Rego Park, NY 11374',
      PropertyType: 'Single Family Residence',
      PublicRemarks: 'Enriched public remarks.',
      Computed: {
        BedroomsTotalInteger: 3,
        BathroomsTotalInteger: 2,
        LivingAreaSquareFeet: 1450,
        LotSizeSquareFeet: 4000,
        HoaMonthlyFee: 125,
        PricePerSquareFoot: 613,
        PropertySearchType: ['Detached']
      },
      Structure: { YearBuilt: 1940 },
      StructureDerived: { GarageYN: true, BasementYN: true },
      Listing: {
        Price: { ListPrice: 889000 },
        StandardStatus: 'Active',
        ListAgent: { FullName: 'MLS Agent' },
        ListOffice: { ListOfficeName: 'MLS Realty' }
      }
    }
  });

  assert.equal(profile.open_house_id, 'M00000489-970452');
  assert.equal(profile.price, 889000);
  assert.equal(profile.year_built, 1940);
  assert.equal(profile.description, 'Enriched public remarks.');
  assert.deepEqual(profile.images.slice(0, 3), [
    'https://images.example/hero.webp',
    'https://images.example/kitchen.webp',
    'https://images.example/saved.webp'
  ]);
  assert.ok(profile.features.includes('Garage'));
  assert.ok(profile.features.includes('Basement'));
  assert.ok(propertyProfileIsFresh(profile, new Date('2026-08-01T13:00:00.000Z').getTime()));
});

test('missing numeric property facts stay absent instead of rendering as zero', () => {
  const profile = buildPropertyProfile({
    house: {
      id: 'M00000489-1023777',
      address: '23 3rd Ave, Farmingdale, NY 11735'
    }
  });

  assert.equal(profile.year_built, null);
  assert.equal(profile.lot_size_sqft, null);
  assert.equal(profile.hoa_monthly, null);
});

test('property profile migration keeps storage server-managed', () => {
  const root = path.resolve(__dirname, '..');
  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260801055717_open_house_property_profiles.sql'),
    'utf8'
  );

  assert.match(migration, /create table if not exists public\.open_house_property_profiles/);
  assert.match(migration, /images jsonb not null default '\[\]'::jsonb/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.open_house_property_profiles from anon, authenticated/);
});

test('agent photo enlargement stays in admin while buyer event links property media', () => {
  const root = path.resolve(__dirname, '..');
  const admin = fs.readFileSync(path.join(root, 'apps/rel8tion-app/admin.html'), 'utf8');
  const eventWrapper = fs.readFileSync(path.join(root, 'event.html'), 'utf8');
  const buyerEvent = fs.readFileSync(path.join(root, 'apps/rel8tion-app/src/modules/eventShell/bootstrap.js'), 'utf8');

  assert.match(admin, /data-agent-photo-url/);
  assert.match(admin, /renderAgentPhotoViewer/);
  assert.doesNotMatch(buyerEvent, /data-agent-photo-url/);
  assert.match(eventWrapper, /20260801-property-experience/);
  assert.match(buyerEvent, /Explore This Property/);
  assert.match(buyerEvent, /propertyExperienceUrl/);
});
