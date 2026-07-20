#!/usr/bin/env node
const { run } = require('../onekey-headshot-worker.cjs');

run({
  days: Number(process.env.DAYS || 14),
  limit: Number(process.env.LIMIT || 8),
  dryRun: !process.argv.includes('--write')
}).then((result) => {
  console.log(JSON.stringify(result, null, 2));
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
