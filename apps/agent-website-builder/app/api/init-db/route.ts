import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 })
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  
  // Create agent_websites table
  const { error: error1 } = await supabase.rpc('exec', {
    query: `
      CREATE TABLE IF NOT EXISTS agent_websites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        title TEXT,
        brokerage TEXT,
        email TEXT,
        phone TEXT,
        bio TEXT,
        photo_url TEXT,
        hero_image_url TEXT,
        about_image_url TEXT,
        gallery_image_urls TEXT[] DEFAULT '{}',
        testimonials_json JSONB DEFAULT '[]'::jsonb,
        color_scheme TEXT DEFAULT 'warm-earth',
        font_pairing TEXT DEFAULT 'modern',
        custom_domain TEXT,
        status TEXT DEFAULT 'published',
        facebook_url TEXT,
        instagram_url TEXT,
        linkedin_url TEXT,
        views INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
  })
  
  // Try direct SQL via REST if RPC doesn't exist
  // For now, let's just try inserting test data to see if tables exist
  
  // Check if we can query the table
  const { data: websites, error: selectError } = await supabase
    .from('agent_websites')
    .select('*')
    .limit(1)
  
  if (selectError?.code === '42P01') {
    // Table doesn't exist - need to create via Supabase dashboard
    return NextResponse.json({ 
      error: 'Tables not created yet',
      message: 'Please create tables in Supabase dashboard or run the SQL migration',
      sql: `
CREATE TABLE agent_websites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  title TEXT,
  brokerage TEXT,
  email TEXT,
  phone TEXT,
  bio TEXT,
  photo_url TEXT,
  hero_image_url TEXT,
  about_image_url TEXT,
  gallery_image_urls TEXT[] DEFAULT '{}',
  testimonials_json JSONB DEFAULT '[]'::jsonb,
  color_scheme TEXT DEFAULT 'warm-earth',
  font_pairing TEXT DEFAULT 'modern',
  custom_domain TEXT,
  status TEXT DEFAULT 'published',
  facebook_url TEXT,
  instagram_url TEXT,
  linkedin_url TEXT,
  views INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mls_id TEXT UNIQUE,
  agent_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT DEFAULT 'NY',
  zip TEXT,
  price NUMERIC,
  beds INTEGER,
  baths NUMERIC,
  sqft INTEGER,
  property_type TEXT,
  listing_status TEXT DEFAULT 'Active',
  description TEXT,
  brokerage TEXT,
  images TEXT[] DEFAULT '{}',
  primary_image TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  source TEXT DEFAULT 'onekey',
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  type TEXT DEFAULT 'bundle',
  uses_remaining INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE contact_submissions (
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

CREATE TABLE agent_website_listings (
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

CREATE TABLE agent_website_ai_media (
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

ALTER TABLE agent_websites ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_website_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_website_ai_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read" ON agent_websites FOR SELECT USING (true);
CREATE POLICY "public_read" ON listings FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON agent_websites FOR ALL USING (true);
CREATE POLICY "service_role_all" ON listings FOR ALL USING (true);
CREATE POLICY "service_role_all" ON promo_codes FOR ALL USING (true);
CREATE POLICY "service_role_all" ON contact_submissions FOR ALL USING (true);
CREATE POLICY "service_role_all" ON agent_website_listings FOR ALL USING (true);
CREATE POLICY "service_role_all" ON agent_website_ai_media FOR ALL USING (true);

INSERT INTO promo_codes (code, type, uses_remaining) VALUES 
  ('OHK-TEST123', 'bundle', 100),
  ('REL8-DEMO', 'bundle', 100);
      `
    }, { status: 400 })
  }
  
  return NextResponse.json({ 
    success: true, 
    message: 'Database is ready',
    websites: websites || []
  })
}
