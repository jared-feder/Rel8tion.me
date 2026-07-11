import { NextRequest, NextResponse } from 'next/server'

export function requireAdminSession(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (session === 'authenticated') return null
  return NextResponse.json({ error: 'Admin session required.' }, { status: 401 })
}
