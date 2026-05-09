## Rel8tion Design System Spec V1

Date: `2026-04-22`

This document defines the visual system Rel8tion should keep across:

- homepage
- claim
- `/k`
- Smart Sign activation
- event shell
- admin/dashboard entry views

It is based on the current homepage in [home.html](/c:/Dev/GitHub/Rel8tion.me/home.html:1).

## 1. Visual Identity

Rel8tion should feel:

- bright
- premium
- cinematic
- human
- optimistic
- trustworthy
- active, but not chaotic

It should not feel:

- dark SaaS
- generic startup UI
- heavy corporate enterprise
- flat dashboard software

## 2. Theme Summary

### Core Theme

`Bright cinematic real-estate sky`

### Brand Story

- clouds = openness, movement, atmosphere
- home backdrop = real estate context
- agents in motion = real people, live activity
- glass panels = modern, premium, trust-forward
- hand logo = trust, verification, connection

## 3. Color System

### Primary Text

- `#1f2a5a`

Use for:
- major headings
- nav
- primary buttons
- strong labels

### Base Background

- `#f0f7ff`

### Hero Gradient

- top: `#38bdf8`
- fade into: `#f0f7ff`

Recommended background:

```css
background: linear-gradient(180deg, #38bdf8 0%, #f0f7ff 60%, #f0f7ff 100%);
```

### Supporting Blue

- `#2563eb`

Use for:
- accents
- highlights
- active states
- subtle emphasis

### Hover Navy

- `#161e40`

Use for:
- primary button hover

### Body Text

- slate range around `#475569` to `#64748b`

Use for:
- paragraph copy
- secondary text
- supporting descriptions

### White / Glass Layer

Use translucent white for:
- cards
- overlays
- pills
- secondary buttons

## 4. Typography

### Headline Font

- `Plus Jakarta Sans`

Use for:
- hero headlines
- large section titles
- major callouts

Tone:
- bold
- modern
- high-confidence

### Display / Alternative Headline Font

- `Poppins`

Use for:
- claim page large titles
- activation moments
- focused feature callouts

### Body Font

- `Inter`

Use for:
- paragraphs
- labels
- nav
- UI controls
- forms

## 5. Shape Language

Rel8tion should use:

- oversized radii
- soft premium corners
- rounded pills
- clean friendly geometry

Recommended radius ranges:

- hero cards: `38px` to `44px`
- feature cards: `28px` to `38px`
- buttons: `999px`
- pills: `999px`

## 6. Card Style

### Glass Card

This is a signature pattern.

Use:
- translucent white
- subtle blur
- soft white border
- deep soft shadow

Recommended pattern:

```css
background: rgba(255, 255, 255, 0.15);
backdrop-filter: blur(5px) saturate(160%);
-webkit-backdrop-filter: blur(5px) saturate(160%);
border: 1px solid rgba(255, 255, 255, 0.5);
box-shadow: 0 25px 50px rgba(31, 42, 90, 0.1), inset 0 1px 1px rgba(255, 255, 255, 0.3);
```

### Solid Soft Card

For denser content:

- `bg-white/35` to `bg-white/60`
- white border
- mild shadow

## 7. Button System

### Primary Button

Style:
- dark navy fill
- white text
- pill shape
- strong hover lift

Recommended base:

- background: `#1f2a5a`
- text: `#ffffff`

Hover:
- darker navy
- slight upward movement
- deeper shadow

### Secondary Button

Style:
- frosted white
- navy text
- light border
- soft hover brighten

Use for:
- secondary actions
- lower-pressure CTAs

## 8. Background System

### Hero Background

Must include:
- sky gradient
- moving clouds
- house stage
- fade overlay

### Scene Layer

Use:
- large house image
- center weighted
- fixed positioning for immersive feel

### Motion Layer

Use:
- slow drifting clouds
- slow moving agent cutouts

Motion should feel:
- ambient
- alive
- intentional

Not:
- busy
- flashy
- game-like

## 9. Motion Rules

### Good Motion

- drifting clouds
- slow walking agents
- subtle card hover lift
- gentle progress animation

### Avoid

- snappy micro-animations everywhere
- bouncing UI
- hyperactive scaling
- generic loader spam

Rel8tion motion should feel:
- calm
- premium
- atmospheric

## 10. Imagery Rules

Use imagery that supports:

- real estate
- human presence
- trust
- premium simplicity

Preferred:

- home backdrops
- agents in motion
- product renders
- sign/chip visuals

Avoid:

- random stock SaaS art
- abstract blobs as primary story
- overly dark or moody imagery

## 11. Content Tone Rules In UI

Rel8tion UI copy should feel:

- confident
- clean
- direct
- premium
- helpful

Avoid sounding:

- robotic
- too playful
- cluttered
- over-explained

### Good Examples

- `Show Up. Tap Once. Everything Goes Live.`
- `Protect More Relationships. Save More Deals. Close More Business.`
- `No apps. No sign-in.`

## 12. Page-Specific Guidance

### Homepage

Should feel:
- biggest and most cinematic
- strongest emotional brand statement

### Claim

Should feel:
- magical
- welcoming
- fast
- trustworthy

Keep:
- same sky/glass system
- same branded motion
- tighter focus

### `/k`

Should feel:
- transitional
- fast
- confident
- brand-consistent

### Smart Sign Activation

Should feel:
- premium
- trust-based
- important but easy

### Event Shell

Should feel:
- buyer-friendly
- simpler
- cleaner
- less “operator” feeling

### Dashboard

Should still feel like Rel8tion, but slightly more structured:

- keep colors
- keep typography
- keep card softness
- reduce scene drama slightly
- prioritize clarity and speed

## 13. Design Rules To Preserve

Always preserve:

- sky + cloud identity
- navy + sky-blue palette
- glass card treatment
- oversized radii
- premium CTA treatment
- strong bold headline rhythm

## 14. What Not To Drift Into

Do not drift into:

- generic admin app styling
- plain white enterprise panels everywhere
- purple-on-black startup aesthetic
- default Tailwind-feeling layouts
- flat minimalism with no atmosphere

## 15. Implementation Rule

Any new page in the Vercel app should answer:

1. Does it look like it belongs next to `home.html`?
2. Does it preserve the sky/glass/navy/agent-motion language?
3. Does it feel premium and trust-forward?

If not, it needs revision.
