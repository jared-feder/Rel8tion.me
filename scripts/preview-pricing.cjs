#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const publicPricing = require('../api/public/pricing');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.REL8TION_PRICING_PREVIEW_PORT || 3100);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${port}`}`);
  if (url.pathname === '/api/public/pricing') return publicPricing(req, res);
  if (url.pathname === '/' || url.pathname === '/pricing' || url.pathname === '/pricing.html') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return fs.createReadStream(path.join(root, 'pricing.html')).pipe(res);
  }
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`REL8TION pricing preview: http://127.0.0.1:${port}/pricing`);
});
