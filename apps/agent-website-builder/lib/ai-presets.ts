export type AiMediaMode = 'agent_headshot' | 'staging_image' | 'social_video'

export interface AiPreset {
  key: string
  label: string
  prompt: string
  captionExtra?: string
}

export const AI_MEDIA_MODE_OPTIONS: Array<{ key: AiMediaMode; label: string }> = [
  { key: 'agent_headshot', label: 'Headshot' },
  { key: 'staging_image', label: 'Staging' },
  { key: 'social_video', label: 'AutoReel' },
]

export const HEADSHOT_LOOK_PRESETS = [
  {
    key: 'modern_agent',
    label: 'Modern Agent',
    prompt: 'tailored real estate agent look, confident approachable expression, polished business casual wardrobe',
  },
  {
    key: 'luxury_broker',
    label: 'Luxury Broker',
    prompt: 'premium brokerage look, refined blazer styling, calm high-trust expression, editorial but realistic finish',
  },
  {
    key: 'friendly_local',
    label: 'Friendly Local',
    prompt: 'warm neighborhood expert look, relaxed professional wardrobe, natural smile, welcoming real estate tone',
  },
  {
    key: 'clean_linkedin',
    label: 'Clean LinkedIn',
    prompt: 'simple professional headshot look, crisp wardrobe, balanced lighting, clean modern profile-photo finish',
  },
] as const satisfies readonly AiPreset[]

export const HEADSHOT_BACKGROUND_PRESETS = [
  {
    key: 'soft_office',
    label: 'Soft Office',
    prompt: 'softly blurred modern real estate office background with neutral tones and clean light',
  },
  {
    key: 'bright_home',
    label: 'Bright Home',
    prompt: 'bright upscale home interior background with natural window light and tasteful decor',
  },
  {
    key: 'neutral_studio',
    label: 'Neutral Studio',
    prompt: 'neutral studio backdrop with premium portrait lighting and subtle depth',
  },
  {
    key: 'city_blur',
    label: 'City Blur',
    prompt: 'soft city-street background blur with professional natural daylight',
  },
] as const satisfies readonly AiPreset[]

export const STAGING_STYLE_PRESETS = [
  {
    key: 'bright_luxury',
    label: 'Bright Luxury',
    prompt: 'bright luxury listing style with premium neutral furnishings, layered lighting, and high-end finishes',
  },
  {
    key: 'coastal_modern',
    label: 'Coastal Modern',
    prompt: 'coastal modern style with airy textures, pale wood, soft blue accents, and clean furniture lines',
  },
  {
    key: 'warm_neutral',
    label: 'Warm Neutral',
    prompt: 'warm neutral style with comfortable contemporary furniture, organic textures, and inviting layered decor',
  },
  {
    key: 'city_condo',
    label: 'City Condo',
    prompt: 'sleek city condo style with compact luxury furniture, modern art, and polished urban staging',
  },
  {
    key: 'family_suburban',
    label: 'Family Suburban',
    prompt: 'family-friendly suburban style with practical comfortable furniture, bright decor, and a welcoming layout',
  },
] as const satisfies readonly AiPreset[]

export const STAGING_ROOM_PRESETS = [
  { key: 'living_room', label: 'Living Room', prompt: 'living room' },
  { key: 'bedroom', label: 'Bedroom', prompt: 'bedroom' },
  { key: 'kitchen', label: 'Kitchen', prompt: 'kitchen' },
  { key: 'dining_room', label: 'Dining Room', prompt: 'dining room' },
  { key: 'home_office', label: 'Home Office', prompt: 'home office' },
  { key: 'outdoor_patio', label: 'Outdoor Patio', prompt: 'outdoor patio' },
] as const satisfies readonly AiPreset[]

export const AUTO_REEL_POST_PRESETS = [
  {
    key: 'new_listing_teaser',
    label: 'New Listing',
    prompt: 'new listing walkthrough with a strong opening hook, clean address reveal, strongest visual feature callouts, and tour-request ending',
    captionExtra: 'Post-ready new listing walkthrough for short-form social.',
  },
  {
    key: 'open_house_invite',
    label: 'Open House',
    prompt: 'open house invite walkthrough with date-neutral callouts, welcoming pacing, quick property highlights, and visit/tour call to action',
    captionExtra: 'Post-ready open house walkthrough for short-form social.',
  },
  {
    key: 'price_improvement',
    label: 'Price Update',
    prompt: 'price improvement walkthrough with refreshed opportunity framing, tasteful urgency, and buyer-tour call to action',
    captionExtra: 'Post-ready price update walkthrough for short-form social.',
  },
  {
    key: 'just_sold',
    label: 'Just Sold',
    prompt: 'just sold walkthrough and social proof reel with celebratory movement, clean result-oriented pacing, and agent-brand ending',
    captionExtra: 'Post-ready just sold walkthrough for short-form social.',
  },
  {
    key: 'market_moment',
    label: 'Market Moment',
    prompt: 'local market moment walkthrough using the property image as the visual anchor, with polished educational real estate pacing',
    captionExtra: 'Post-ready market moment walkthrough for short-form social.',
  },
] as const satisfies readonly AiPreset[]

export const AUTO_REEL_STYLE_PRESETS = [
  {
    key: 'bright_luxury',
    label: 'Bright Luxury',
    prompt: 'bright luxury social reel, premium editorial color, crisp motion, clean typography',
  },
  {
    key: 'coastal_modern',
    label: 'Coastal Modern',
    prompt: 'coastal modern social reel, airy light, relaxed upscale motion, soft fresh typography',
  },
  {
    key: 'warm_neutral',
    label: 'Warm Neutral',
    prompt: 'warm neutral social reel, cozy premium tones, smooth camera movement, inviting text treatment',
  },
  {
    key: 'city_condo',
    label: 'City Condo',
    prompt: 'city condo social reel, sharper urban rhythm, polished contrast, modern text accents',
  },
  {
    key: 'family_suburban',
    label: 'Family Suburban',
    prompt: 'family suburban social reel, friendly pace, bright practical highlights, approachable typography',
  },
] as const satisfies readonly AiPreset[]

export function isAiMediaMode(value: string): value is AiMediaMode {
  return AI_MEDIA_MODE_OPTIONS.some((option) => option.key === value)
}

export function resolvePreset<T extends readonly AiPreset[]>(
  presets: T,
  key: string,
  fallbackKey?: string,
): T[number] {
  return (
    presets.find((preset) => preset.key === key) ||
    presets.find((preset) => preset.key === fallbackKey) ||
    presets[0]
  )
}
