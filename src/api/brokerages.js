import { KEY, SUPABASE_URL } from '../core/config.js';
import { setCurrentBrand } from '../core/state.js';
import { authHeaders, debug } from '../core/utils.js';
import { fetchJson } from './http.js';

export async function applyBranding(name) {
  const neutralBrand = {
    name: name || '',
    logo_url: null,
    primary_color: '#38bdf8',
    accent_color: '#2563eb',
    bg_color: '#ffffff',
    text_color: '#0f172a',
    font_family: 'Inter',
    button_style: 'rounded'
  };

  if (!name) {
    setCurrentBrand(neutralBrand);
    return neutralBrand;
  }

  try {
    const all = await fetchJson(`${SUPABASE_URL}/rest/v1/brokerages?select=*`, {
      headers: authHeaders(KEY)
    });

    const clean = String(name).toLowerCase().trim();
    const brand = all.find((x) => {
      const brandName = String(x.name || '').toLowerCase().trim();
      if (brandName && clean === brandName) return true;
      if (brandName && clean.includes(brandName)) return true;
      if (Array.isArray(x.match_keywords)) {
        return x.match_keywords.some((k) => clean.includes(String(k || '').toLowerCase().trim()));
      }
      return false;
    });

    const result = brand ? { ...neutralBrand, ...brand, name } : neutralBrand;
    setCurrentBrand(result);
    return result;
  } catch (e) {
    debug('BRANDING LOOKUP FAILED', { message: e?.message || String(e) });
    setCurrentBrand(neutralBrand);
    return neutralBrand;
  }
}
