import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Valid promo code prefixes from Open House Kit purchases
const VALID_PROMO_PREFIXES = ['OHK', 'REL8', 'BUNDLE', 'R8WEB']

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json()
    
    if (!code) {
      return NextResponse.json({ valid: false, message: 'Promo code is required' })
    }

    const upperCode = code.trim().toUpperCase()
    
    // Check if code matches valid prefix pattern (e.g., OHK-XXXXX, REL8-XXXXX)
    const hasValidPrefix = VALID_PROMO_PREFIXES.some(prefix => 
      upperCode.startsWith(prefix)
    )
    
    if (!hasValidPrefix) {
      return NextResponse.json({ 
        valid: false, 
        message: 'Invalid promo code. Please check your Open House Kit for the correct code.' 
      })
    }

    // Check against REL8TION Supabase for used codes (optional - if you track used codes)
    const rel8tionUrl = process.env.REL8TION_SUPABASE_URL
    const rel8tionKey = process.env.REL8TION_SUPABASE_ANON_KEY

    if (rel8tionUrl && rel8tionKey) {
      const supabase = createClient(rel8tionUrl, rel8tionKey)
      
      // Check if code exists in promo_codes table and hasn't been used
      const { data: promoData } = await supabase
        .from('promo_codes')
        .select('*')
        .eq('code', upperCode)
        .single()

      if (promoData) {
        if (promoData.used_at) {
          return NextResponse.json({ 
            valid: false, 
            message: 'This promo code has already been used.' 
          })
        }
        
        // Valid code found in database
        return NextResponse.json({ 
          valid: true, 
          message: 'Promo code verified!',
          discount: promoData.discount_type || 'bundle'
        })
      }
    }

    // If no database check or code not in database, 
    // accept codes with valid prefixes (for flexibility)
    // You can make this stricter by returning false here instead
    return NextResponse.json({ 
      valid: true, 
      message: 'Promo code accepted!' 
    })

  } catch (error) {
    console.error('[verify-promo] Error:', error)
    return NextResponse.json({ 
      valid: false, 
      message: 'Unable to verify code. Please try again.' 
    })
  }
}
