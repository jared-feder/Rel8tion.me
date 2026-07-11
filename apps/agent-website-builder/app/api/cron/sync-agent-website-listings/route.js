import { createRequire } from 'node:module'
import { NextResponse } from 'next/server'

const require = createRequire(import.meta.url)
const { run } = require('../../../../rel8tion_agent_website_listings_runner.cjs')

export const runtime = 'nodejs'

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
}

async function handler(request) {
  try {
    if (!process.env.SUPABASE_URL && !process.env.REL8TION_SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
      throw new Error('Missing SUPABASE_URL.')
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SECRET_KEY) {
      throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY.')
    }

    const secret = process.env.CRON_SHARED_SECRET
    if (secret) {
      const auth = request.headers.get('authorization') || ''
      if (auth !== `Bearer ${secret}`) return unauthorized()
    }

    const result = await run({
      mode: 'cron',
      dryRun: false,
      supabaseUrl: process.env.REL8TION_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
      outputFile: '',
    })

    return NextResponse.json({
      ok: true,
      mode: 'cron',
      dryRun: false,
      enqueued: result.enqueued || 0,
      processed: result.processed || 0,
      written: result.written || 0,
      failed: result.failed || 0,
    })
  } catch (error) {
    console.error('[cron/sync-agent-website-listings] failed', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Listing sync failed.' },
      { status: 500 },
    )
  }
}

export async function GET(request) {
  return handler(request)
}

export async function POST(request) {
  return handler(request)
}
