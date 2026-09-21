const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../apps/rel8tion-app/admin.html'), 'utf8');
const names = ['readOutreachReleaseDraft', 'rememberOutreachReleaseDraft', 'releaseDraftIso', 'acceptOutreachControlRead', 'saveOutreachReleaseWindow', 'reloadOutreachReleaseDraft'];
function functionSource(name) {
  return html.match(new RegExp('^    (?:async )?function ' + name + '\\([^]*?^    \\}', 'm'))?.[0] || '';
}
const fields = {
  from_open_start: 'releaseWindowFrom',
  through_open_start: 'releaseWindowThrough',
  expires_at: 'releaseWindowExpires',
  reason: 'releaseWindowReason'
};
const oldVersion = '2026-09-01T12:00:00.000Z';
const newVersion = '2026-09-21T16:00:00.000Z';
const oldValues = { enabled: false, from_open_start: '2026-09-23T09:00', through_open_start: '2026-09-23T18:00', expires_at: '2026-09-23T20:00', reason: 'Old reason' };
const newValues = { enabled: true, from_open_start: '2026-09-26T10:00', through_open_start: '2026-09-27T18:00', expires_at: '2026-09-27T20:00', reason: '  New owner-approved dates  ' };
function iso(value) { return value ? new Date(value).toISOString() : null; }
function local(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function stored(values = oldValues, version = oldVersion) {
  return { ok: true, release_window: { updated_at: version, value: { ...values, from_open_start: iso(values.from_open_start), through_open_start: iso(values.through_open_start), expires_at: iso(values.expires_at) } } };
}
function harness() {
  const state = { actionKey: '', outreachControl: stored() };
  const nodes = { releaseWindowEnabled: { checked: false } };
  for (const id of Object.values(fields)) nodes[id] = { value: '' };
  const calls = [], toasts = [];
  let responder = async (_url, options) => {
    const body = JSON.parse(options.body);
    return { ok: true, release_window: { updated_at: newVersion, value: body.release_window } };
  };
  const context = vm.createContext({
    state, console,
    document: { getElementById: id => nodes[id] || null },
    window: { prompt: () => 'REL8TION', confirm: () => true },
    showToast: message => toasts.push(message),
    outreachControlValue: (key, fallback) => key.split('.').reduce((v, part) => v?.[part], state.outreachControl) ?? fallback,
    isoFromLocalInput: id => iso(nodes[id]?.value || ''),
    refreshAreaContent: () => {
      const draft = state.outreachReleaseDraft;
      const values = draft || state.outreachControl.release_window.value;
      nodes.releaseWindowEnabled.checked = values.enabled;
      for (const [key, id] of Object.entries(fields)) {
        nodes[id].value = key === 'reason' || draft ? values[key] || '' : local(values[key]);
      }
    },
    loadAll: async () => { throw new Error('A failed save must not reload and overwrite the draft.'); },
    api: async (url, options = {}) => {
      assert.equal(url, '/api/admin/outreach-control');
      calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
      return responder(url, options);
    }
  });
  vm.runInContext(names.map(functionSource).filter(Boolean).join('\n'), context);
  context.refreshAreaContent();
  return {
    context, state, nodes, calls, toasts,
    respond: fn => { responder = fn; },
    edit: (values = newValues) => {
      nodes.releaseWindowEnabled.checked = values.enabled;
      for (const [key, id] of Object.entries(fields)) nodes[id].value = values[key];
      context.rememberOutreachReleaseDraft?.();
    },
    values: () => ({ enabled: nodes.releaseWindowEnabled.checked, ...Object.fromEntries(Object.entries(fields).map(([key, id]) => [key, nodes[id].value])) })
  };
}

test('submits edited dates and reason rather than the values restored by a loading render', async () => {
  const h = harness(); h.edit();
  await h.context.saveOutreachReleaseWindow();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].body, {
    action: 'update_release_window', expected_updated_at: oldVersion, confirmation: 'REL8TION',
    release_window: { enabled: true, from_open_start: iso(newValues.from_open_start), through_open_start: iso(newValues.through_open_start), expires_at: iso(newValues.expires_at), reason: newValues.reason.trim() }
  });
});

test('snapshot is captured before the confirmation prompt can rerender or change the revision', async () => {
  const h = harness(); h.edit();
  h.context.window.prompt = () => {
    h.nodes.releaseWindowThrough.value = oldValues.through_open_start;
    h.state.outreachControl = stored(oldValues, newVersion);
    return 'REL8TION';
  };
  await h.context.saveOutreachReleaseWindow();
  assert.equal(h.calls[0].body.release_window.through_open_start, iso(newValues.through_open_start));
  assert.equal(h.calls[0].body.expected_updated_at, oldVersion);
});

test('cancelled typed confirmation sends nothing and retains the draft', async () => {
  const h = harness(); h.edit(); h.context.window.prompt = () => 'no';
  await h.context.saveOutreachReleaseWindow();
  h.context.refreshAreaContent();
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.values(), newValues);
});

test('API validation failure retains dates, checkbox, reason and the original revision', async () => {
  const h = harness(); h.edit();
  h.respond(async () => { throw new Error('The release window and its expiration must be in the future.'); });
  await h.context.saveOutreachReleaseWindow();
  assert.deepEqual(h.values(), newValues);
  assert.equal(h.state.outreachReleaseDraft.expected_updated_at, oldVersion);
  assert.match(h.state.outreachReleaseError, /must be in the future/);
  assert.equal(h.state.actionKey, '');
});

test('background refresh preserves edits without silently adopting a newer saved revision', async () => {
  const h = harness(); h.edit();
  h.state.outreachControl = stored(oldValues, newVersion);
  h.context.refreshAreaContent();
  assert.deepEqual(h.values(), newValues);
  h.respond(async () => { throw new Error('This outreach setting changed in another session. Refresh COMMAND before saving.'); });
  await h.context.saveOutreachReleaseWindow();
  assert.equal(h.calls[0].body.expected_updated_at, oldVersion);
  assert.deepEqual(h.values(), newValues);
  assert.match(h.state.outreachReleaseError, /another session/);
});

test('in-flight rerenders retain the draft and duplicate save clicks do not submit twice', async () => {
  const h = harness(); h.edit(); let resolve;
  h.respond(() => new Promise(done => { resolve = done; }));
  const pending = h.context.saveOutreachReleaseWindow();
  h.context.refreshAreaContent();
  assert.deepEqual(h.values(), newValues);
  await h.context.saveOutreachReleaseWindow();
  assert.equal(h.calls.length, 1);
  resolve(stored(newValues, newVersion));
  await pending;
});

test('successful save clears the draft and displays server-returned saved values', async () => {
  const h = harness(); h.edit();
  const returned = { ...newValues, through_open_start: '2026-09-27T17:30', reason: 'Server-returned reason' };
  h.respond(async () => stored(returned, newVersion));
  await h.context.saveOutreachReleaseWindow();
  assert.equal(h.state.outreachReleaseDraft, null);
  assert.deepEqual(h.values(), returned);
  assert.equal(h.state.outreachControl.release_window.updated_at, newVersion);
});

test('invalid date does not submit and retains the edit for correction', async () => {
  const h = harness(); const invalid = { ...newValues, through_open_start: 'not-a-date' }; h.edit(invalid);
  await h.context.saveOutreachReleaseWindow();
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.values(), invalid);
  assert.match(h.state.outreachReleaseError, /valid date/);
});

test('missing form cannot accidentally disable a saved release window', async () => {
  const h = harness(); delete h.nodes.releaseWindowEnabled;
  await h.context.saveOutreachReleaseWindow();
  assert.equal(h.calls.length, 0);
});

test('disabling still requires confirmation and preserves the explicit false value', async () => {
  const h = harness(); h.edit({ ...newValues, enabled: false });
  h.context.window.confirm = () => false;
  await h.context.saveOutreachReleaseWindow(); assert.equal(h.calls.length, 0);
  h.context.window.confirm = () => true;
  await h.context.saveOutreachReleaseWindow();
  assert.equal(h.calls[0].body.release_window.enabled, false);
  assert.equal(h.calls[0].body.confirmation, '');
});

test('a stale background GET cannot undo a newer successful release-window save', () => {
  const h = harness(); h.state.outreachControl = stored(newValues, newVersion);
  const stale = h.context.acceptOutreachControlRead(stored());
  assert.equal(stale.release_window.updated_at, newVersion);
  assert.equal(stale.release_window.value.through_open_start, iso(newValues.through_open_start));
  h.state.actionKey = 'outreach_control:release';
  assert.equal(h.context.acceptOutreachControlRead(stored()), h.state.outreachControl);
});

test('reload saved dates requires confirmation and only discards edits after a successful GET', async () => {
  const h = harness(); h.edit(); h.context.window.confirm = () => false;
  await h.context.reloadOutreachReleaseDraft(); assert.equal(h.calls.length, 0);
  h.context.window.confirm = () => true;
  h.respond(async () => { throw new Error('Connection unavailable'); });
  await h.context.reloadOutreachReleaseDraft();
  assert.deepEqual(h.values(), newValues);
  h.respond(async () => stored(oldValues, newVersion));
  await h.context.reloadOutreachReleaseDraft();
  assert.equal(h.state.outreachReleaseDraft, null);
  assert.deepEqual(h.values(), oldValues);
  assert.equal(h.state.outreachControl.release_window.updated_at, newVersion);
  assert.ok(h.calls.every(call => !call.options.body));
});

test('renderer and input bindings keep raw drafts, errors and refresh protection wired', () => {
  assert.match(html, /const release = state\.outreachReleaseDraft \|\| control\.release_window\?\.value \|\| \{\};/);
  for (const key of ['from_open_start', 'through_open_start', 'expires_at']) {
    assert.ok(html.includes('state.outreachReleaseDraft ? release.' + key + ' : localDateTimeValue(release.' + key + ')'));
  }
  assert.match(html, /addEventListener\('input', rememberOutreachReleaseDraft\)/);
  assert.match(html, /addEventListener\('change', rememberOutreachReleaseDraft\)/);
  assert.match(html, /esc\(state\.outreachReleaseError\)/);
  assert.match(html, /state\.outreachControl = acceptOutreachControlRead\(outreachControl\);/);
  assert.doesNotMatch(functionSource('saveOutreachReleaseWindow'), /loadAll\(/);
});

test('all inline COMMAND scripts remain syntactically valid', () => {
  let count = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(match[1]) || !match[2].trim()) continue;
    new vm.Script(match[2], { filename: 'admin-inline-' + (++count) + '.js' });
  }
  assert.ok(count > 0);
});


function renderControlForRefreshTest(h) {
  Object.assign(h.context, {
    esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    badge: label => String(label),
    fmtDate: value => String(value || ''),
    localDateTimeValue: local,
    renderOutreachModeControls: () => ''
  });
  vm.runInContext(functionSource('renderOutreachControl'), h.context);
  return h.context.renderOutreachControl();
}

test('failed control refresh preserves the whole verified snapshot and draft', () => {
  const h = harness();
  Object.assign(h.state.outreachControl, {
    paused: true,
    sender: { health_blocked: true, provider: 'android_gateway', operator_mode: 'away' },
    guardrails: { value: { max_per_run: 3, max_per_day: 25, max_opt_out_rate: 0.05 } },
    stats: { queue_pending: 123 },
    locked_protections: ['STOP suppression']
  });
  const previous = h.state.outreachControl;
  h.edit();
  const draft = h.state.outreachReleaseDraft;
  h.state.outreachControl = h.context.acceptOutreachControlRead({ ok: false, error: 'Control GET failed' });
  assert.equal(h.state.outreachControl, previous);
  assert.equal(h.state.outreachReleaseDraft, draft);
  assert.equal(h.state.outreachControl.paused, true);
  assert.equal(h.state.outreachControl.stats.queue_pending, 123);
  assert.equal(h.state.outreachControl.guardrails.value.max_per_day, 25);
  assert.equal(h.state.outreachControlReadError, 'Control GET failed');
  h.context.refreshAreaContent();
  assert.deepEqual(h.values(), newValues);
});

test('failed control refresh renders an escaped warning instead of claiming sending is allowed', () => {
  const h = harness();
  h.state.outreachControl.paused = false;
  h.edit();
  h.state.outreachControl = h.context.acceptOutreachControlRead({ ok: false, error: '<offline>' });
  const rendered = renderControlForRefreshTest(h);
  assert.match(rendered, /STATUS UNVERIFIED/);
  assert.match(rendered, /&lt;offline&gt;/);
  assert.match(rendered, /last-known/i);
  assert.doesNotMatch(rendered, /SENDING ALLOWED|Automatic outreach is allowed/);
  assert.match(rendered, /New owner-approved dates/);
});

test('failed control refresh clears only after a successful control read', () => {
  const h = harness(); h.edit();
  h.state.outreachControl = h.context.acceptOutreachControlRead({ ok: false, error: 'Offline' });
  const draft = h.state.outreachReleaseDraft;
  const next = stored(oldValues, newVersion);
  next.paused = true;
  h.state.outreachControl = h.context.acceptOutreachControlRead(next);
  assert.equal(h.state.outreachControl, next);
  assert.equal(h.state.outreachControlReadError, '');
  assert.equal(h.state.outreachReleaseDraft, draft);
  assert.equal(draft.expected_updated_at, oldVersion);
});

test('failed control refresh without a prior good snapshot stays unavailable', () => {
  const h = harness();
  h.state.outreachControl = null;
  h.state.outreachControl = h.context.acceptOutreachControlRead({ ok: false, error: 'Initial load failed' });
  assert.equal(h.state.outreachControl.ok, false);
  assert.match(renderControlForRefreshTest(h), /Outreach Control unavailable/);
  h.edit();
  const rendered = renderControlForRefreshTest(h);
  assert.match(rendered, /STATUS UNVERIFIED/);
  assert.doesNotMatch(rendered, /SENDING ALLOWED|Automatic outreach is allowed/);
});

test('failed control refresh does not replace a missing response with empty controls', () => {
  const h = harness();
  const previous = h.state.outreachControl;
  h.state.outreachControl = h.context.acceptOutreachControlRead(null);
  assert.equal(h.state.outreachControl, previous);
  assert.match(h.state.outreachControlReadError, /refresh/);
});

test('successful release-window save clears a previous refresh warning', async () => {
  const h = harness(); h.edit();
  h.state.outreachControlReadError = 'Offline earlier';
  await h.context.saveOutreachReleaseWindow();
  assert.equal(h.state.outreachControlReadError, '');
  assert.equal(h.state.outreachReleaseDraft, null);
});
