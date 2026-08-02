const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.join(process.cwd(), 'config', 'booking-calendar.json');
const ALLOWED_ORIGINS = new Set([
  'https://rel8tion.me',
  'https://www.rel8tion.me',
  'https://app.rel8tion.me',
  'https://getrel8tion.com',
  'https://www.getrel8tion.com',
  'https://my.rel8tion.me'
]);

function clean(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function readBookingConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (!config.timezone || !Number.isInteger(config.duration_minutes) || config.duration_minutes <= 0) {
    throw new Error('Booking calendar configuration is invalid.');
  }
  if (!config.notification_email || !config.call_types?.loan_officer || !config.call_types?.broker_team) {
    throw new Error('Booking calendar call types or notification email are missing.');
  }
  return config;
}

function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function minutes(value) {
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
}

function matchingAvailability(parts, config) {
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const localMinute = Number(parts.hour) * 60 + Number(parts.minute);
  return config.availability.some((window) => (
    window.weekdays.includes(weekday)
    && localMinute >= minutes(window.start)
    && localMinute + config.duration_minutes <= minutes(window.end)
  ));
}

function formatSlot(start, end, config) {
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  }).format(start);
  const timeLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(start);
  const parts = zonedParts(start, config.timezone);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    local_date: `${parts.year}-${parts.month}-${parts.day}`,
    date_label: dateLabel,
    time_label: timeLabel
  };
}

function generateSlots(now = new Date(), config = readBookingConfig()) {
  const incrementMs = config.slot_increment_minutes * 60 * 1000;
  const durationMs = config.duration_minutes * 60 * 1000;
  const earliest = now.getTime() + config.minimum_notice_hours * 60 * 60 * 1000;
  const latest = now.getTime() + config.booking_window_days * 24 * 60 * 60 * 1000;
  let cursor = Math.ceil(earliest / incrementMs) * incrementMs;
  const slots = [];
  for (; cursor <= latest; cursor += incrementMs) {
    const start = new Date(cursor);
    const parts = zonedParts(start, config.timezone);
    if (Number(parts.minute) % config.slot_increment_minutes !== 0) continue;
    if (!matchingAvailability(parts, config)) continue;
    slots.push(formatSlot(start, new Date(cursor + durationMs), config));
  }
  return slots;
}

function isBookableStart(startIso, now = new Date(), config = readBookingConfig()) {
  const parsed = new Date(startIso);
  if (!Number.isFinite(parsed.getTime())) return null;
  return generateSlots(now, config).find((slot) => slot.start === parsed.toISOString()) || null;
}

function callTypeDetails(callType, config = readBookingConfig()) {
  const code = clean(callType, 40);
  const details = config.call_types[code];
  return details ? { code, ...details } : null;
}

function corsHeaders(origin) {
  const headers = { 'Vary': 'Origin', 'Cache-Control': 'no-store' };
  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type';
  return headers;
}

async function supabaseRequest(resource, options = {}) {
  const url = clean(process.env.SUPABASE_URL, 500).replace(/\/$/, '');
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 2500);
  if (!url || !key) throw new Error('Booking database is not configured.');
  const response = await fetch(`${url}/rest/v1/${resource}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.hint || `Booking database request failed (${response.status}).`);
    error.status = response.status;
    error.code = payload?.code || '';
    throw error;
  }
  return payload;
}

function normalizeEmail(value) {
  const email = clean(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizePhone(value) {
  const raw = clean(value, 40);
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return '';
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

function icsEscape(value) {
  return clean(value, 2000).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function icsStamp(value) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function buildCalendarInvite(booking, config = readBookingConfig()) {
  const details = callTypeDetails(booking.call_type, config);
  const description = `${details.short_description}\n\nCompany: ${booking.company_name || 'Not provided'}\nPhone: ${booking.phone || 'Not provided'}\nBooking: ${booking.booking_code}`;
  return [
    'BEGIN:VCALENDAR',
    'PRODID:-//REL8TION//Private Consultation Calendar//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${icsEscape(booking.booking_code)}@rel8tion.me`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(booking.starts_at)}`,
    `DTEND:${icsStamp(booking.ends_at)}`,
    `SUMMARY:${icsEscape(`REL8TION — ${details.display_name}`)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `ORGANIZER;CN=REL8TION:mailto:${config.notification_email}`,
    `ATTENDEE;CN=${icsEscape(booking.contact_name)};RSVP=TRUE:mailto:${booking.email}`,
    'LOCATION:Private phone or video call — connection details follow by email',
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

function humanDateTime(value, config = readBookingConfig()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(value));
}

module.exports = {
  ALLOWED_ORIGINS,
  CONFIG_PATH,
  buildCalendarInvite,
  callTypeDetails,
  clean,
  corsHeaders,
  generateSlots,
  humanDateTime,
  isBookableStart,
  normalizeEmail,
  normalizePhone,
  readBookingConfig,
  supabaseRequest
};
