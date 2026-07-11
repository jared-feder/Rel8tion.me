import { NextRequest, NextResponse } from 'next/server'
import { ContactFormData } from '@/lib/types'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/contact - Handle contact form submissions

interface ContactRequestBody extends ContactFormData {
  agentId?: string
  agentName?: string
  agentEmail?: string
  agentPhone?: string
  sourceUrl?: string
}

function clean(value?: string) {
  return String(value || '').trim()
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

async function sendLeadEmail({
  to,
  subject,
  html,
  replyTo,
}: {
  to: string
  subject: string
  html: string
  replyTo: string
}) {
  const sendgridKey = process.env.SENDGRID_API_KEY
  const resendKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.LEAD_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL || process.env.RESEND_FROM_EMAIL

  if (!fromEmail) return { sent: false, error: 'Missing lead sender email env var.' }

  if (sendgridKey) {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sendgridKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: fromEmail, name: 'REL8TION Agent Websites' },
        reply_to: { email: replyTo },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    })

    return { sent: response.ok, error: response.ok ? '' : await response.text() }
  }

  if (resendKey) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `REL8TION Agent Websites <${fromEmail}>`,
        to,
        reply_to: replyTo,
        subject,
        html,
      }),
    })

    return { sent: response.ok, error: response.ok ? '' : await response.text() }
  }

  return { sent: false, error: 'No email provider configured.' }
}

async function syncCrmLead(payload: Record<string, unknown>) {
  const webhookUrl = process.env.CRM_WEBHOOK_URL || process.env.LEAD_CRM_WEBHOOK_URL
  if (!webhookUrl) return { synced: false, error: 'No CRM webhook configured.' }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.CRM_WEBHOOK_SECRET ? { Authorization: `Bearer ${process.env.CRM_WEBHOOK_SECRET}` } : {}),
    },
    body: JSON.stringify(payload),
  })

  return { synced: response.ok, error: response.ok ? '' : await response.text() }
}

export async function POST(request: NextRequest) {
  try {
    const body: ContactRequestBody = await request.json()
    const name = clean(body.name)
    const email = clean(body.email)
    const phone = clean(body.phone)
    const message = clean(body.message)
    const agentId = clean(body.agentId)
    const agentName = clean(body.agentName)
    const agentEmail = clean(body.agentEmail)
    const agentPhone = clean(body.agentPhone)
    const sourceUrl = clean(body.sourceUrl)
    const preferredContact = body.preferredContact === 'phone' ? 'phone' : 'email'

    // Validate required fields
    if (!name || !email || !message) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()
    const { data: site } = agentId
      ? await supabase
        .from('agent_websites')
        .select('id,slug,name,email,phone')
        .eq('id', agentId)
        .maybeSingle()
      : { data: null }

    const leadPayload = {
      agent_website_id: site?.id || null,
      agent_name: site?.name || agentName || null,
      agent_email: site?.email || agentEmail || null,
      agent_phone: site?.phone || agentPhone || null,
      site_slug: site?.slug || null,
      source_url: sourceUrl || null,
      name,
      email,
      phone: phone || null,
      message,
      preferred_contact: preferredContact,
      metadata: {
        listingId: body.listingId || null,
        userAgent: request.headers.get('user-agent') || '',
        referer: request.headers.get('referer') || '',
      },
    }

    const { data: lead, error: insertError } = await supabase
      .from('contact_submissions')
      .insert(leadPayload)
      .select('id')
      .single()

    if (insertError) throw insertError

    const recipient = site?.email || agentEmail || process.env.LEAD_NOTIFICATION_EMAIL || ''
    let emailResult = { sent: false, error: 'No recipient email available.' }

    if (recipient) {
      const safeMessage = escapeHtml(message).replace(/\n/g, '<br />')
      emailResult = await sendLeadEmail({
        to: recipient,
        replyTo: email,
        subject: `New website lead from ${name}`,
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
            <h2>New REL8TION website lead</h2>
            <p><strong>Name:</strong> ${escapeHtml(name)}</p>
            <p><strong>Email:</strong> ${escapeHtml(email)}</p>
            <p><strong>Phone:</strong> ${escapeHtml(phone || 'Not provided')}</p>
            <p><strong>Preferred contact:</strong> ${escapeHtml(preferredContact)}</p>
            <p><strong>Source:</strong> ${escapeHtml(sourceUrl || 'Agent website')}</p>
            <hr />
            <p>${safeMessage}</p>
            <hr />
            <p style="font-size: 12px; color: #6b7280;">Powered by rel8tion.me</p>
          </div>
        `,
      })
    }

    const crmResult = await syncCrmLead({
      leadId: lead.id,
      agentWebsiteId: site?.id || null,
      agentName: site?.name || agentName || '',
      agentEmail: site?.email || agentEmail || '',
      agentPhone: site?.phone || agentPhone || '',
      siteSlug: site?.slug || '',
      sourceUrl,
      name,
      email,
      phone,
      message,
      preferredContact,
      submittedAt: new Date().toISOString(),
    })

    await supabase
      .from('contact_submissions')
      .update({
        email_sent: emailResult.sent,
        email_error: emailResult.sent ? null : emailResult.error,
        crm_synced: crmResult.synced,
        metadata: {
          listingId: body.listingId || null,
          userAgent: request.headers.get('user-agent') || '',
          referer: request.headers.get('referer') || '',
          crm_error: crmResult.synced ? null : crmResult.error,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.id)

    console.log('[Contact Form] New submission stored:', {
      leadId: lead.id,
      name,
      email,
      phone,
      preferredContact,
      emailSent: emailResult.sent,
      crmSynced: crmResult.synced,
    })

    return NextResponse.json({
      success: true,
      leadId: lead.id,
      emailSent: emailResult.sent,
      crmSynced: crmResult.synced,
      message: 'Thank you for your message. We will get back to you soon!',
    })
  } catch (error) {
    console.error('[API] Error processing contact form:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
