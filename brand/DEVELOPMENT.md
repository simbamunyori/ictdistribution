# ICT Distribution Africa: brand rules for development

Read this file before building any screen, email, PDF or page for ICT Distribution Africa. The visual guide is `BRAND.md` and `brand-preview.png`. This file says how to apply it in code.

## Setup (milestone 1)
1. Copy this whole folder into the repository as `brand/`.
2. Import `brand/tokens/tokens.css` once in the root layout (for Next.js: `app/globals.css` with `@import "../brand/tokens/tokens.css";`).
3. Tailwind: add `presets: [require('./brand/tokens/tailwind.preset.js')]` to the Tailwind config. Use only the semantic classes (`bg-bg`, `bg-surface`, `text-text`, `text-text-muted`, `bg-brand`, `text-on-brand`, `border-border`, `ring-focus` and so on). Never hard-code hex values in components.
4. Fonts: load Inter, Inter Display (or Inter with `font-optical-sizing`) and JetBrains Mono with `next/font`, self-hosted, and assign them to `--font-text`, `--font-display` and `--font-mono`.
5. Icons and favicons: `png/favicon-16.png`, `png/favicon-32.png`, `app-icon/ictdistribution-favicon.svg`, `png/app-icon-180.png` (apple-touch-icon), `png/app-icon-192.png` and `png/app-icon-512.png` (web manifest). Copy them into `public/` in milestone 1.
6. Logos: use the SVGs in `logo/` as files or inline components. Ink versions on light backgrounds, white versions on dark. Switch automatically with the theme.

## Theme
- Light and dark from day one. Default follows the visitor's system setting; a toggle sets `data-theme="light"` or `"dark"` on `<html>` and remembers the choice.
- Every colour comes from the semantic tokens. If a new one is needed, add it to `tokens.css` for both modes rather than in a component.

## Rules specific to ICT Distribution Africa
- Primary buttons (Add to cart, Request quote, Checkout): Amber fill with Ink text (9:1). Amber is never used for text on white; use brand-text.
- Cobalt is for links, focus rings and secondary actions. Specials and countdowns use Amber, not red.
- Prices are the most important number on any product screen: JetBrains Mono or Inter with tabular figures, Ink, bold, currency code in muted text.
- Never show supplier names, supplier prices or sourcing channels in any customer-facing component.

## Type scale
- Display headings: `font-display`, weight 600 to 700, tracking `-0.02em`. Hero 48 to 64 px on desktop, 36 px on phone.
- Body: Inter 16 px, line height 1.6; interface text 14 px; small print 12 px minimum.
- Numbers in tables, prices and invoices: tabular figures (`font-variant-numeric: tabular-nums`).

## Layout and quality bar
- Phone first. Every page works at 360 px wide with no horizontal scroll, then scales up.
- 8 px spacing grid. Corner radius from the tokens (buttons `md`, cards `lg`).
- Visible focus ring on every interactive element (`ring-2 ring-focus`), keyboard navigable, WCAG 2.2 AA contrast. The checked pairs are below.
- Lighthouse 90+ for performance and accessibility on the marketing site.

## Copy
Plain, confident, short. No exclamation marks, no em dashes, no jargon. Tagline: "The right technology, sourced and delivered."

## Emails, PDFs and invoices
Use the Ink lockup on white, Ink text, brand colour only for one rule line or header band, and the same fonts with safe fallbacks (Arial, Helvetica).

## Checked contrast pairs
| Mode | Pair | Ratio |
| --- | --- | --- |
| light | `text` on `bg` | 18.92:1 |
| light | `text-muted` on `bg` | 5.83:1 |
| light | `text-muted` on `surface` | 5.29:1 |
| light | `on-brand` on `brand` | 9.03:1 |
| light | `on-accent` on `accent` | 5.65:1 |
| light | `brand-text` on `bg` | 7.06:1 |
| light | `accent-text` on `bg` | 5.65:1 |
| light | `danger` on `bg` | 6.57:1 |
| dark | `text` on `bg` | 16.02:1 |
| dark | `text-muted` on `bg` | 7.49:1 |
| dark | `text-muted` on `surface` | 6.85:1 |
| dark | `on-brand` on `brand` | 9.03:1 |
| dark | `on-accent` on `accent` | 6.17:1 |
| dark | `brand-text` on `bg` | 9.03:1 |
| dark | `accent-text` on `bg` | 6.17:1 |
| dark | `danger` on `bg` | 7.45:1 |
