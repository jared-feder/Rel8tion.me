#!/usr/bin/env node

const { run } = require('./verify-pricing.cjs');

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
