const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildPropertyProfile,
  collectDeepImageUrls,
  oneKeyImageIdentifiers,
  renderListingPage
} = require('../api/open-house-link.js').__test;
const { selectPropertyCandidates } = require('../api/cron/enrich-property-profiles.js').__test;

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

test('HomeKey rendering is action-gated, keeps durable contacts, and hides missing socials', () => {
  const html = renderListingPage({
    id: 'house-1',
    house: { id: 'house-1', address: '12 Home Key Lane', image: 'https://images.example/home.webp' },
    profile: { open_house_id: 'house-1', address: '12 Home Key Lane', city: 'Queens', state: 'NY', price: 725000, listing_status: 'Sold' },
    targetUrl: '',
    externalCheck: { available: false },
    keepsake: true,
    homekey: { id: 'homekey-1', public_code: 'HK-test-code' },
    agents: [{ name: 'Listing Agent', title: 'Licensed Real Estate Salesperson', phone: '5165550101', website_url: 'https://agent.example' }],
    loanOfficer: { name: 'Loan Officer', company: 'NMB', phone: '5165550102' }
  });

  assert.match(html, /This home is no longer available, but your HomeKey still works/);
  assert.match(html, /Save This Home/);
  assert.match(html, /I Want This Agent To Help Me/);
  assert.match(html, /DIDN'T LOVE THIS HOUSE\?/);
  assert.match(html, /FINANCING SUPPORT/);
  assert.match(html, /keepsakeInterestForm/);
  assert.match(html, /class="interest-form hidden"/);
  assert.match(html, /HK-test-code/);
  assert.doesNotMatch(html, />Instagram</);
  assert.doesNotMatch(html, />Facebook</);
  assert.doesNotMatch(html, />LinkedIn</);
});

test('property profile migration keeps the raw profile server-managed', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/20260801055717_open_house_property_profiles.sql'),
    'utf8'
  );
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.open_house_property_profiles from anon, authenticated/);
});

test('gallery enrichment tries alternate OneKey identifiers and nested media', () => {
  const record = {
    UniqueListingId: 'M00000489-1023777',
    BUPI: 'BUPI-123',
    Listing: { ListingKey: 'LISTING-KEY-456' },
    Media: [
      { MediaURL: 'https://images.example/front.webp' },
      { MediaURL: 'https://images.example/kitchen.jpg' }
    ]
  };
  const identifiers = oneKeyImageIdentifiers({
    id: 'M00000489-1023777',
    image: 'https://brokerdata-b.b-cdn.net/mlsgrid/onekey/property/M00000489-1023777/photo.webp'
  }, record);

  assert.ok(identifiers.includes('M00000489-1023777'));
  assert.ok(identifiers.includes('BUPI-123'));
  assert.ok(identifiers.includes('LISTING-KEY-456'));
  assert.deepEqual(collectDeepImageUrls(record), [
    'https://images.example/front.webp',
    'https://images.example/kitchen.jpg'
  ]);
});

test('cron prioritizes missing and single-photo profiles before richer recent galleries', () => {
  const houses = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
  const profiles = [
    { open_house_id: 'one', images: ['one.jpg', 'two.jpg'], images_checked_at: '2026-08-01T00:00:00Z' },
    { open_house_id: 'two', images: ['one.jpg'], images_checked_at: '2026-08-01T05:00:00Z' }
  ];
  assert.deepEqual(
    selectPropertyCandidates(houses, profiles, 2).map((candidate) => candidate.house.id),
    ['three', 'two']
  );
});

test('Vercel registers the secured property enrichment cron', () => {
  const root = path.join(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const cron = config.crons.find((entry) => entry.path === '/api/cron/enrich-property-profiles');
  const source = fs.readFileSync(path.join(root, 'api/cron/enrich-property-profiles.js'), 'utf8');
  assert.equal(cron?.schedule, '41 */3 * * *');
  assert.match(source, /process\.env\.CRON_SECRET/);
  assert.match(source, /Bearer \$\{secret\}/);
});
