const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'apps', 'rel8tion-app', 'admin.html'), 'utf8');

function functionSource(name) {
  const syncStart = source.indexOf(`    function ${name}(`);
  const asyncStart = source.indexOf(`    async function ${name}(`);
  const start = syncStart === -1 ? asyncStart : syncStart;
  assert.notEqual(start, -1, `${name} should exist`);
  const nextSync = source.indexOf('\n    function ', start + 10);
  const nextAsync = source.indexOf('\n    async function ', start + 10);
  const next = [nextSync, nextAsync].filter((index) => index !== -1).sort((left, right) => left - right)[0];
  return source.slice(start, next ?? source.length);
}

test('agent and area navigation update only the active workspace', () => {
  for (const name of ['setArea', 'openAgentProfile', 'clearAgentProfile']) {
    const body = functionSource(name);
    assert.match(body, /refreshAreaContent\(\)/);
    assert.doesNotMatch(body, /renderShell\(\)/);
    assert.doesNotMatch(body, /loadAll\(/);
  }
});

test('internal COMMAND links are intercepted for in-place navigation', () => {
  assert.match(source, /if \(area === 'crm' && agent\) openAgentProfile\(agent, openHouse\)/);
  assert.match(source, /else setArea\(area\)/);
  assert.match(source, /window\.addEventListener\('popstate'/);
});

test('background refresh avoids the multi-megabyte dashboard bundle', () => {
  const body = functionSource('refreshLiveData');
  assert.match(body, /outreach-inbox/);
  assert.match(body, /outreach-health/);
  assert.match(body, /agent-relationships/);
  assert.doesNotMatch(body, /api\('\/api\/admin\/dashboard/);
  assert.match(body, /document\.visibilityState !== 'visible'/);
  assert.match(source, /window\.setInterval\(\(\) => \{\s*refreshLiveData\(\)/);
});

test('agent and future-open-house indexes are built once per data refresh', () => {
  assert.match(source, /commandIndexes:\s*\{\s*crmSorted: \[\],\s*futureOpenHouses: \[\]/);
  assert.match(functionSource('renderCrm'), /state\.commandIndexes\.crmSorted/);
  assert.match(functionSource('renderEvents'), /state\.commandIndexes\.futureOpenHouses/);
});
