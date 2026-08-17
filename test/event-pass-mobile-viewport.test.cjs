const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const signDemo = read('apps/rel8tion-app/sign-demo-activate.html');
const claimHtml = read('apps/rel8tion-app/claim.html');
const claimBootstrap = read('apps/rel8tion-app/src/modules/claimStyled/bootstrap.js');
const claimFlow = read('apps/rel8tion-app/src/modules/claimStyled/flow.js');
const claimRenderer = read('apps/rel8tion-app/src/modules/claimStyled/renderer.js');
const claimStyles = read('apps/rel8tion-app/src/modules/claimStyled/styles.css');
const passHtml = read('apps/rel8tion-app/pass.html');
const rootPassHtml = read('pass.html');
const signHtml = read('apps/rel8tion-app/sign.html');
const signResolver = read('apps/rel8tion-app/src/modules/signResolver/bootstrap.js');
const sponsored = read('apps/rel8tion-app/sponsored-pass-activate.html');

function expectBefore(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notEqual(firstIndex, -1, `${message}: missing ${first}`);
  assert.notEqual(secondIndex, -1, `${message}: missing ${second}`);
  assert.ok(firstIndex < secondIndex, message);
}

test('Event Pass location and claim screens put the primary action before supporting imagery', () => {
  expectBefore(signDemo, 'class="stack locate-action"', 'class="locate-hero"', 'location action must precede the guide image');
  expectBefore(claimRenderer, 'class="claim-primary-action', 'class="claim-guide-image', 'claim action must precede the guide image');
  assert.match(signDemo, /@media \(max-width:720px\) and \(max-height:740px\)/);
  assert.match(claimStyles, /@media \(max-width: 768px\) and \(max-height: 740px\)/);
});

test('required activation controls precede optional profile and listing details', () => {
  expectBefore(claimRenderer, '>Save and Activate</button>', 'class="claim-optional-details', 'profile activation must precede optional profile fields');
  assert.match(signDemo, /<details class="optional-details"><summary>Add listing details \(optional\)<\/summary>/);
  assert.match(sponsored, /<details class="activation-optional-details">[\s\S]*Add email or brokerage \(optional\)/);
  assert.match(sponsored, /<details class="activation-optional-details">[\s\S]*Add date, time, and property details \(optional\)/);
});

test('resolver and success states expose their primary actions before metadata', () => {
  expectBefore(signResolver, '${activationCard(sign)}', 'class="activation-resolver-details', 'inactive resolver action must precede status details');
  const eventPassView = signResolver.slice(signResolver.indexOf('function eventPassInactiveView'), signResolver.indexOf('function sponsoredEventPassReadyView'));
  expectBefore(eventPassView, '>Activate Event Pass</a>', 'Event Pass Status', 'Event Pass activation must precede status details');
  const sponsoredView = signResolver.slice(signResolver.indexOf('function sponsoredEventPassReadyView'), signResolver.indexOf('function activeView'));
  expectBefore(sponsoredView, '>Activate Sponsored Event Pass</a>', 'Prepared From Coverage Setup', 'sponsored activation must precede prepared metadata');
  assert.match(signDemo, /\.success-screen \.success-actions\{order:1\}/);
  assert.match(signDemo, /\.success-screen \.success-meta,\.success-screen \.success-details\{order:2\}/);
});

test('sponsored activation keeps consent and the final action fixed on mobile viewports', () => {
  assert.match(sponsored, /\.activation-action-dock\s*\{[\s\S]*position:\s*fixed;[\s\S]*bottom:\s*max\(7px, env\(safe-area-inset-bottom\)\)/);
  assert.match(sponsored, /class="activation-action-consent"/);
  assert.match(sponsored, /class="activation-primary-action btn btn-primary w-full"/);
  assert.match(sponsored, /\.activation-form\s*\{\s*padding-bottom:\s*calc\(196px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(sponsored, /id="supportingListingAgent"[\s\S]*id="consentCheck"[\s\S]*id="activateBtn"/);
  assert.match(signDemo, /\.confirm-actions\s*\{[\s\S]*position:fixed;[\s\S]*bottom:max\(7px,env\(safe-area-inset-bottom\)\)/);
  assert.match(signDemo, /#app\.card\s*\{\s*animation:none;transform:none;backdrop-filter:none;-webkit-backdrop-filter:none\}/);
  assert.match(sponsored, /\.activation-shell\s*\{[^}]*backdrop-filter:\s*none;/);
});

test('cache-busting reaches every module in the claim and resolver chains', () => {
  const version = '20260816-event-pass-mobile';
  for (const source of [claimHtml, claimBootstrap, claimFlow, passHtml, rootPassHtml, signHtml]) {
    assert.match(source, new RegExp(version));
  }
  assert.match(rootPassHtml, /activation-resolver-shell/);
});

test('edited inline activation pages remain valid JavaScript', () => {
  for (const [name, html] of [['sign demo', signDemo], ['sponsored pass', sponsored]]) {
    for (const match of html.matchAll(/<script(?![^>]*type="module")[^>]*>([\s\S]*?)<\/script>/gi)) {
      if (match[1].trim() && !match[0].includes('src=')) new Function(match[1]);
    }
    assert.ok(html.includes('</html>'), `${name} document must be complete`);
  }

  const sponsoredModule = sponsored.match(/<script type="module">([\s\S]*?)<\/script>/i);
  assert.ok(sponsoredModule, 'sponsored activation module must exist');
  const executableModule = sponsoredModule[1].replace(/^\s*import\s+.*?;\s*$/gm, '');
  new Function(executableModule);
});
