# Tifl Little Wear — Design Guide

This is the actual design system built into `styles.css`, updated to match
the official logo (sky-blue bubble wordmark + smiling cloud mascot). Keep
any new page or section within this guide so the site stays consistent as
it grows. Everything below is pulled directly from the live CSS variables —
nothing here is aspirational, it's what's already running.

---

## 1. Brand direction

Warm, playful, trustworthy — a children's brand first, a boutique second.
The palette and type now follow the logo directly: sky blue, a soft cloud
white, a blush-pink accent used sparingly (the mascot's cheeks), and a
rounded, friendly display typeface that echoes the bubble lettering in the
wordmark. The site should read as approachable to parents and genuinely
kid-friendly, not corporate.

The dashed stitch-line divider (`.seam`) from the tailoring identity is
kept as the signature structural motif — it still ties every page back to
"a studio that actually stitches things by hand," which the logo alone
doesn't communicate. Don't drop it when building new sections.

---

## 2. Logo usage

The logo file lives at `assets/logo.png` (source: the official artwork,
square canvas, transparent-safe on white).

- **Header:** use the logo image itself as the brand mark — it already
  contains both "tifl" and "little wear," so don't also set a separate
  text wordmark next to it. A small "· Lahore" location tag is fine
  alongside it in muted text.
- **Footer:** same logo image, slightly smaller.
- **Minimum size:** don't render the logo below ~28px tall — the cloud
  mascot's face stops reading at small sizes.
- **Clear space:** leave at least the height of the cloud around all sides.
- **Never** recolor the logo, place it on a busy background, or stretch it
  off its square aspect ratio.

---

## 3. Colour tokens

All defined in `styles.css` under `:root`. Always use the variable, never a
hardcoded hex, so a future palette tweak only needs one edit.

| Variable | Value | Use |
|---|---|---|
| `--bg` | `#FFFFFF` | Page background |
| `--bg-alt` | `#F2F8FE` | Card/section surfaces (pale sky tint) |
| `--bg-dark` | `#16233B` | Contrast sections (night-sky navy) — featured review card, confirmation cards |
| `--bg-dark-2` | `#101B2E` | Slightly darker variant, rarely used |
| `--ink` | `#1F2A3D` | Primary text (matches the mascot's eye navy) |
| `--ink-soft` | `#5C6B85` | Secondary/muted text |
| `--ink-on-dark` | `#F1F6FD` | Text on dark backgrounds |
| `--ink-on-dark-soft` | `#9FB1CC` | Muted text on dark backgrounds |
| `--primary` | `#4A93E8` | Brand sky blue — buttons, links, active states, sampled directly from the logo |
| `--primary-dark` | `#3576C9` | Hover state for primary blue |
| `--primary-light` | `#E6F1FD` | Light blue chip/badge backgrounds |
| `--accent-pink` | `#F7C6C2` | The mascot's blush — sparingly, for warmth (sale badges, small highlights). Never as a primary colour. |
| `--star` | `#E3A008` | Rating stars only — don't use elsewhere |
| `--line` | `#E1E8F2` | Borders, dividers on light backgrounds |
| `--line-dark` | `#233553` | Borders, dividers on dark backgrounds |

**Rule of thumb:** white/pale-sky backgrounds + brand blue for 95% of the
site. Night-navy dark sections are the exception, used only to make one
element per page stand out. Blush pink is a seasoning, not a base colour —
if a whole section is turning pink, pull back.

---

## 4. Typography

Loaded via Google Fonts in every page `<head>`:
```html
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
```

| Font | Role | Where |
|---|---|---|
| **Fredoka** (500–700) | Headings (`h1`–`h4`) | Rounded, bubbly — deliberately echoes the logo's lettering |
| **Inter** (400–700) | Body text, buttons, forms | Default `body` font — kept clean and readable so playful headlines don't tip into hard-to-read |
| **IBM Plex Mono** (400–500) | Data & functional text | Prices, measurements, dates, order numbers, step numbers, eyebrow labels |

The mono font is a deliberate functional signal, unrelated to the rebrand —
anywhere a number matters (price, measurement, booking reference), it's in
IBM Plex Mono, not Inter. Keep that pattern for anything new.

**Eyebrow label** pattern (small caps mono label above a heading):
```html
<div class="eyebrow">Section label</div>
```

---

## 5. Layout

- Max content width: `1180px` (`--maxw`), via the `.wrap` class
- Border radius: `14px` standard (`--radius`), `8px` for small elements like
  inputs/chips (`--radius-sm`) — kept generous and rounded to match the
  logo's soft, bubbly shapes
- Buttons are pill-shaped (`border-radius: 999px`), never square
- Card surfaces use `--bg-alt` with a `1px solid var(--line)` border, not
  shadows, as the primary way to separate content — shadows (`--shadow`,
  `--shadow-lg`) are reserved for floating elements (drawer, modal, hover
  states), not static cards

---

## 6. Core components (already built, reuse these classes)

- `.btn.btn-primary` / `.btn.btn-ghost` — buttons, plus `.btn-sm` and
  `.btn-block` modifiers
- `.eyebrow` — small mono label above a heading
- `.seam` — dashed stitch-line divider (the tailoring signature motif)
- `.side-card` — bordered info card (used in Booking sidebar, Contact info)
- `.p-card` / `.p-thumb` / `.p-info` — product card, shop grid and related
  products
- `.review-card` / `.review-card.featured` — testimonial cards
- `.faq-item` — FAQ accordion-style block (Measurements page)
- `.blog-card` — blog listing card
- `.article-body` — long-form content wrapper for blog posts (max-width
  720px, 16.5px body text, generous line-height)
- `.whatsapp-float` — the floating WhatsApp button, present on every page

**New pages should copy the header/nav/footer markup from an existing page
exactly** (e.g. `contact.html`) rather than rebuilding it — this keeps nav
links, the logo, the cart badge, and the WhatsApp button consistent
automatically.

---

## 7. Decorative colour accents

A few places use a hardcoded hex instead of a CSS variable, since they're
generating variety (product placeholder swatches, review avatar circles)
rather than a single consistent brand colour. These should stay inside the
blue/navy/pink family established above — pull new accent hexes from:
`#4A93E8` (primary blue), `#3576C9` (deep blue), `#8FB7E8` (soft periwinkle),
`#F7C6C2` (blush pink), `#1F2A3D` (navy) — rather than introducing an
unrelated hue.

---

## 8. Site-wide settings — keep this the single source of truth

At the top of `script.js`:
```js
const CONFIG = {
  phone: '+92 305 4110254',
  phoneHref: 'tel:+923054110254',
  whatsappNumber: '923054110254',
  email: 'studio@tifllittlewear.com',
  address: 'Tifl Little Wear, MM Alam Road area, Gulberg III, Lahore, Pakistan.',
  hours: 'Open Tue–Sun, 11am – 8pm.',
  currency: 'PKR'
};
```
Change contact details **here only**. Any element tagged `data-config="phone"`
(etc.) auto-fills from this on page load, and the WhatsApp button always
pulls from `CONFIG.whatsappNumber`.

---

## 9. Responsive rules

Breakpoints: `980px` (tablet/nav collapse) and `560px` (small mobile). Any
new multi-column grid should collapse to a single column (or two, for
product-style grids) inside the existing `@media (max-width: 980px)` and
`@media (max-width: 560px)` blocks at the bottom of `styles.css` — add your
selector there rather than writing a new media query elsewhere.

---

## 10. What NOT to do

- Don't hardcode colours outside the palette in section 3/7 — use the CSS
  variables, or the approved accent hexes for decorative variety
- Don't introduce a second display font — Fredoka is the only headline font
- Don't add drop shadows to static cards — borders only
- Don't build a new page without copying the existing header/nav/footer
- Don't put numeric/data content in Inter — use IBM Plex Mono
- Don't recolor, distort, or shrink the logo below ~28px tall
- Don't let blush pink become a background colour for large areas — it's an
  accent, the base palette is blue/white/navy

