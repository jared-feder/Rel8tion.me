const nodemailer = require('nodemailer');

function clean(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

function escapeHtml(value) {
  return clean(value, 5000).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function disclosureSigned(checkin = {}) {
  const metadata = checkin.metadata && typeof checkin.metadata === 'object' ? checkin.metadata : {};
  const agency = metadata.nys_agency_disclosure || {};
  const courtesy = metadata.rel8tion_courtesy_notice || {};
  const housing = metadata.ny_discrimination_disclosure || {};
  const agencySigned = (agency.agency_disclosure_reviewed === true || metadata.agency_disclosure_reviewed === true)
    && (agency.seller_representation_acknowledged === true || metadata.seller_representation_acknowledged === true)
    && Boolean(agency.agency_disclosure_signed_at || metadata.agency_disclosure_signed_at);
  const housingSigned = housing.acknowledged === true
    && housing.reviewed === true
    && housing.esign_consent === true
    && Boolean(housing.e_signature_value);
  const courtesySigned = (courtesy.rel8tion_courtesy_acknowledged === true || metadata.rel8tion_courtesy_acknowledged === true)
    && Boolean(courtesy.rel8tion_courtesy_signed_at || metadata.rel8tion_courtesy_signed_at);
  return agencySigned && housingSigned && courtesySigned;
}

function eventAddress(event = {}, house = {}) {
  const context = event.setup_context && typeof event.setup_context === 'object' ? event.setup_context : {};
  return clean(house.address || context.address || context.property_address || 'Open house', 400);
}

function buildSponsoredEventRecap({ event = {}, house = {}, agent = {}, checkins = [] } = {}) {
  const address = eventAddress(event, house);
  const signedCount = checkins.filter(disclosureSigned).length;
  const rows = checkins.length
    ? checkins.map((checkin) => {
      const metadata = checkin.metadata && typeof checkin.metadata === 'object' ? checkin.metadata : {};
      const name = clean(checkin.visitor_name || checkin.name || metadata.name || 'Open house visitor', 200);
      const phone = clean(checkin.visitor_phone || checkin.phone || metadata.phone, 100);
      const email = clean(checkin.visitor_email || checkin.email || metadata.email, 320);
      return `<tr><td style="padding:10px;border-bottom:1px solid #dbe4f0"><strong>${escapeHtml(name)}</strong><br><span style="color:#526179">${escapeHtml([phone, email].filter(Boolean).join(' | ') || 'No contact shown')}</span></td><td style="padding:10px;border-bottom:1px solid #dbe4f0">${disclosureSigned(checkin) ? 'Signed' : 'Incomplete'}</td></tr>`;
    }).join('')
    : '<tr><td colspan="2" style="padding:14px">No buyer check-ins were recorded.</td></tr>';

  const html = [
    `<h1>Your REL8TION event recap</h1>`,
    `<p><strong>${escapeHtml(address)}</strong></p>`,
    `<p>${escapeHtml(agent.name || agent.slug || 'Agent')}, this sponsored Event Pass was provided for this open house only. This email is your event copy.</p>`,
    `<p><strong>${checkins.length}</strong> check-in${checkins.length === 1 ? '' : 's'} and <strong>${signedCount}</strong> completed disclosure set${signedCount === 1 ? '' : 's'} were recorded.</p>`,
    '<table style="width:100%;border-collapse:collapse"><thead><tr><th style="padding:10px;text-align:left;border-bottom:2px solid #172c76">Check-in</th><th style="padding:10px;text-align:left;border-bottom:2px solid #172c76">Disclosure status</th></tr></thead><tbody>',
    rows,
    '</tbody></table>',
    '<p style="margin-top:20px"><strong>Event-only access:</strong> this sponsored event is not retained in your permanent agent dashboard, disclosure library, analytics, or reports. REL8TION still preserves required compliance and audit evidence internally.</p>',
    '<p>Activate REL8TION Agent membership to keep permanent check-in and disclosure history, analytics, reporting, your dashboard, and assisted follow-up for future events.</p>',
    '<p><a href="https://app.rel8tion.me/pricing?role=agent">View REL8TION Agent membership</a></p>'
  ].join('');

  return {
    subject: `Your REL8TION event recap - ${address}`,
    html,
    address,
    checkin_count: checkins.length,
    disclosure_count: signedCount
  };
}

async function deliverEmail({ to, subject, html, eventId }) {
  const smtpHost = clean(process.env.SMTP_HOST, 500);
  const smtpPort = Number(process.env.SMTP_PORT || 465);
  const smtpUser = clean(process.env.SMTP_USER, 500);
  const smtpPassword = clean(process.env.SMTP_PASSWORD, 1000);
  const fromEmail = clean(process.env.REL8TION_FROM_EMAIL || process.env.LEAD_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || smtpUser, 320);
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
      messageId: `<event-recap-${eventId}@rel8tion.me>`,
      subject,
      html
    });
  }

  const apiKey = clean(process.env.RESEND_API_KEY, 1000);
  if (!apiKey) throw new Error('No event-recap email provider is configured.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `event-recap-${eventId}`
    },
    body: JSON.stringify({
      from: clean(process.env.REL8TION_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'REL8TION <onboarding@resend.dev>', 320),
      to: [to],
      subject,
      html,
      tags: [{ name: 'category', value: 'sponsored_event_recap' }]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `Event recap email failed: ${response.status}`);
  return payload;
}

async function sendSponsoredEventRecap(input = {}) {
  const recipient = clean(input.agent?.email || input.event?.setup_context?.agent_email, 320).toLowerCase();
  if (!recipient) return { status: 'missing_recipient', warning: 'The agent profile does not have an email address.' };
  const recap = buildSponsoredEventRecap(input);
  const delivery = await deliverEmail({
    to: recipient,
    subject: recap.subject,
    html: recap.html,
    eventId: input.event?.id
  });
  return {
    status: 'sent',
    recipient,
    sent_at: new Date().toISOString(),
    id: clean(delivery?.messageId || delivery?.id, 500) || null,
    checkin_count: recap.checkin_count,
    disclosure_count: recap.disclosure_count
  };
}

module.exports = {
  buildSponsoredEventRecap,
  disclosureSigned,
  sendSponsoredEventRecap
};
