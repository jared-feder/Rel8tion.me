#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildCalendarInvite,
  generateSlots,
  isBookableStart,
  readBookingConfig
} = require('../lib/booking-calendar');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

function invoke(handler, { method = 'GET', headers = {}, query = {}, body = {} } = {}) {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, headers: this.headers, payload }); return this; },
      end() { resolve({ status: this.statusCode, headers: this.headers, payload: null }); }
    };
    Promise.resolve(handler({ method, headers, query, body }, response)).catch(reject);
  });
}

async function run() {
  const config = readBookingConfig();
  assert.equal(config.timezone, 'America/New_York');
  assert.equal(config.duration_minutes, 30);
  assert.equal(config.minimum_notice_hours, 24);
  assert.equal(config.notification_email, 'jared@rel8tion.me');
  assert.deepEqual(config.availability[0].weekdays, [1, 2, 3, 4, 5]);
  assert.equal(config.availability[0].start, '10:00');
  assert.equal(config.availability[0].end, '17:00');

  const fixedNow = new Date('2026-08-03T12:00:00.000Z');
  const slots = generateSlots(fixedNow, config);
  assert.ok(slots.length > 100);
  assert.ok(slots.every((slot) => /(?:AM|PM) EDT|(?:AM|PM) EST/.test(slot.time_label)));
  assert.deepEqual(isBookableStart(slots[0].start, fixedNow, config), slots[0]);
  assert.equal(isBookableStart('2026-08-09T14:00:00.000Z', fixedNow, config), null);

  const page = read('apps/rel8tion-app/book-a-call.html');
  assert.match(page, /Loan Officer Consultation/);
  assert.match(page, /Real Estate Broker &amp; Team/);
  assert.match(page, /jared@rel8tion\.me/);
  assert.match(page, /\/api\/bookings\/availability/);
  assert.match(page, /\/api\/bookings\/create/);

  const routeMap = JSON.parse(read('vercel.json'));
  assert.ok(routeMap.rewrites.some((route) => route.source === '/book-a-call' && route.destination === '/apps/rel8tion-app/book-a-call.html'));

  const migration = read('supabase/migrations/20260802140923_rel8tion_call_bookings.sql');
  assert.match(migration, /unique index[\s\S]*where status = 'confirmed'/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /revoke all on table public\.rel8tion_call_bookings from anon, authenticated/i);

  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalResend = process.env.RESEND_API_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_test_key';
  process.env.RESEND_API_KEY = 'resend_test_key';
  const sentEmails = [];
  const realSlots = generateSlots(new Date(), config);
  assert.ok(realSlots.length > 0);
  global.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/rest/v1/rel8tion_call_bookings')) {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body);
        return { ok: true, status: 201, text: async () => JSON.stringify([{ ...body, id: 1 }]) };
      }
      return { ok: true, status: 200, text: async () => '[]' };
    }
    if (requestUrl === 'https://api.resend.com/emails') {
      sentEmails.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ id: `email_${sentEmails.length}` }) };
    }
    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  try {
    const availability = require('../api/bookings/availability');
    const availableResponse = await invoke(availability, { query: { type: 'loan_officer' }, headers: { origin: 'https://app.rel8tion.me' } });
    assert.equal(availableResponse.status, 200);
    assert.equal(availableResponse.payload.call_type.code, 'loan_officer');
    assert.ok(availableResponse.payload.slots.length > 0);

    const create = require('../api/bookings/create');
    const created = await invoke(create, {
      method: 'POST',
      headers: { origin: 'https://app.rel8tion.me', 'user-agent': 'REL8TION test' },
      body: {
        call_type: 'broker_team',
        starts_at: realSlots[0].start,
        contact_name: 'Test Broker',
        company_name: 'Example Realty',
        email: 'broker@example.com',
        phone: '(516) 555-0100',
        team_size: '8',
        notes: 'Team rollout',
        source: 'verification'
      }
    });
    assert.equal(created.status, 201);
    assert.match(created.payload.booking_code, /^R8CALL-[A-F0-9]{12}$/);
    assert.equal(created.payload.call_type.code, 'broker_team');
    assert.equal(sentEmails.length, 2);
    assert.deepEqual(sentEmails.map((email) => email.to[0]).sort(), ['broker@example.com', 'jared@rel8tion.me']);
    assert.ok(sentEmails.every((email) => email.attachments[0].filename.endsWith('.ics')));

    const invite = buildCalendarInvite({
      booking_code: 'R8CALL-TEST', call_type: 'loan_officer', starts_at: realSlots[0].start,
      ends_at: realSlots[0].end, contact_name: 'Test LO', email: 'lo@example.com', company_name: 'NMB', phone: '+15165550100'
    }, config);
    assert.match(invite, /METHOD:REQUEST/);
    assert.match(invite, /ORGANIZER;CN=REL8TION:mailto:jared@rel8tion\.me/);
    assert.match(invite, /ATTENDEE;CN=Test LO;RSVP=TRUE:mailto:lo@example\.com/);
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    if (originalResend === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = originalResend;
  }

  console.log('REL8TION booking calendar verification passed.');
}

if (require.main === module) run().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { run };
