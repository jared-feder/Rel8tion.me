import { fetchRel8tionBrokerages } from '@/lib/rel8tion-api'
import { NextResponse } from 'next/server'

// GET /api/brands - Fetch all available brands (built-in + REL8TION brokerages)
export async function GET() {
  // Built-in color schemes
  const builtInBrands = [
    {
      id: 'warm-earth',
      name: 'Warm Earth',
      primary_color: '#8B7355',
      secondary_color: '#D4C4B0',
      accent_color: '#C4956A',
      source: 'built-in'
    },
    {
      id: 'ocean-blue',
      name: 'Ocean Blue',
      primary_color: '#1E3A5F',
      secondary_color: '#E8F0F8',
      accent_color: '#4A90C2',
      source: 'built-in'
    },
    {
      id: 'forest-green',
      name: 'Forest Green',
      primary_color: '#2D4A3E',
      secondary_color: '#E8F0EC',
      accent_color: '#5B8A72',
      source: 'built-in'
    },
    {
      id: 'charcoal',
      name: 'Charcoal',
      primary_color: '#2C2C2C',
      secondary_color: '#F5F5F5',
      accent_color: '#666666',
      source: 'built-in'
    },
    {
      id: 'burgundy',
      name: 'Burgundy',
      primary_color: '#722F37',
      secondary_color: '#F8F0F1',
      accent_color: '#A94452',
      source: 'built-in'
    },
    {
      id: 'midnight',
      name: 'Midnight',
      primary_color: '#1A1A2E',
      secondary_color: '#EEEEF2',
      accent_color: '#4A4A6A',
      source: 'built-in'
    },
  ]

  // Fetch REL8TION brokerages (brands)
  const rel8tionBrokerages = await fetchRel8tionBrokerages()
  const formattedRel8tionBrands = rel8tionBrokerages
    .filter(b => b.name) // Only include brokerages with a name
    .map(brokerage => ({
      id: `rel8tion-${brokerage.id}`,
      name: brokerage.name,
      primary_color: brokerage.primary_color || '#8B7355',
      secondary_color: brokerage.bg_color || '#f5f5f0',
      accent_color: brokerage.accent_color || brokerage.primary_color || '#8B7355',
      text_color: brokerage.text_color || '#1a1a1a',
      logo_url: brokerage.logo_url,
      font_family: brokerage.font_family,
      theme: brokerage.theme,
      source: 'rel8tion'
    }))

  return NextResponse.json({
    brands: [...builtInBrands, ...formattedRel8tionBrands],
    built_in_count: builtInBrands.length,
    rel8tion_count: formattedRel8tionBrands.length
  })
}
