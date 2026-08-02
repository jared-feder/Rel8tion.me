const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const {
  buildCalendarInvite,
  callTypeDetails,
  clean,
  corsHeaders,
  humanDateTime,
  isBookableStart,
  normalizeEmail,
  normalizePhone,
  readBookingConfig,
  supabaseRequest
} = require('../../lib/booking-calendar');

function escapeHtml(value) {
  return clean(value, 2000).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function bookingCode() {
  return `R8CALL-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function requestIpHash(req) {
  const secret = clean(process.env.BOOKING_IP_HASH_SECRET, 500);
  const forwarded = clean(req.headers?.['x-forwarded-for'], 500).split(',')[0].trim();
  if (!secret || !forwarded) return null;
  return crypto.createHmac('sha256', secret).update(forwarded).digest('hex');
}

async function sendEmail({ to, subject, html, invite, filename }) {
  const smtpHost = clean(process.env.SMTP_HOST, 500);
  const smtpPort = Number(process.env.SMTP_PORT || 465);
  const smtpUser = clean(process.env.SMTP_USER, 500);
  const smtpPassword = clean(process.env.SMTP_PASSWORD, 1000);
  const fromEmail = clean(
    process.env.REL8TION_FROM_EMAIL || process.env.LEAD_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || smtpUser,
    320
  );

  if (smtpHost && smtpUser && smtpPassword && fromEmail) {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPassword }
    });
    return transporter.sendMail({
      from: `REL8TION <${fromEmail}>`,
      to,
      replyTo: 'jared@rel8tion.me',
      subject,
      html,
      attachments: [{ filename, content: invite, contentType: 'text/calendar; method=REQUEST; charset=UTF-8' }]
    });
  }

  const apiKey = clean(process.env.RESEND_API_KEY, 1000);
  if (!apiKey) throw new Error('No booking email provider is configured.');
  const from = clean(process.env.REL8TION_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'REL8TION <onboarding@resend.dev>', 320);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      attachments: [{ filename, content: Buffer.from(invite, 'utf8').toString('base64') }],
      tags: [{ name: 'category', value: 'private_pricing_call' }]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `Resend failed (${response.status}).`);
  return payload;
}

async function updateNotification(bookingCodeValue, patch) {
  try {
    await supabaseRequest(`rel8tion_call_bookings?booking_code=eq.${encodeURIComponent(bookingCodeValue)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
    });
  } catch (error) {
    console.error('[bookings/create] notification status update failed', error.message || error);
  }
}

module.exports = async function handler(req, res) {
  const origin = String(req.headers?.origin || '');
  for (const [name, value] of Object.entries(corsHeaders(origin))) res.setHeader(name, value);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed.' });

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (clean(body.website, 200)) return res.status(200).json({ ok: true, received: true });

    const config = readBookingConfig();
    const callType = callTypeDetails(body.call_type, config);
    const contactName = clean(body.contact_name, 160);
    const email = normalizeEmail(body.email);
    const phone = normalizePhone(body.phone);
    const companyName = clean(body.company_name, 200);
    const notes = clean(body.notes, 2000);
    const source = clean(body.source || 'book-a-call', 120);
    const teamSize = body.team_size === '' || body.team_size == null ? null : Number(body.team_size);
    const slot = isBookableStart(body.starts_at, new Date(), config);

    if (!callType) return res.status(400).json({ ok: false, error: 'Choose a valid call type.' });
    if (!contactName || !email || !phone || !companyName) {
      return res.status(400).json({ ok: false, error: 'Name, company, email, and phone are required.' });
    }
    if (teamSize !== null && (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > 100000)) {
      return res.status(400).json({ ok: false, error: 'Enter a valid team size.' });
    }
    if (!slot) return res.status(409).json({ ok: false, error: 'That time is no longer available. Please choose another.' });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recent = await supabaseRequest(
      `rel8tion_call_bookings?select=id&email_normalized=eq.${encodeURIComponent(email)}&created_at=gte.${encodeURIComponent(since)}&limit=3`
    );
    if ((recent || []).length >= 2) {
      return res.status(429).json({ ok: false, error: 'Please contact jared@rel8tion.me if you need another appointment.' });
    }

    const code = bookingCode();
    let rows;
    try {
      rows = await supabaseRequest('rel8tion_call_bookings', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          booking_code: code,
          call_type: callType.code,
          status: 'confirmed',
          starts_at: slot.start,
          ends_at: slot.end,
          timezone: config.timezone,
          contact_name: contactName,
          email,
          email_normalized: email,
          phone,
          company_name: companyName,
          team_size: teamSize,
          notes: notes || null,
          source,
          request_ip_hash: requestIpHash(req),
          metadata: { user_agent: clean(req.headers?.['user-agent'], 500) }
        })
      });
    } catch (error) {
      if (error.code === '23505' || error.status === 409) {
        return res.status(409).json({ ok: false, error: 'That time was just booked. Please choose another.' });
      }
      throw error;
    }

    const booking = rows?.[0];
    if (!booking) throw new Error('Booking was not returned after reservation.');
    const when = humanDateTime(booking.starts_at, config);
    const invite = buildCalendarInvite(booking, config);
    const filename = `rel8tion-${code.toLowerCase()}.ics`;
    const subject = `REL8TION call confirmed — ${when}`;
    const customerHtml = `<h1>Your REL8TION call is confirmed</h1><p><strong>${escapeHtml(callType.display_name)}</strong></p><p>${escapeHtml(when)}</p><p>We will use the phone number you provided. Any video or connection details will follow by email.</p><p>Confirmation: <strong>${escapeHtml(code)}</strong></p>`;
    const ownerHtml = `<h1>New REL8TION private-pricing call</h1><p><strong>${escapeHtml(callType.display_name)}</strong></p><p>${escapeHtml(when)}</p><p>${escapeHtml(contactName)} — ${escapeHtml(companyName)}</p><p>Email: ${escapeHtml(email)}<br>Phone: ${escapeHtml(phone)}<br>Team size: ${escapeHtml(teamSize || 'Not provided')}</p><p>${escapeHtml(notes || 'No notes provided.')}</p><p>Confirmation: <strong>${escapeHtml(code)}</strong></p>`;

    let notificationWarning = false;
    try {
      await Promise.all([
        sendEmail({ to: email, subject, html: customerHtml, invite, filename }),
        sendEmail({ to: config.notification_email, subject: `New ${callType.display_name} — ${when}`, html: ownerHtml, invite, filename })
      ]);
      await updateNotification(code, { confirmation_sent_at: new Date().toISOString(), notification_error: null });
    } catch (error) {
      notificationWarning = true;
      console.error('[bookings/create] confirmation delivery failed', error.message || error);
      await updateNotification(code, { notification_error: clean(error.message || error, 1000) });
    }

    return res.status(201).json({
      ok: true,
      booking_code: code,
      call_type: callType,
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      timezone: config.timezone,
      date_time_label: when,
      notification_warning: notificationWarning
    });
  } catch (error) {
    console.error('[bookings/create]', error.message || error);
    return res.status(503).json({ ok: false, error: 'Scheduling is temporarily unavailable. Please try again shortly.' });
  }
};

module.exports.bookingCode = bookingCode;
module.exports.requestIpHash = requestIpHash;
