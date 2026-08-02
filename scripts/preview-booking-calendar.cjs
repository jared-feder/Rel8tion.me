#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { callTypeDetails, generateSlots, readBookingConfig } = require('../lib/booking-calendar');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.REL8TION_BOOKING_PREVIEW_PORT || 3101);

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${port}`}`);
  if (url.pathname === '/api/bookings/availability') {
    const config = readBookingConfig();
    const callType = callTypeDetails(url.searchParams.get('type') || 'loan_officer', config);
    return json(res, callType ? 200 : 400, callType ? {
      ok: true,
      version: config.version,
      timezone: config.timezone,
      duration_minutes: config.duration_minutes,
      minimum_notice_hours: config.minimum_notice_hours,
      call_type: callType,
      slots: generateSlots(new Date(), config)
    } : { ok: false, error: 'Choose a valid call type.' });
  }
  if (url.pathname === '/api/bookings/create' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    return req.on('end', () => {
      const payload = JSON.parse(body || '{}');
      const config = readBookingConfig();
      const callType = callTypeDetails(payload.call_type, config);
      return json(res, 201, {
        ok: true,
        booking_code: 'R8CALL-PREVIEW',
        call_type: callType,
        starts_at: payload.starts_at,
        ends_at: new Date(new Date(payload.starts_at).getTime() + config.duration_minutes * 60000).toISOString(),
        timezone: config.timezone,
        date_time_label: new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, dateStyle: 'full', timeStyle: 'short' }).format(new Date(payload.starts_at)),
        notification_warning: false
      });
    });
  }
  if (url.pathname === '/' || url.pathname === '/book-a-call' || url.pathname === '/book-a-call.html') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return fs.createReadStream(path.join(root, 'apps', 'rel8tion-app', 'book-a-call.html')).pipe(res);
  }
  res.statusCode = 404;
  res.end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`REL8TION booking preview: http://127.0.0.1:${port}/book-a-call`);
});
