# Quantex — Complete Design System Specification

This document is written to stand in for the Figma file. Every value here was pulled directly from the working HTML mockups and the design tokens already set up in Figma (12 color variables, 10 text styles) — nothing here is approximated. A developer or Claude Code should be able to implement any screen pixel-accurately from this document alone.

---

## 1. Design Tokens (copy-paste ready)

```css
:root {
  /* Color — Cream */
  --cream-base:  #F6F1E6;
  --cream-deep:  #EEE6D3;
  --cream-line:  #E0D5BE;

  /* Color — Teal */
  --teal-base:   #0E6B62;
  --teal-deep:   #0A4A44;
  --teal-sage:   #8FAFA4;
  --teal-pale:   #DCE8E3;

  /* Color — Ink (text) */
  --ink-base:    #2A2620;
  --ink-soft:    #6B6357;

  /* Color — Semantic */
  --gain:            #1FA968;
  --gain-on-dark:    #6EEAB0;
  --loss:            #AE5A3E;
  --warning-bg:      #F2E4C8;
  --warning-text:    #8A6A2C;
  --pending-dot:     #C9A15B;

  /* Typography */
  --font-display: 'Space Grotesk', sans-serif;
  --font-body:    'Inter', sans-serif;
  --font-data:    'IBM Plex Mono', monospace;

  /* Corner radius scale */
  --radius-xs:  4px;   /* progress bars, tiny chips */
  --radius-sm:  8px;   /* badges, small icon buttons */
  --radius-md:  12px;  /* buttons, inputs, small cards */
  --radius-lg:  14px;  /* standard cards, list rows */
  --radius-xl:  18px;  /* section containers */
  --radius-2xl: 20px;  /* hero cards */
  --radius-full: 36px; /* phone frame corners (mockup only) */

  /* Spacing scale (base unit 2px, used in these steps) */
  --space-1:  2px;
  --space-2:  4px;
  --space-3:  6px;
  --space-4:  8px;
  --space-5:  10px;
  --space-6:  12px;
  --space-7:  14px;
  --space-8:  16px;
  --space-10: 20px;
  --space-11: 22px;
  --space-16: 32px;
}
```

---

## 2. Logo & Brand Mark

### The mark
A simplified geometric rendering of the Greek letter psi (Ψ) — one continuous bowl stroke plus a stem, drawn as two elements: a rounded/squared bowl path and a vertical stem line.

**Exact construction (72×72 viewBox):**
```
Bowl:  M18 10 V32 Q18 44 36 44 Q54 44 54 32 V10
Stem:  x1=36 y1=10  →  x2=36 y2=62
Stroke width: 7–8px (7 for standalone lockups, 8 for smaller inline/animated uses)
Stroke color: currentColor (typically --teal-base on light, --cream-base or --teal-sage on dark)
Stroke linecap: "square" for the static/brand mark, "round" for the animated version
```

**Clearspace:** minimum clearspace around the mark equals the width of the stem stroke on all sides — don't crowd it against edges or other elements inside that margin.

**Minimum size:** 20px (below this the bowl curve starts to lose legibility as anything other than a blob).

**Backgrounds:** tested and approved on `--cream-base`, `--cream-deep`, `--teal-deep`, and pure white. On dark backgrounds, use `--cream-base` or `--teal-sage` for the stroke, never `--teal-base` (insufficient contrast against `--teal-deep`).

**Don'ts:**
- Don't fill the mark — it is a stroke-only mark, filling it changes its entire character
- Don't skew, rotate, or distort the proportions
- Don't recolor it in `--gain`, `--loss`, or any semantic color — it's brand-only, never used to convey status

### Decision history (why the mark looks like this)

The mark went through two distinct construction attempts before settling:

1. **Original — smooth bowl + stem (current, final).** A single continuous U-shaped bowl curve merging into a vertical stem. Clean, reads well at small sizes, closest to the simplified-geometric brief.
2. **Three-tine fork attempt (tried, reverted).** Redrawn as a literal trident — three separate tines (left curve, straight center, right curve) merging into one stem — closer to how a real Ψ glyph is constructed, and it was tried specifically to allow each tine to animate independently (staggered wave motion). **This was reverted.** The smooth bowl shape was judged the stronger mark on its own merits, and the animation system was redesigned around the original shape instead (see Section 7) rather than keeping the fork purely to serve the animation. Lesson carried forward: don't let a motion requirement dictate a static brand asset — solve the motion problem within the existing shape first.

**Current status: bowl + stem is final.** Any reference to the three-tine fork version elsewhere in older working files is superseded by this document.

### Wordmark
"Quantex" set in Space Grotesk Bold, used alongside the mark in horizontal lockups (mark left, wordmark right, clearspace-width gap between them) or standalone in nav bars where space is tight enough that the mark alone suffices.

---

## 3. Color System — Usage Rules

| Token | Hex | Use for |
|---|---|---|
| `--cream-base` | `#F6F1E6` | App background, phone frame background |
| `--cream-deep` | `#EEE6D3` | Card backgrounds, input fields, secondary buttons, tab bar |
| `--cream-line` | `#E0D5BE` | Borders, dividers, hairlines on light backgrounds |
| `--teal-base` | `#0E6B62` | Primary buttons, active nav states, links, brand mark |
| `--teal-deep` | `#0A4A44` | Hero cards (balance, wallet), headings on dark |
| `--teal-sage` | `#8FAFA4` | Secondary text on dark teal backgrounds, muted icons |
| `--teal-pale` | `#DCE8E3` | Selected states, info banners, leaderboard card background |
| `--ink-base` | `#2A2620` | Primary text, headings |
| `--ink-soft` | `#6B6357` | Secondary text, timestamps, labels, disabled icons |
| `--gain` | `#1FA968` | Positive P&L, up candles, buy fills — **on light backgrounds** |
| `--gain-on-dark` | `#6EEAB0` | Positive P&L, up candles — **on teal-deep backgrounds only** |
| `--loss` | `#AE5A3E` | Negative P&L, down candles, sell fills, error accents |
| `--warning-bg` / `--warning-text` | `#F2E4C8` / `#8A6A2C` | Warning banners, session-cap alerts |
| `--pending-dot` | `#C9A15B` | Pending status indicators (KYC, transactions) |

**Rule:** never use `--gain` on a dark teal background or `--gain-on-dark` on a cream background — contrast fails in both directions. This is the single most common implementation mistake to watch for.

---

## 4. Typography

Three-font system. Load weights: Space Grotesk (Medium, Bold), Inter (Regular, Medium, Semi Bold), IBM Plex Mono (Medium, SemiBold).

| Style name | Font | Weight | Size | Line height | Letter spacing | Use for |
|---|---|---|---|---|---|---|
| Display/Hero | Space Grotesk | Bold | 52px | 1.1 | -0.01em | Landing page hero only |
| Display/H1 | Space Grotesk | Bold | 32px | 1.1 | -0.01em | Screen-level headings, wizard titles |
| Display/H2 | Space Grotesk | Bold | 22px | 1.15 | normal | Section headings ("Active bots", "Assets") |
| Display/H3 | Space Grotesk | Bold | 16–17px | 1.2 | normal | Card titles, screen top-nav titles |
| Body/Semibold | Inter | Semi Bold | 12–13px | 1.4 | normal | Card labels, button text, list item titles |
| Body/Medium | Inter | Medium | 13px | 1.5 | normal | Secondary UI text, greeting text |
| Body/Regular | Inter | Regular | 11.5–13px | 1.5 | normal | Descriptions, body copy |
| Label/Small | Inter | Medium | 10–11px | 1.4 | normal | Sub-labels under titles |
| Data/Figure | IBM Plex Mono | SemiBold | 20–30px | 1.2 | normal | Balance figures, hero numbers |
| Data/Body | IBM Plex Mono | Medium | 12–13px | 1.4 | normal | Prices, P&L values, transaction amounts |
| Data/Small | IBM Plex Mono | Medium | 9.5–10.5px | 1.4 | normal | Timestamps, addresses, meta text |
| Data/Micro | IBM Plex Mono | Medium | 8.5–9px | 1.4 | 0.06–0.08em | Eyebrow labels, tags, status bar, ALL CAPS labels |

**Observed real sizes across mockups** (for precise matching): 8.5, 9, 9.5, 10, 10.5, 11, 12, 12.5, 13, 13.5, 14, 14.5, 16, 18, 19, 22, 24, 26, 27, 30, 32, 52px. Stick to this set — don't invent in-between sizes.

**Letter spacing rule:** any all-caps mono label (section eyebrows, status bar, badge text) gets `letter-spacing: 0.06em` to `0.08em`. Nothing else gets letter-spacing adjustments.

---

## 5. Spacing & Layout

- **Base unit:** 2px. All spacing values are even multiples of 2 (no odd numbers except where noted).
- **Screen content padding:** 20px left/right on all mobile screens.
- **Top padding:** 22px from status bar to first content element.
- **Section spacing:** 16–18px vertical gap between major sections (e.g., "Active bots" section to "Leaderboard" section).
- **Card internal padding:** 12–16px depending on card density (compact list rows: 10–13px; standalone cards: 14–22px).
- **Row gap in lists:** 8–10px between stacked list items when not using individual card borders.
- **Bottom tab bar:** 74px total height (12px top padding + icon/label + 22px bottom padding, accounting for iOS home indicator safe area).

**Phone frame (mockup convention only, not a real device constraint):** 375px width, corner radius 36px, 8px border in `--ink-base`.

---

## 6. Corner Radius Scale — Applied

| Element | Radius |
|---|---|
| Progress bar track/fill, tiny chips | 4px |
| Small icon buttons, badges, status pills | 8px |
| Buttons (primary/secondary), input fields | 12px |
| Standard cards, list rows, bot cards | 14px |
| Section containers, larger cards | 18px |
| Hero cards (balance, wallet) | 20px |

---

## 7. Iconography

- **Style:** line icons only, no fills except status dots and coin glyphs.
- **Stroke weight:** 1.4–2px depending on icon complexity (thinner for detailed icons like Settings, thicker for simple icons like Home/Deposit).
- **viewBox:** always `0 0 24 24` (brand mark uses `0 0 72 72`).
- **Default render size:** 22px (matches bottom nav and menu icon scale).
- **Color:** `currentColor` by default so icons inherit context; disabled/Phase-2 icons render in `--ink-soft`.
- **Full icon set:** see `Icon.jsx` — 30+ icons across Brand, Bottom Nav, Quick Actions, Bot Strategy Types, Menu & Account, System/Chrome, Activity/Fills, Failure/Status glyphs, plus `StatusDot` and `CoinGlyph` as separate filled-shape components.

---

## 8. Motion System

One signature animation — the psi mark self-draws — reused for every "something is happening" state across the app. No generic spinners anywhere.

### The mark, animated
Same bowl + stem construction as Section 2, with `pathLength="1"` added to both elements so `stroke-dasharray`/`stroke-dashoffset` animation math is identical regardless of actual path geometry — this is what makes the technique portable to any future logo tweaks without re-deriving the animation.

### Full CSS implementation
```css
.qx-psi-bowl, .qx-psi-stem {
  stroke-dasharray: 1 1;
}
.qx-psi-drawing .qx-psi-bowl,
.qx-psi-drawing .qx-psi-stem {
  animation: qx-psi-draw 2.4s ease-in-out infinite;
}
.qx-psi-drawing .qx-psi-stem {
  animation-delay: 0.25s; /* stem follows bowl, reads as one continuous pen stroke */
}
@keyframes qx-psi-draw {
  0%   { stroke-dashoffset: 1; }   /* hidden */
  38%  { stroke-dashoffset: 0; }   /* fully drawn */
  70%  { stroke-dashoffset: 0; }   /* hold, complete */
  100% { stroke-dashoffset: -1; }  /* erases onward — loops seamlessly, -1 ≡ 1 */
}
@media (prefers-reduced-motion: reduce) {
  .qx-psi-mark, .qx-psi-mark .qx-psi-bowl, .qx-psi-mark .qx-psi-stem {
    animation: none !important;
    stroke-dashoffset: 0 !important; /* falls back to fully-drawn static mark */
  }
}
```

### SVG markup pattern
```html
<svg viewBox="0 0 72 72" fill="none" stroke="currentColor" class="qx-psi-mark qx-psi-drawing">
  <path class="qx-psi-bowl" pathLength="1"
        d="M18 10 V32 Q18 44 36 44 Q54 44 54 32 V10"
        stroke-width="7" stroke-linecap="round" />
  <line class="qx-psi-stem" pathLength="1"
        x1="36" y1="10" x2="36" y2="62"
        stroke-width="7" stroke-linecap="round" />
</svg>
```
Note the `stroke-linecap` changes from `"square"` (static brand mark, Section 2) to `"round"` (animated mark) — rounded caps read better mid-animation when the stroke is partially drawn.

### Modes — only two, deliberately
- **`static`** — no animation class applied. Used for: nav bars, headers, anywhere the mark is purely branding and not signaling activity.
- **`working`** — the draw cycle above, applied identically everywhere something is loading or processing: pull-to-refresh, bot-thinking indicators ("Analyzing market conditions…"), full-screen loading states, inline "processing" badges.

### Decision history (why there's no rotation variant)
A `refresh` mode was built and shipped for one iteration — the working draw cycle plus a full 360° rotation layered on top, specifically to make pull-to-refresh feel distinct from bot-thinking. **This was explicitly removed** on direct instruction: "remove the rotation animations we'll use the draw for everything." The reasoning that held up: one consistent motion across the whole app builds a stronger, more recognizable "system heartbeat" than context-specific variants do, even at the cost of refresh and thinking states looking identical. If a future need arises to visually distinguish them again, don't reach for rotation by default — that path was tried and rejected once already.

### Component reference
`AnimatedPsi.jsx` implements exactly the above as `<AnimatedPsi mode="static" />` / `<AnimatedPsi mode="working" size={28} color="var(--teal-deep)" />`.

---

## 9. Core Components — Full Specs

### Button — Primary
- Background: `--teal-base`
- Text: `--cream-base`, Inter Semi Bold, 12.5–13px
- Padding: 13–14px vertical, full-width or content-width horizontal
- Corner radius: 12px
- No border

### Button — Secondary
- Background: `--cream-deep`
- Border: 1px `--cream-line`
- Text: `--ink-base`, Inter Semi Bold, 12.5–13px
- Padding: 13–14px vertical
- Corner radius: 12px

### Card — Standard (list row)
- Background: `--cream-deep`
- Border: 1px `--cream-line`
- Corner radius: 14px
- Padding: 10–13px vertical, 14–16px horizontal
- Internal layout: flex row, space-between, center-aligned

### Card — Hero (balance/wallet)
- Background: `--teal-deep`
- Corner radius: 20px
- Padding: 22px
- Label text: Data/Micro, `--teal-sage`, 8% letter-spacing
- Figure text: Data/Figure, `--cream-base`, 26–30px

### Card — Selected/highlighted (e.g. chosen strategy)
- Background: `--teal-pale`
- Border: 1.5px `--teal-base`
- Corner radius: 14px

### Status Badge
- Padding: 2px vertical, 7px horizontal
- Corner radius: 8px
- Text: Data/Micro, SemiBold, 8.5px
- Colors: completed = teal-pale bg / teal-deep text; pending = warning-bg / warning-text

### Status Dot
- Size: 8px circle
- Colors: live/running = `--gain`; paused = `--ink-soft`; pending = `--pending-dot`; failed = `--loss`

### Input Field
- Background: `--cream-deep`
- Border: 1px `--cream-line`
- Corner radius: 10px
- Padding: 13px vertical, 14px horizontal
- Text: Inter Regular, 13px

### Bottom Tab Bar
- Height: 74px total (12px top padding, 22px bottom padding for safe area)
- Background: `--cream-deep`
- 5 items, evenly distributed (space-between)
- Active label: `--teal-base`; inactive: `--ink-soft`
- Label: Data/Micro, 8.5px

### Top Nav
- Height: content-driven, ~40–50px
- Back chevron: Inter Medium, 16px, `--ink-base`
- Title: Display/H3, 17px
- Space-between layout when title + trailing icon both present

### Toast / Non-blocking Error
- Background: `--cream-deep`
- Border: 1px `--cream-line`, left border 3px `--loss` (or `--pending-dot` for warnings)
- Corner radius: 10px
- Padding: 10–12px

### Gate Card (blocking-requirement screens — new, added with the insufficient-balance gate)
A reusable pattern for "you can't proceed until X" screens — first built for the bot-creation balance gate, but the shape generalizes to any blocking requirement (e.g. a future KYC-required gate).
- **Icon wrap:** 56px square, `--radius-lg` (14–16px), background `--warning-bg`, centered icon in `--warning-text`
- **Title:** Display/H3, 19px, states the requirement plainly ("You need $50 available to create a bot" — not vague, states the actual number)
- **Body:** Body/Regular, `--ink-soft`, one short paragraph explaining *why*, not just *that*
- **Comparison card:** `--cream-deep` background, `--cream-line` border, `radius-lg` (14px) — a stack of label/value rows (current state vs. requirement), with the final row visually separated (top border, bolder weight) showing the actual gap/shortfall as the takeaway number
- **Reassurance line:** Data/Micro or Body/Regular in `--ink-soft`, explicitly stating that whatever the user already has remains valid and unaffected — this mirrors the funds-safety reassurance principle from the Failure States pattern (Section 10) and should be treated as equally non-optional here
- **Action row:** secondary ("Not now" / dismiss) + primary (the actual unblocking action — "Deposit more", "Verify identity", etc.), same Button specs as elsewhere

---

## 10. Screen Layout Specs

Every screen follows the same structural skeleton: **Status Bar → Top Nav → Content sections (16–18px gap) → optional fixed Bottom Tab Bar.**

### Home
1. Status bar (9:41 / QUANTEX)
2. Top nav: greeting text (left) + notification bell (right, 30px circle)
3. Balance hero card: label → figure → candlestick chart (12 candles, ~60px tall) → P&L line
4. Quick actions row: 3 equal-width pill buttons (Deposit / Withdraw / New bot)
5. "Active bots" label + stacked bot cards (name + sub-label left, P&L right, colored by gain/loss)
6. "Leaderboard" label + single trader card (avatar circle, name + stats left, return % right)
7. "News" label + stacked news cards (tag → title → meta)
8. Fixed bottom tab bar

### Bot Creation Wizard (gate + 4 steps)
**Step 0 — balance gate (shown *instead of* Step 1 when available balance < $50, not part of the numbered sequence):**
1. Status bar, top nav with back chevron only (no step counter — this isn't step "0 of 4" in the user's eyes, it's a precondition check)
2. Uses the **Gate Card** pattern (Section 9) in full: warning icon → title stating the exact requirement → body explaining why → comparison card (available balance / minimum required / shortfall) → reassurance line → secondary+primary action row
3. If balance clears $50, this screen simply never appears — the wizard opens directly on Step 1

**Steps 1–4 (unchanged, numbered sequence):**
1. Status bar
2. Top nav: back chevron + "STEP X / 4" label (right-aligned, mono, letter-spaced) — numbering starts at 1 even though Step 0 may have preceded it
3. Progress bar: 4px track in `--cream-line`, filled portion in `--teal-base`, width = step/4
4. Step title (Display/H1, 20px)
5. Step content (varies): Step 1 = pair search + list; Step 2 = strategy option cards (stacked, selected state highlighted); Step 3 = config sliders/inputs; Step 4 = review summary
6. Action row: Back (secondary button) + Continue/Deploy (primary button), 8px gap, equal width
7. Step 4 specifically must reflect the actual custodial revenue model — a flat bot creation fee shown in the summary, **never** performance-fee language ("% of profit") and **never** language implying funds move into a smart contract. Funds move from Quantex balance into the bot's internal allocation; say so plainly.

### Wallet
1. Status bar
2. Top nav: back + "Wallet" title (left) + more-dots icon (right)
3. Wallet hero card (teal-deep, 20px radius): label → figure → 3 action buttons row (Deposit/Withdraw/History — semi-transparent white overlay pills at 12% opacity, NOT `--cream-deep`, since they sit on a dark background)
4. KYC status strip: dot + text (left) + "CHECK STATUS" link (right), single row card
5. "Assets" label + stacked asset rows (coin glyph + name/sub left, balance/USD-value right)
6. "Recent activity" label + stacked transaction rows (icon + title/sub left, amount + status badge right)

### Failure States (pattern, applies to all 12 variants)
- Inline validation: red-bordered input + small error text below, no full-screen takeover
- Full-screen failure: centered icon (26px circle, colored by severity) → title (Display/H3) → body text (Body/Regular, `--ink-soft`) → primary action + secondary/dismiss action
- **Every failure state includes an explicit funds-safety reassurance line** — this is a deliberate trust mechanic, not optional copy
- Toast errors: bottom-anchored, auto-dismiss, left accent border by severity

---

## 11. Responsive Rules (from Landing Page — apply this pattern to all screens)

Breakpoint: **860px**.

- Multi-column layouts (hero grid, feature grid) collapse to single column below 860px
- Navigation links hide below 860px (leave logo + primary CTA only — needs a hamburger menu treatment when built for real)
- Headline sizes step down: Display/Hero 52px → 32px (→27px under 380px for small phones)
- All padding steps down: 48px → 20px on mobile
- CTAs go from side-by-side to stacked, full-width
- **This breakpoint pattern has only been applied to the landing page.** Every in-app screen (Home, Wallet, Bot Creation, etc.) has so far only been designed at fixed 375px phone width — desktop-width versions of the in-app screens are a known gap, not yet specified.

---

## 12. Known Gaps (carry forward honestly)

Not yet specified in this document or built anywhere:
- Desktop-width layouts for in-app screens (everything except landing page is phone-width only)
- Settings screen content
- Notifications screen content
- Search results screen
- Individual trader/bot profile page
- Formal shadow/elevation scale (mockups use borders, not shadows, for card separation — worth deciding if shadows are ever needed)

**A QA lesson worth carrying forward, not just a gap:** `quantex-bot-creation.html` was found to have an unclosed `<style>` tag and six classes (`.action-row`, `.action-btn`, `.action-primary/secondary`, `.config-row/key/val`, `.section-label`) referenced throughout the markup but never actually defined — meaning every button and config row in that file had likely been rendering unstyled since it was first built. It went unnoticed because the *content* was correct and the layout looked plausible in isolation; only a close read of the CSS caught it. This is now fixed and the classes match the specs in Section 9 exactly, but it's worth treating as a standing reminder: when building or reviewing any new screen, verify referenced classes actually resolve to real CSS, not just that the visual output looks reasonable.

---

## 13. How to Use This Document

For Claude Code: reference this file alongside the individual HTML mockups (which remain the pixel-source for anything not covered here) and `Icon.jsx` / `AnimatedPsi.jsx` for components. This document defines the *system* — the mockups define specific *screen compositions* built from that system. When building a new screen not yet mocked up, derive it from Section 9's structural pattern and Section 8's component specs rather than inventing new spacing or color values.
