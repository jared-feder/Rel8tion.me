# REL8TION report assets

The logo is the existing app logo from `src/core/config.js`:
https://rel8tion.me/wp-content/uploads/2026/04/logo150x100trans.png

Palette and type families follow `apps/rel8tion-app/admin.html`: sky #38bdf8,
blue #2563eb, navy #1f2a5a, ink #17224f and paper #f0f7ff; Inter body text
and Plus Jakarta Sans display text. The logo is preserved without alteration.

Fonts are static instances of the Google Fonts upstream variable files:
- https://github.com/google/fonts/tree/main/ofl/inter (400/700, optical size 14)
- https://github.com/google/fonts/tree/main/ofl/plusjakartasans (800)

Both font families are distributed under their included SIL Open Font Licenses.
The PDF embeds Inter in full to preserve composite glyphs and subsets the display
font; email uses the same family names with system fallbacks.
Vercel explicitly bundles these assets for the two outreach report functions.
