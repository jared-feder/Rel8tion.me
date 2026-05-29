const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const criticalProductionFiles = [
  ['api/agent-profile-photo.js', 'agent owner profile photo uploads'],
  ['api/buyer-affordability.js', 'buyer sync and LO affordability guidance'],
  ['api/chip-qr.js', 'printed Rel8tionChip QR resolver'],
  ['api/loan-officer-support-request.js', 'loan officer support request form'],
  ['api/sms/android-inbound.js', 'Android Gateway inbound webhook'],
  ['api/admin/android-inbox-replay.js', 'admin Android inbox replay'],
  ['api/admin/key-action.js', 'protected admin key maintenance'],
  ['api/admin/outreach-health.js', 'admin outreach health panel'],
  ['api/admin/outreach-search.js', 'admin outreach full-table search'],
  ['api/cron/replay-android-inbox.js', 'scheduled Android inbox replay'],
  ['apps/rel8tion-app/src/api/chipQr.js', 'agent QR linking browser helper'],
  ['lib/android-inbox-export.js', 'Android inbox export helper'],
  ['supabase/functions/android-inbox-replay/index.ts', 'Supabase Android inbox replay function source']
];

function normalize(relPath) {
  return String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function loadTrackedFiles() {
  const command = process.platform === 'win32' ? 'git.exe' : 'git';
  const result = spawnSync(command, ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  if (result.error) {
    if (process.env.GITHUB_ACTIONS === 'true') throw result.error;
    console.warn(`Warning: git ls-files was unavailable (${result.error.message}). Falling back to filesystem checks.`);
    return { files: new Set(listFiles(ROOT)), strict: false };
  }
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr || result.stdout}`);
  }
  return { files: new Set(result.stdout.split(/\r?\n/).map(normalize).filter(Boolean)), strict: true };
}

function listFiles(dir, base = ROOT) {
  const ignored = new Set(['.git', '.vercel', 'node_modules']);
  const rows = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rows.push(...listFiles(fullPath, base));
    } else {
      rows.push(normalize(path.relative(base, fullPath)));
    }
  }
  return rows;
}

function fileState(relPath, trackedState) {
  const normalized = normalize(relPath);
  if (trackedState.files.has(normalized)) return 'tracked';
  if (!trackedState.strict && fs.existsSync(path.join(ROOT, normalized))) return 'tracked';
  if (fs.existsSync(path.join(ROOT, normalized))) return 'untracked';
  return 'missing';
}

function stripDestination(destination) {
  return normalize(String(destination || '').split('?')[0]);
}

function apiCandidates(destination) {
  const clean = stripDestination(destination);
  const ext = path.extname(clean);
  if (ext) return [clean];
  return [
    `${clean}.js`,
    `${clean}.cjs`,
    `${clean}.mjs`,
    `${clean}.ts`,
    `${clean}/index.js`,
    `${clean}/index.cjs`,
    `${clean}/index.mjs`,
    `${clean}/index.ts`
  ];
}

function candidateSummary(candidates, tracked) {
  for (const candidate of candidates) {
    if (fileState(candidate, tracked) === 'tracked') return { ok: true, file: candidate };
  }
  const existing = candidates.find((candidate) => fileState(candidate, tracked) === 'untracked');
  if (existing) return { ok: false, file: existing, state: 'untracked' };
  return { ok: false, file: candidates[0], state: 'missing' };
}

function cleanSourceNeedsWrapper(source, destination) {
  const src = String(source || '');
  const dest = String(destination || '');
  return src.startsWith('/')
    && src !== '/'
    && !src.includes(':')
    && !src.endsWith('.html')
    && dest.startsWith('/apps/rel8tion-app/')
    && dest.split('?')[0].endsWith('.html');
}

function wrapperForSource(source) {
  return `${normalize(source)}.html`;
}

function main() {
  const tracked = loadTrackedFiles();
  const configPath = path.join(ROOT, 'vercel.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const failures = [];

  for (const [index, rewrite] of (config.rewrites || []).entries()) {
    const destination = stripDestination(rewrite.destination);
    const candidates = destination.startsWith('api/')
      ? apiCandidates(destination)
      : [destination];
    const result = candidateSummary(candidates, tracked);
    if (!result.ok) {
      failures.push({
        type: 'rewrite-destination',
        route: rewrite.source,
        file: result.file,
        problem: `${result.state} destination for rewrite #${index}`
      });
    }

    if (cleanSourceNeedsWrapper(rewrite.source, rewrite.destination)) {
      const wrapper = wrapperForSource(rewrite.source);
      const state = fileState(wrapper, tracked);
      if (state !== 'tracked') {
        failures.push({
          type: 'clean-url-wrapper',
          route: rewrite.source,
          file: wrapper,
          problem: `${state} root wrapper for clean URL`
        });
      }
    }
  }

  for (const cron of (config.crons || [])) {
    const clean = stripDestination(cron.path);
    const result = candidateSummary(apiCandidates(clean), tracked);
    if (!result.ok) {
      failures.push({
        type: 'cron-target',
        route: cron.path,
        file: result.file,
        problem: `${result.state} cron API target`
      });
    }
  }

  for (const [file, reason] of criticalProductionFiles) {
    const state = fileState(file, tracked);
    if (state !== 'tracked') {
      failures.push({
        type: 'critical-production-file',
        route: reason,
        file,
        problem: `${state} critical production file`
      });
    }
  }

  if (failures.length) {
    console.error('Route map verification failed. These files must be tracked before production deploy:');
    for (const item of failures) {
      console.error(`- [${item.type}] ${item.route}: ${item.file} (${item.problem})`);
    }
    process.exit(1);
  }

  console.log('Route map verification passed: Vercel rewrites, crons, clean URL wrappers, and critical production files are tracked.');
}

main();
