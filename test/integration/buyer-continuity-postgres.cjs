// Optional local PostgreSQL-engine verification. Uses only synthetic data in a
// temporary directory; never connects to a server or loads application env vars.
// Install @electric-sql/pglite@0.3.14 outside the repo and set PGLITE_MODULE to its
// absolute package directory. This separate test fails (not skips) if missing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
if (!process.env.PGLITE_MODULE || !path.isAbsolute(process.env.PGLITE_MODULE)) {
  throw new Error('Set PGLITE_MODULE to the local @electric-sql/pglite package directory; no database URL is used.');
}
const { PGlite } = require(process.env.PGLITE_MODULE);
const proposal = fs.readFileSync(path.resolve(__dirname, '../../sql/proposals/20261104_buyer_followup_intake.sql'), 'utf8');
const eventId = '00000000-0000-4000-8000-000000000001';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('review-only intake: real local PostgreSQL engine, no external database', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'buyer-continuity-pg-'));
  let db = new PGlite(directory);
  const count = async (table, where = 'true') => Number((await db.query(`select count(*) as n from public.${table} where ${where}`)).rows[0].n);
  const insert = async (n) => db.query('insert into public.event_checkins(id, open_house_event_id) values ($1, $2) on conflict (id) do nothing', [id(n), eventId]);
  const asRole = async (role, operation) => {
    await db.exec(`set role ${role}`);
    try { await operation(); } finally { await db.exec('reset role'); }
  };
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create table public.open_house_events(id uuid primary key);
      create table public.event_checkins(id uuid primary key, open_house_event_id uuid not null references public.open_house_events(id));
      grant insert on public.event_checkins to anon, authenticated, service_role;
      grant select on public.event_checkins to anon, authenticated, service_role;
      insert into public.open_house_events values ('${eventId}');
    `);
    // Existing historical check-ins must not be backfilled by the proposal.
    await insert(10);
    await db.exec(proposal);

    await t.test('capture OFF by default; no historical backfill or browser dependency', async () => {
      await insert(11);
      assert.equal(await count('event_checkins'), 2);
      assert.equal(await count('buyer_followup_intake'), 0);
      assert.equal((await db.query('select capture_enabled from public.buyer_followup_capture_control')).rows[0].capture_enabled, false);
    });

    await t.test('browser roles cannot read or mutate private controls/intake', async () => {
      for (const role of ['anon', 'authenticated']) {
        await asRole(role, async () => {
          for (const table of ['buyer_followup_capture_control', 'buyer_followup_intake']) {
            await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
            await assert.rejects(db.query(`delete from public.${table}`), /permission denied/);
          }
          await assert.rejects(db.query('update public.buyer_followup_capture_control set capture_enabled = true'), /permission denied/);
        });
      }
      const rows = (await db.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('buyer_followup_capture_control', 'buyer_followup_intake')")).rows;
      assert.equal(rows.length, 2);
      assert(rows.every((row) => row.relrowsecurity && row.relforcerowsecurity));
    });

    await t.test('only database owner can enable capture; service cannot fabricate intake', async () => {
      await asRole('service_role', async () => {
        await assert.rejects(db.query('update public.buyer_followup_capture_control set capture_enabled = true'), /permission denied/);
        await assert.rejects(db.query('insert into public.buyer_followup_intake(source_checkin_id, source_event_id) values ($1, $2)', [id(10), eventId]), /permission denied/);
      });
      await db.exec('update public.buyer_followup_capture_control set capture_enabled = true');
    });

    await t.test('source insert captures IDs atomically under protected trigger', async () => {
      await asRole('service_role', async () => { await insert(12); });
      const rows = (await db.query('select * from public.buyer_followup_intake')).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].source_checkin_id, id(12));
      assert.equal(rows[0].source_event_id, eventId);
      assert.equal(rows[0].status, 'pending_review');
      assert.equal(rows[0].outbound_enabled, false);
      assert.deepEqual(Object.keys(rows[0]).sort(), ['source_checkin_id', 'source_event_id', 'captured_at', 'intake_origin', 'status', 'outbound_enabled'].sort());
    });

    await t.test('repeated same source has exactly one receipt', async () => {
      await insert(12); await insert(12);
      assert.equal(await count('buyer_followup_intake'), 1);
    });

    await t.test('RLS still hides receipts after a synthetic accidental SELECT grant', async () => {
      await db.exec('grant select on public.buyer_followup_intake to anon');
      try {
        await asRole('anon', async () => { assert.equal(await count('buyer_followup_intake'), 0); });
      } finally {
        await db.exec('revoke select on public.buyer_followup_intake from anon');
      }
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const rows = (await db.query("select has_function_privilege($1, 'public.capture_buyer_followup_intake()', 'EXECUTE') as capture, has_function_privilege($1, 'public.guard_buyer_followup_intake_status()', 'EXECUTE') as guard", [role])).rows;
        assert.equal(rows[0].capture, false);
        assert.equal(rows[0].guard, false);
      }
    });

    await t.test('transaction rollback cannot leave orphan intake', async () => {
      await db.exec('begin');
      await insert(13);
      assert.equal(await count('buyer_followup_intake', `source_checkin_id = '${id(13)}'`), 1);
      await db.exec('rollback');
      assert.equal(await count('event_checkins', `id = '${id(13)}'`), 0);
      assert.equal(await count('buyer_followup_intake', `source_checkin_id = '${id(13)}'`), 0);
    });

    await t.test('intake failure rolls back check-in, making rollout risk explicit', async () => {
      await db.exec(`alter table public.buyer_followup_intake add constraint synthetic_failure check (source_checkin_id <> '${id(14)}')`);
      await assert.rejects(insert(14), /synthetic_failure/);
      assert.equal(await count('event_checkins', `id = '${id(14)}'`), 0);
      await db.exec('alter table public.buyer_followup_intake drop constraint synthetic_failure');
    });

    await t.test('no role can turn receipt into sending state under these constraints', async () => {
      await assert.rejects(db.query("update public.buyer_followup_intake set status = 'ready_to_send'"), /check constraint/);
      await assert.rejects(db.query('update public.buyer_followup_intake set outbound_enabled = true'), /check constraint/);
      await assert.rejects(db.query("update public.buyer_followup_intake set intake_origin = 'historical_backfill'"), /check constraint/);
      await asRole('service_role', async () => {
        await assert.rejects(db.query('update public.buyer_followup_intake set source_event_id = $1', [eventId]), /permission denied/);
        await assert.rejects(db.query('update public.buyer_followup_intake set outbound_enabled = false'), /permission denied/);
        await assert.rejects(db.query('delete from public.buyer_followup_intake'), /permission denied/);
      });
    });

    await t.test('service can suppress, but neither repeat capture nor update restores it', async () => {
      await asRole('service_role', async () => {
        await db.query("update public.buyer_followup_intake set status = 'suppressed' where source_checkin_id = $1", [id(12)]);
        await assert.rejects(db.query("update public.buyer_followup_intake set status = 'pending_review' where source_checkin_id = $1", [id(12)]), /cannot be reversed/);
      });
      await insert(12);
      assert.equal((await db.query('select status from public.buyer_followup_intake where source_checkin_id = $1', [id(12)])).rows[0].status, 'suppressed');
    });

    await t.test('captured receipt survives local database close/reopen', async () => {
      await db.close();
      db = new PGlite(directory);
      assert.equal(await count('buyer_followup_intake'), 1);
      assert.equal((await db.query('select status from public.buyer_followup_intake')).rows[0].status, 'suppressed');
    });

    await t.test('capture can be turned off without changing prior receipts', async () => {
      await db.exec('update public.buyer_followup_capture_control set capture_enabled = false');
      await insert(15);
      assert.equal(await count('event_checkins', `id = '${id(15)}'`), 1);
      assert.equal(await count('buyer_followup_intake', `source_checkin_id = '${id(15)}'`), 0);
      assert.equal(await count('buyer_followup_intake'), 1);
    });
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
