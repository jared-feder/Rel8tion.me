const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { listingAgentsFromRecord, propertyFromHtml, loadOneKeyListingAgents } = require('../lib/onekey-listing-agents');
const { buildOpenHousePatch } = require('../onekey-freshness-worker.cjs');

const record = {
  UniqueListingId: 'M00000489-1234567', BUPI: 'testBupi', DisplayName: '12 Test St, Babylon, NY 11702',
  Listing: { AgentOffice: {
    ListAgent: { ListAgentFullName: 'Test Primary', ListAgentDirectPhone: '516-555-0101', ListAgentEmail: 'primary@example.com' },
    CoListAgent: { CoListAgentFullName: 'Test Coagent', CoListAgentDirectPhone: '516-555-0102' },
    ListOffice: { ListOfficeName: 'Test Realty', ListOfficePhone: '516-555-0199' }
  } }
};
const house = { id: record.UniqueListingId, lat: 40.7, lng: -73.3, agent: null };
const page = (property) => `<script>self.__next_f.push(${JSON.stringify([1, `7:["$","Component",null,${JSON.stringify({ property })}]\n`])})</script>`;

test('detail parsing recovers primary and coagent; never substitutes the brokerage phone', () => {
  const agents = listingAgentsFromRecord(propertyFromHtml(page(record), house.id));
  assert.deepEqual(agents.map((a) => [a.name, a.phone, a.is_primary]), [
    ['Test Primary', '516-555-0101', true], ['Test Coagent', '516-555-0102', false]
  ]);
  const noPhone = structuredClone(record);
  delete noPhone.Listing.AgentOffice.ListAgent.ListAgentDirectPhone;
  assert.equal(listingAgentsFromRecord(noPhone)[0].phone, '');
});

test('parser requires the exact MLS ID and handles escaped strings and split data chunks', () => {
  const property = { ...record, description: 'A "quote" and a } brace' };
  const text = `7:${JSON.stringify({ property })}\n`;
  const split = text.indexOf('ListAgent');
  const html = [text.slice(0, split), text.slice(split)].map((chunk) => `<script>self.__next_f.push(${JSON.stringify([1, chunk])})</script>`).join('');
  assert.deepEqual(propertyFromHtml(html, house.id), property);
  assert.equal(propertyFromHtml(html, 'M00000489-other'), null);
  assert.equal(propertyFromHtml('<script>throw new Error("do not execute")</script>', house.id), null);
});

test('lookup follows an exact search result to property details, not a nearby property', async (t) => {
  const urls = [];
  const summary = { ...record, Listing: { AgentOffice: { ListOffice: record.Listing.AgentOffice.ListOffice } } };
  t.mock.method(global, 'fetch', async (url, options) => {
    urls.push(String(url));
    assert.equal(options.redirect, 'error');
    if (String(url).includes('/api/search?')) return new Response(JSON.stringify({ Results: [{ ...summary, UniqueListingId: 'M00000489-other' }, summary], Total: 2 }));
    return new Response(page(record));
  });
  assert.equal((await loadOneKeyListingAgents(house)).length, 2);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /uniqueListingId=M00000489-1234567/);
});

test('missing and changed MLS records never borrow a neighbor or relisted identity', async (t) => {
  t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({ Results: [{ ...record, UniqueListingId: 'M00000489-other' }], Total: 1 })));
  assert.deepEqual(await loadOneKeyListingAgents(house), []);
  assert.deepEqual(await loadOneKeyListingAgents({ ...house, id: 'https://attacker.test' }), []);
  t.mock.restoreAll();
  t.mock.method(global, 'fetch', async () => new Response(page({ ...record, UniqueListingId: 'M00000489-other' })));
  await assert.rejects(loadOneKeyListingAgents(house, { record: { ...record, Listing: {} } }), /selected MLS record/);
});

test('background repair preserves saved identity and manual price overrides', () => {
  const remote = { agent: 'Test Primary', agent_phone: '516-555-0101', agent_email: 'primary@example.com', price: 750000 };
  const patch = buildOpenHousePatch({ ...house, price: 800000, manual_price_override: 800000 }, remote, new Date().toISOString());
  assert.equal(patch.agent, 'Test Primary');
  assert.equal(patch.agent_phone, '516-555-0101');
  assert.equal(patch.price, undefined);
  const conflict = buildOpenHousePatch({ ...house, agent: 'Different Person' }, remote, new Date().toISOString());
  assert.equal(conflict.agent, 'Different Person');
  assert.equal(conflict.agent_phone, undefined);
  assert.equal(conflict.agent_email, undefined);
});

test('all ten selections recover independently; a shared phone cannot attach a different profile', async (t) => {
  global.location = { search: '' };
  const { findListingAgentsByOpenHouse } = await import('../apps/rel8tion-app/src/api/agents.js');
  const requested = [];
  t.mock.method(console, 'log', () => {});
  t.mock.method(global, 'fetch', async (value) => {
    const url = new URL(value, 'https://app.rel8tion.me');
    let data = [];
    if (url.pathname.endsWith('/listing_agents')) {
      const id = url.searchParams.get('open_house_id').slice(3);
      if (id === 'house-0') data = [{ name: 'Person Number0', phone: '5165550101' }];
    } else if (url.pathname === '/api/listing-agents') {
      const id = url.searchParams.get('open_house_id');
      requested.push(id);
      data = { agents: [{ name: `Person Number${id.split('-')[1]}`, phone: '5165550101', open_house_id: id }] };
    } else if (url.pathname.endsWith('/agents')) {
      data = [{ name: 'Wrong Person', email: 'wrong@example.com', image_url: 'https://example.com/wrong.jpg' }];
    }
    return new Response(JSON.stringify(data));
  });
  for (let i = 0; i < 10; i += 1) {
    const agents = await findListingAgentsByOpenHouse(`house-${i}`);
    assert.equal(agents[0].name, `Person Number${i}`);
    assert.equal(agents[0].email, '');
    assert.equal(agents[0].image_url, null);
  }
  assert.equal(requested.length, 9);
});

test('changing the selected property clears inferred profile but preserves an explicitly locked host', () => {
  const source = fs.readFileSync(require.resolve('../apps/rel8tion-app/src/modules/claimStyled/flow.js'), 'utf8');
  const selection = source.slice(source.indexOf('export function selectHouse'), source.indexOf('export async function searchListingByQuery')).replace('export ', '');
  for (const locked of [false, true]) {
    const state = { nearbyHouses: [{ id: 'second' }], prefilledAgent: { name: 'First Agent' }, detectedAgentPhoto: 'first.jpg', selectedBrokerage: 'First Realty' };
    const context = { state, hasLockedProfileIdentity: () => locked,
      setPrefilledAgent: (v) => { state.prefilledAgent = v; }, setDetectedAgentPhoto: (v) => { state.detectedAgentPhoto = v; },
      setSelectedBrokerage: (v) => { state.selectedBrokerage = v; }, setDetectedHouse: (v) => { state.detectedHouse = v; },
      showDetectionWithHistory: () => {} };
    vm.runInNewContext(`${selection}; selectHouse('second');`, context);
    assert.equal(state.detectedHouse.id, 'second');
    assert.equal(state.prefilledAgent?.name || null, locked ? 'First Agent' : null);
    assert.equal(state.detectedAgentPhoto, locked ? 'first.jpg' : null);
  }
});

test('public lookup rejects writes and invalid IDs without accessing the database', async () => {
  const handler = require('../api/listing-agents');
  for (const [req, status] of [[{ method: 'POST' }, 405], [{ method: 'GET', query: { open_house_id: 'x&select=*' } }, 400]]) {
    const res = { setHeader() {}, status(value) { this.code = value; return this; }, json(value) { this.body = value; } };
    await handler(req, res);
    assert.equal(res.code, status);
  }
});

test('server host verification accepts the recovered coagent and still rejects an unrelated host', async () => {
  const filename = require.resolve('../lib/event-pass-registration');
  const localRequire = require('node:module').createRequire(filename);
  const module = { exports: {} };
  const context = { module, exports: module.exports, console, process, Buffer, URL,
    require: (name) => name === './admin-auth' ? { supabaseRest: async () => [] }
      : name === './onekey-listing-agents' ? { loadOneKeyListingAgents: async () => listingAgentsFromRecord(record) }
        : name === 'nodemailer' ? {} : localRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context);
  const authorize = module.exports.loadListingAuthorization;
  const result = await authorize({ house, agent: { name: 'Test Coagent', phone: '516-555-0102', brokerage: 'Test Realty' }, identityVerified: true });
  assert.equal(result.basis, 'listing_agent');
  assert.equal(result.listing_agent_name, 'Test Coagent');
  await assert.rejects(authorize({ house, agent: { name: 'Other Person', phone: '516-555-0198', brokerage: 'Other Realty' }, identityVerified: true }));
});
