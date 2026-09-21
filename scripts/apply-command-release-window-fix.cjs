// One-time, exact-source patch runner for an isolated repair branch.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const file = 'apps/rel8tion-app/admin.html';
const bytes = fs.readFileSync(file);
const blob = crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
assert.equal(blob, '77435041504b93bb4c4b25e4393afad5848ce465', 'Refuse to patch an unreviewed admin source revision.');
const eol = bytes.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
let html = bytes.toString('utf8').replace(/\r\n/g, '\n');
function once(text, before, after) {
  assert.equal(text.split(before).length - 1, 1, 'Expected one patch anchor: ' + before.slice(0, 110));
  return text.replace(before, () => after);
}
function getFunction(name) {
  const matches = [...html.matchAll(new RegExp('^    (?:async )?function ' + name + '\\([^]*?^    \\}', 'gm'))];
  assert.equal(matches.length, 1, 'Expected exactly one function: ' + name);
  return matches[0][0];
}
html = once(html, getFunction('saveOutreachReleaseWindow'), fs.readFileSync('scripts/command-release-window-functions.js', 'utf8').trimEnd());
const originalRender = getFunction('renderOutreachControl');
let render = once(originalRender, '      const release = control.release_window?.value || {};', '      const release = state.outreachReleaseDraft || control.release_window?.value || {};');
render = once(render, '      if (control.ok === false) {', '      if (control.ok === false && !state.outreachReleaseDraft) {');
for (const key of ['from_open_start', 'through_open_start', 'expires_at']) {
  render = once(render, 'esc(localDateTimeValue(release.' + key + '))', 'esc(state.outreachReleaseDraft ? release.' + key + ' : localDateTimeValue(release.' + key + '))');
}
const checkboxLine = render.match(/^.*<label.*releaseWindowEnabled.*$/m)?.[0];
assert.ok(checkboxLine, 'Missing release-window checkbox');
render = once(render, checkboxLine,
  '            ${state.outreachReleaseError ? `<div class="error small" role="alert">${esc(state.outreachReleaseError)}</div>` : \'\'}\n'
  + '            ${state.outreachReleaseDraft ? \'<div class="small" role="status">Unsaved release-window edits are kept until you save or reload saved dates.</div>\' : \'\'}\n'
  + checkboxLine);
const saveLine = render.match(/^.*<button.*id="saveOutreachReleaseWindow".*$/m)?.[0];
assert.ok(saveLine, 'Missing release-window save button');
render = once(render, saveLine, saveLine + '\n              <button class="btn soft" id="reloadOutreachReleaseDraft" ${busy ? \'disabled\' : \'\'}>Reload saved dates</button>');
html = once(html, originalRender, render);
const saveBinding = "      document.getElementById('saveOutreachReleaseWindow')?.addEventListener('click', saveOutreachReleaseWindow);";
html = once(html, saveBinding,
  "      for (const id of ['releaseWindowEnabled', 'releaseWindowFrom', 'releaseWindowThrough', 'releaseWindowExpires', 'releaseWindowReason']) {\n"
  + "        const input = document.getElementById(id);\n"
  + "        if (!input) continue;\n"
  + "        input.disabled = Boolean(state.actionKey);\n"
  + "        input.addEventListener('input', rememberOutreachReleaseDraft);\n"
  + "        input.addEventListener('change', rememberOutreachReleaseDraft);\n"
  + "      }\n"
  + saveBinding + '\n'
  + "      document.getElementById('reloadOutreachReleaseDraft')?.addEventListener('click', reloadOutreachReleaseDraft);");
html = once(html, '        state.outreachControl = outreachControl;', '        state.outreachControl = acceptOutreachControlRead(outreachControl);');
html = once(html, '        state.outreachControl = outreachControl || state.outreachControl;', '        state.outreachControl = acceptOutreachControlRead(outreachControl);');
fs.writeFileSync(file, eol === '\r\n' ? html.replace(/\n/g, '\r\n') : html);

function appendDoc(file, text) {
  const current = fs.readFileSync(file, 'utf8');
  assert.ok(!current.includes(text.split('\n')[0]), 'Documentation entry already exists: ' + file);
  fs.writeFileSync(file, current.trimEnd() + '\n\n' + text.trim() + '\n');
}
appendDoc('AGENTS.md', `## COMMAND Release-Window Form State

- [IMPLEMENTED] Capture release-window dates, checkbox, reason, and the saved revision before confirmation prompts, asynchronous work, or any form render. Keep unsaved raw input and its original revision separate from refreshed server state.
- [IMPLEMENTED] Rejected or cancelled saves must retain the draft. Clear it only after a successful save or an explicitly confirmed successful reload. Older background reads must not overwrite a newer saved release-window revision.
- [IMPLEMENTED] Keep the mocked regression suite in test/outreach-release-window-form.test.cjs passing. Testing a date-saving fix must not enable a production override, unpause outreach, alter recipient protections, or send real messages.`);
appendDoc('REL8TION_SYSTEM_OVERVIEW.md', `## COMMAND release-window editing - 2026-09-21

[IMPLEMENTED] The COMMAND release-window editor keeps unsaved date/checkbox/reason values and their original saved revision in in-memory draft state, separate from refreshed control data. Save snapshots the payload before prompts or renders. Failed saves retain the draft and show the returned error; Reload saved dates discards it only after confirmation and a successful read. Stale background reads cannot restore an older saved release-window revision. This is a browser form-state repair, not a change to server authorization, date rules, outreach eligibility, or delivery. Deployment and live-browser behavior remain [NEEDS VERIFICATION].`);
const stateFile = 'CURRENT_STATE.md';
const current = fs.readFileSync(stateFile, 'utf8');
const section = current.indexOf('\n## ');
assert.ok(section >= 0, 'Missing CURRENT_STATE section anchor');
const entry = `
## 2026-09-21: COMMAND release-window date-reversion repair

- [IMPLEMENTED] Fixed saveOutreachReleaseWindow reading date/reason inputs after refreshAreaContent rebuilt them from old settings. The handler now captures every value and expected_updated_at before confirmation or rendering.
- [IMPLEMENTED] Raw in-memory drafts survive background refresh, cancellation, validation errors, and API errors. The editor shows the error, prevents duplicate in-flight saves, and provides an explicit confirmed Reload saved dates action. A stale control GET cannot roll a successfully saved release window back to an older revision.
- [VERIFIED] The new mocked form suite reproduces the original date-reversion failure before the patch and passes after it; the existing outreach-control API suite, route map, and agent-loan-officer assignment checks also pass in the isolated repair runner. These checks do not contact an SMS provider or write runtime settings.
- [NEEDS VERIFICATION] Not merged or deployed by this repair. Live authenticated browser persistence and the production deployment SHA have not been verified. No production pause, release dates, guardrail values, provider settings, or queued messages were changed.
- AGENTS.md disposition: updated with the durable capture-before-render, draft/revision preservation, stale-read protection, and no-live-send test rules.
`;
fs.writeFileSync(stateFile, current.slice(0, section) + entry + current.slice(section));
console.log('Applied exact-source COMMAND date-saving repair; production settings untouched.');
