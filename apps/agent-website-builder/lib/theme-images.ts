// Theme-matched hero images for each color scheme
export const THEME_HERO_IMAGES: Record<string, string> = {
  'warm-earth': '/images/hero-warm-earth.png',
  'ocean-blue': '/images/hero-ocean-blue.png',
  'forest-green': '/images/hero-forest-green.png',
  'charcoal': '/images/hero-charcoal.png',
  'burgundy': '/images/hero-burgundy.png',
  'midnight': '/images/hero-midnight.png',
}

// Get hero image based on color scheme or brokerage theme
export function getHeroImageForTheme(colorScheme: string, primaryColor?: string | null): string {
  // Check if it's a REL8TION brokerage (starts with 'rel8tion-')
  if (colorScheme.startsWith('rel8tion-')) {
    const mappedTheme = mapColorToTheme(primaryColor || '')
    return THEME_HERO_IMAGES[mappedTheme] || THEME_HERO_IMAGES['warm-earth']
  }
  
  return THEME_HERO_IMAGES[colorScheme] || THEME_HERO_IMAGES['warm-earth']
}

// Map brokerage primary colors to best-matching theme
export function mapColorToTheme(primaryColor: string): string {
  if (!primaryColor) return 'warm-earth'
  
  const color = primaryColor.toLowerCase()
  
  // Blue tones -> ocean/beach
  if (color.includes('1e3a5f') || color.includes('4a90c2') || color.includes('blue') || 
      color.includes('0066') || color.includes('003')) {
    return 'ocean-blue'
  }
  
  // Green tones -> forest/mountain
  if (color.includes('2d4a3e') || color.includes('5b8a72') || color.includes('green') ||
      color.includes('006633') || color.includes('228b22')) {
    return 'forest-green'
  }
  
  // Dark/black tones -> urban/modern
  if (color.includes('2c2c2c') || color.includes('1a1a') || color.includes('000') ||
      color.includes('333') || color.includes('222')) {
    return 'charcoal'
  }
  
  // Red/burgundy tones -> classic/elegant
  if (color.includes('722f37') || color.includes('a94452') || color.includes('800') ||
      color.includes('burgundy') || color.includes('maroon')) {
    return 'burgundy'
  }
  
  // Purple/dark blue tones -> nighttime luxury
  if (color.includes('1a1a2e') || color.includes('4a4a6a') || color.includes('navy') ||
      color.includes('191970') || color.includes('000080')) {
    return 'midnight'
  }
  
  // Default to warm earth tones (brown, tan, gold, etc.)
  return 'warm-earth'
}
