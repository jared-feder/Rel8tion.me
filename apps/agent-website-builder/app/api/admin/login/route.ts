import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const { password } = await request.json()
  
  const adminPassword = process.env.ADMIN_PASSWORD || ''
  
  if (!adminPassword) {
    return NextResponse.json(
      { error: 'Admin password not configured' },
      { status: 500 }
    )
  }
  
  if (password !== adminPassword) {
    return NextResponse.json(
      { error: 'Invalid password' },
      { status: 401 }
    )
  }
  
  // Set a secure cookie for admin session via response
  const response = NextResponse.json({ success: true })
  
  response.cookies.set('admin_session', 'authenticated', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  })
  
  return response
}

export async function DELETE() {
  const response = NextResponse.json({ success: true })
  response.cookies.set('admin_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })
  return response
}
