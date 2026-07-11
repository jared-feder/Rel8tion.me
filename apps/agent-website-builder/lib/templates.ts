// Template configuration options for agent sites

export interface ColorScheme {
  id: string
  name: string
  primary: string
  accent: string
  background: string
  foreground: string
  preview: string // Tailwind class for preview
}

export const COLOR_SCHEMES: ColorScheme[] = [
  {
    id: 'warm-earth',
    name: 'Warm Earth',
    primary: 'oklch(0.35 0.06 50)',
    accent: 'oklch(0.55 0.12 45)',
    background: 'oklch(0.99 0.002 90)',
    foreground: 'oklch(0.15 0.01 60)',
    preview: 'bg-amber-800',
  },
  {
    id: 'ocean-blue',
    name: 'Ocean Blue',
    primary: 'oklch(0.35 0.08 240)',
    accent: 'oklch(0.55 0.15 220)',
    background: 'oklch(0.99 0.002 220)',
    foreground: 'oklch(0.15 0.02 240)',
    preview: 'bg-blue-800',
  },
  {
    id: 'forest-green',
    name: 'Forest Green',
    primary: 'oklch(0.35 0.08 150)',
    accent: 'oklch(0.50 0.12 145)',
    background: 'oklch(0.99 0.005 150)',
    foreground: 'oklch(0.15 0.02 150)',
    preview: 'bg-emerald-800',
  },
  {
    id: 'charcoal',
    name: 'Charcoal',
    primary: 'oklch(0.25 0.01 260)',
    accent: 'oklch(0.45 0.02 260)',
    background: 'oklch(0.99 0.001 260)',
    foreground: 'oklch(0.12 0.01 260)',
    preview: 'bg-slate-800',
  },
  {
    id: 'burgundy',
    name: 'Burgundy',
    primary: 'oklch(0.35 0.12 15)',
    accent: 'oklch(0.50 0.15 20)',
    background: 'oklch(0.99 0.003 15)',
    foreground: 'oklch(0.15 0.02 15)',
    preview: 'bg-red-900',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    primary: 'oklch(0.25 0.05 270)',
    accent: 'oklch(0.55 0.18 280)',
    background: 'oklch(0.99 0.002 270)',
    foreground: 'oklch(0.12 0.02 270)',
    preview: 'bg-indigo-900',
  },
]

export interface FontPairing {
  id: string
  name: string
  headingFont: string
  bodyFont: string
  headingClass: string
  bodyClass: string
}

export const FONT_PAIRINGS: FontPairing[] = [
  {
    id: 'classic-elegant',
    name: 'Classic Elegant',
    headingFont: 'Playfair Display',
    bodyFont: 'Inter',
    headingClass: 'font-serif',
    bodyClass: 'font-sans',
  },
  {
    id: 'modern-clean',
    name: 'Modern Clean',
    headingFont: 'Inter',
    bodyFont: 'Inter',
    headingClass: 'font-sans',
    bodyClass: 'font-sans',
  },
  {
    id: 'bold-statement',
    name: 'Bold Statement',
    headingFont: 'Oswald',
    bodyFont: 'Open Sans',
    headingClass: 'font-display',
    bodyClass: 'font-body',
  },
]

export interface TemplateConfig {
  colorScheme: string
  fontPairing: string
  heroStyle: 'full-image' | 'split' | 'overlay'
  listingLayout: 'grid' | 'carousel' | 'featured'
}

export const DEFAULT_TEMPLATE_CONFIG: TemplateConfig = {
  colorScheme: 'warm-earth',
  fontPairing: 'classic-elegant',
  heroStyle: 'full-image',
  listingLayout: 'grid',
}
