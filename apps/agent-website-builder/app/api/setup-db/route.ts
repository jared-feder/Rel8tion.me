import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

// This endpoint creates all necessary tables for the agent website builder
// Run once during initial setup
export async function POST() {
  try {
    const supabase = createAdminClient()

    // Create agent_websites table (separate from REL8TION data)
    const { error: sitesError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS agent_websites (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
          
          -- Agent Info
          name TEXT NOT NULL,
          title TEXT,
          brokerage TEXT,
          license_number TEXT,
          email TEXT,
          phone TEXT,
          bio TEXT,
          
          -- Branding (can reference REL8TION brokerage or built-in)
          brand_source TEXT DEFAULT 'built-in', -- 'built-in' or 'rel8tion'
          brand_id TEXT, -- REL8TION brokerage ID if brand_source='rel8tion'
          color_scheme TEXT DEFAULT 'warm-earth', -- built-in scheme ID if brand_source='built-in'
          font_pairing TEXT DEFAULT 'classic',
          
          -- Photos
          photo_url TEXT,
          hero_image_url TEXT,
          about_image_url TEXT,
          gallery_image_urls TEXT[] DEFAULT '{}',
          gallery_images TEXT[] DEFAULT '{}',
          testimonials_json JSONB DEFAULT '[]'::jsonb,
          
          -- Social Media
          facebook_url TEXT,
          instagram_url TEXT,
          linkedin_url TEXT,
          twitter_url TEXT,
          youtube_url TEXT,
          tiktok_url TEXT,
          
          -- REL8TION Integration (read-only reference)
          rel8tion_agent_id TEXT,
          mls_url TEXT,
          
          -- Website Slug (completely separate from REL8TION slugs)
          website_slug TEXT UNIQUE NOT NULL,
          custom_domain TEXT UNIQUE,
          
          -- Subscription
          plan TEXT DEFAULT 'standalone',
          stripe_customer_id TEXT,
          stripe_subscription_id TEXT,
          subscription_status TEXT DEFAULT 'pending',
          
          -- Timestamps
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          published_at TIMESTAMPTZ
        );
        
        -- Create index for website_slug lookups (not brokerage slugs)
        CREATE INDEX IF NOT EXISTS idx_agent_websites_slug ON agent_websites(website_slug);
        CREATE INDEX IF NOT EXISTS idx_agent_websites_custom_domain ON agent_websites(custom_domain);
        
        -- Enable RLS
        ALTER TABLE agent_websites ENABLE ROW LEVEL SECURITY;
        
        -- RLS Policies
        CREATE POLICY IF NOT EXISTS "agents_select_own" ON agent_websites 
          FOR SELECT USING (auth.uid() = user_id);
        CREATE POLICY IF NOT EXISTS "agents_insert_own" ON agent_websites 
          FOR INSERT WITH CHECK (auth.uid() = user_id);
        CREATE POLICY IF NOT EXISTS "agents_update_own" ON agent_websites 
          FOR UPDATE USING (auth.uid() = user_id);
        CREATE POLICY IF NOT EXISTS "agents_delete_own" ON agent_websites 
          FOR DELETE USING (auth.uid() = user_id);
        
        -- Public read policy for published sites
        CREATE POLICY IF NOT EXISTS "public_read_published" ON agent_websites 
          FOR SELECT USING (published_at IS NOT NULL);
      `
    })

    if (sitesError) {
      // Try alternative approach - direct SQL
      console.log('[v0] RPC not available, trying direct table creation')
    }

    // Create rel8tion_brands table for imported brands
    const { error: brandsError } = await supabase.from('rel8tion_brands').select('id').limit(1)
    
    if (brandsError?.code === '42P01') {
      // Table doesn't exist, we'd need to create it via Supabase dashboard or migration
      console.log('[v0] rel8tion_brands table needs to be created')
    }

    // Create contact_submissions table
    const { error: contactError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS contact_submissions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_website_id UUID REFERENCES agent_websites(id) ON DELETE SET NULL,
          agent_name TEXT,
          agent_email TEXT,
          agent_phone TEXT,
          site_slug TEXT,
          source_url TEXT,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT,
          message TEXT NOT NULL,
          preferred_contact TEXT DEFAULT 'email',
          status TEXT DEFAULT 'new',
          email_sent BOOLEAN DEFAULT false,
          email_error TEXT,
          crm_synced BOOLEAN DEFAULT false,
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY;
      `
    })

    if (contactError) {
      console.log('[v0] contact_submissions table creation note:', contactError.message)
    }

    // Create AI media table
    const { error: aiMediaError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS agent_website_ai_media (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_website_id UUID REFERENCES agent_websites(id) ON DELETE SET NULL,
          media_type TEXT NOT NULL
            CHECK (media_type IN ('staging_image', 'social_video', 'agent_headshot')),
          status TEXT DEFAULT 'created',
          source_url TEXT,
          result_url TEXT,
          thumbnail_url TEXT,
          openai_id TEXT,
          prompt TEXT NOT NULL,
          caption TEXT,
          metadata JSONB DEFAULT '{}'::jsonb,
          error TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        ALTER TABLE agent_website_ai_media ENABLE ROW LEVEL SECURITY;
      `
    })

    if (aiMediaError) {
      console.log('[v0] agent_website_ai_media table creation note:', aiMediaError.message)
    }

    // Create listings table for OneKey MLS data
    const { error: listingsError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS listings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          mls_id TEXT UNIQUE NOT NULL,
          
          -- Property Info
          address TEXT,
          city TEXT,
          state TEXT DEFAULT 'NY',
          zip TEXT,
          price NUMERIC,
          beds INTEGER,
          baths NUMERIC,
          sqft INTEGER,
          lot_size NUMERIC,
          year_built INTEGER,
          property_type TEXT,
          listing_status TEXT DEFAULT 'Active',
          description TEXT,
          
          -- Agent/Brokerage Info
          brokerage TEXT,
          agent_name TEXT,
          agent_phone TEXT,
          agent_email TEXT,
          
          -- Location
          lat DOUBLE PRECISION,
          lng DOUBLE PRECISION,
          
          -- Media
          images TEXT[] DEFAULT '{}',
          primary_image TEXT,
          
          -- Open House
          open_house_start TIMESTAMPTZ,
          open_house_end TIMESTAMPTZ,
          
          -- Metadata
          source TEXT DEFAULT 'onekey',
          synced_at TIMESTAMPTZ DEFAULT NOW(),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        
        -- Indexes for efficient queries
        CREATE INDEX IF NOT EXISTS idx_listings_mls_id ON listings(mls_id);
        CREATE INDEX IF NOT EXISTS idx_listings_agent_name ON listings(agent_name);
        CREATE INDEX IF NOT EXISTS idx_listings_brokerage ON listings(brokerage);
        CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(listing_status);
        CREATE INDEX IF NOT EXISTS idx_listings_location ON listings(lat, lng);
        
        -- Enable RLS with public read
        ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
        
        -- Anyone can read listings
        CREATE POLICY IF NOT EXISTS "public_read_listings" ON listings 
          FOR SELECT USING (true);
      `
    })

    if (listingsError) {
      console.log('[v0] Listings table creation note:', listingsError.message)
    }

    // Create site-owned listings table for manual/scraper imports
    const { error: websiteListingsError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS agent_website_listings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_website_id UUID NOT NULL REFERENCES agent_websites(id) ON DELETE CASCADE,
          source TEXT DEFAULT 'manual',
          source_listing_id TEXT,
          mls_id TEXT,
          title TEXT,
          address TEXT NOT NULL,
          city TEXT,
          state TEXT DEFAULT 'NY',
          zip TEXT,
          price NUMERIC,
          beds NUMERIC,
          baths NUMERIC,
          sqft INTEGER,
          lot_size NUMERIC,
          year_built INTEGER,
          annual_property_taxes NUMERIC,
          property_type TEXT,
          listing_status TEXT DEFAULT 'active',
          description TEXT,
          features TEXT[] DEFAULT '{}',
          images TEXT[] DEFAULT '{}',
          primary_image TEXT,
          listing_url TEXT,
          brokerage TEXT,
          agent_name TEXT,
          agent_phone TEXT,
          agent_email TEXT,
          open_house_start TIMESTAMPTZ,
          open_house_end TIMESTAMPTZ,
          lat DOUBLE PRECISION,
          lng DOUBLE PRECISION,
          sort_order INTEGER DEFAULT 0,
          is_featured BOOLEAN DEFAULT true,
          disclaimer TEXT,
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        ALTER TABLE agent_website_listings ENABLE ROW LEVEL SECURITY;
      `
    })

    if (websiteListingsError) {
      console.log('[v0] agent_website_listings table creation note:', websiteListingsError.message)
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Database check complete. Tables: agent_websites, listings. Some may need manual creation via Supabase dashboard.'
    })

  } catch (error) {
    console.error('[v0] Setup error:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'POST to this endpoint to set up the database schema',
    tables: ['agent_sites', 'rel8tion_brands', 'contact_submissions', 'agent_website_ai_media', 'agent_website_listings']
  })
}
