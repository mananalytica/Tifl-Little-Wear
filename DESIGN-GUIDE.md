# Tifl Little Wear — Design Guide

This is the actual design system already built into `styles.css`. Keep any
new page or section within this guide so the site stays consistent as it
grows. Everything below is pulled directly from the live CSS variables —
nothing here is aspirational, it's what's already running.

---

## 1. Brand direction

Clean, green/white, Upwork-inspired — trustworthy and modern rather than
"boutique craft." The one deliberate signature motif carried over from the
brand's tailoring identity is the **dashed stitch-line divider** (`.seam`),
used instead of a plain `<hr>` wherever sections need separating. Don't
introduce a second unrelated motif — extend this one instead.

---

## 2. Colour tokens

All defined in `styles.css` under `:root`. Always use the variable, never a
hardcoded hex, so a future palette tweak only needs one edit.

| Variable | Value | Use |
|---|---|---|
| `--bg` | `#FFFFFF` | Page background |
| `--bg-alt` | `#F3FAF3` | Card/section surfaces (soft mint-white) |
| `--bg-dark` | `#0F2B1B` | Contrast sections (deep pine) — featured review card, confirmation cards |
| `--bg-dark-2` | `#0B2115` | Slightly darker variant, rarely used |
| `--ink` | `#16201A` | Primary text |
| `--ink-soft` | `#5C6B61` | Secondary/muted text |
| `--ink-on-dark` | `#F1F7F2` | Text on dark backgrounds |
| `--ink-on-dark-soft` | `#9FB6A7` | Muted text on dark backgrounds |
| `--primary` | `#108A00` | Brand green — buttons, links, active states |
| `--primary-dark` | `#0C6B00` | Hover state for primary green |
| `--primary-light` | `#E3F5DE` | Light green chip/badge backgrounds |
| `--star` | `#E3A008` | Rating stars only — don't use elsewhere |
| `--line` | `#E1E9E2` | Borders, dividers on light backgrounds |
| `--line-dark` | `#23402F` | Borders, dividers on dark backgrounds |

**Rule of thumb:** white/mint backgrounds + green accents for 95% of the
site. Dark pine sections are the exception, used only to make one element
per page stand out (a featured review, a confirmation card) — never as a
whole-page background.

---

## 3. Typography

Loaded via Google Fonts in every page `<head>`:
```html
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
```

| Font | Role | Where |
|---|---|---|
| **Sora** (600–800) | Headings (`h1`–`h4`) | Bold, geometric, does the "brand voice" work |
| **Inter** (400–700) | Body text, buttons, forms | Default `body` font |
| **IBM Plex Mono** (400–500) | Data & functional text | Prices, measurements, dates, order numbers, step numbers, eyebrow labels |

The mono font is a deliberate functional signal — anywhere a number matters
(a price, a measurement, a booking reference), it's in IBM Plex Mono, not
Inter. Keep that pattern for anything new (e.g. don't put an order total in
Inter).

**Eyebrow label** pattern (small caps mono label above a heading):
```html
<div class="eyebrow">Section label</div>
```

---

## 4. Layout

- Max content width: `1180px` (`--maxw`), via the `.wrap` class
- Border radius: `14px` standard (`--radius`), `8px` for small elements like
  inputs/chips (`--radius-sm`)
- Buttons are pill-shaped (`border-radius: 999px`), never square
- Card surfaces use `--bg-alt` with a `1px solid var(--line)` border, not
  shadows, as the primary way to separate content — shadows (`--shadow`,
  `--shadow-lg`) are reserved for floating elements (drawer, modal, hover
  states), not static cards

---

## 5. Core components (already built, reuse these classes)

- `.btn.btn-primary` / `.btn.btn-ghost` — buttons, plus `.btn-sm` and
  `.btn-block` modifiers
- `.eyebrow` — small mono label above a heading
- `.seam` — dashed stitch-line divider (the signature motif)
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
links, the cart badge, and the WhatsApp button consistent automatically.

---

## 6. Site-wide settings — keep this the single source of truth

At the top of `script.js`:
```js
const CONFIG = {
  phone: '+92 42 1234 5678',
  phoneHref: 'tel:+924212345678',
  whatsappNumber: '924212345678',
  email: 'studio@tiflwear.pk',
  address: 'Tifl Little Wear, MM Alam Road area, Gulberg III, Lahore, Pakistan.',
  hours: 'Open Tue–Sun, 11am – 8pm.',
  currency: 'PKR'
};
```
Change contact details **here only**. Any element tagged `data-config="phone"`
(etc.) auto-fills from this on page load, and the WhatsApp button always
pulls from `CONFIG.whatsappNumber`. Not every page has every field wired to
`data-config` yet (some footers are still hardcoded) — when you touch a
page, prefer converting its contact info to `data-config` tags instead of
typing the number by hand, so it stays in this system.

---

## 7. Responsive rules

Breakpoints: `980px` (tablet/nav collapse) and `560px` (small mobile). Any
new multi-column grid should collapse to a single column (or two, for
product-style grids) inside the existing `@media (max-width: 980px)` and
`@media (max-width: 560px)` blocks at the bottom of `styles.css` — add your
selector there rather than writing a new media query elsewhere.

---

## 8. What NOT to do

- Don't hardcode colours — use the CSS variables
- Don't introduce a second display font — Sora is the only headline font
- Don't add drop shadows to static cards — borders only
- Don't build a new page without copying the existing header/nav/footer
- Don't put numeric/data content in Inter — use IBM Plex Mono
