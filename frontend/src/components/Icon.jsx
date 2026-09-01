// Shared icon set for the app shell (tab bar, top navs, quick actions,
// menu). Follows the same hand-authored-SVG convention AnimatedPsi.jsx
// already established (viewBox 0 0 24 24, stroke-based line art, color
// via a prop rather than a hardcoded value) rather than pulling in an
// icon library — see quantex-design-system-spec_2.md Section 7 for the
// line-art rules this follows (round caps/joins, currentColor by default).
//
// Every glyph below is defined as TWO functions of a single `color`
// argument: `outline` (always required — the default, line-only render)
// and an optional `filled` (a solid-shape render, used by the bottom tab
// bar for its "active tab" state, matching Bybit's dual-state nav icons —
// see the design direction decided for this project's frontend). A glyph
// with no `filled` entry simply reuses `outline` when asked to render
// filled — that's deliberate graceful degradation (a missing filled
// variant never renders blank), not a bug.
//
// Each entry's children set their OWN stroke/fill attributes explicitly
// (rather than relying on inheritance from the <svg>) so outline and
// filled renders of the same icon can freely mix stroked lines and solid
// shapes without fighting each other — see e.g. ICONS.home below, whose
// filled variant is one solid silhouette path while its outline variant
// is three separate stroked line segments.
//
// To add a new icon: add an entry to ICONS below with at minimum an
// `outline(color)` function returning JSX, then reference it anywhere via
// <Icon name="yourNewName" />.

const ICONS = {
  // ── Bottom tab bar (dual-state) ──────────────────────────────────────
  home: {
    outline: (color) => (
      <>
        <path d="M3 11l9-7 9 7" stroke={color} strokeWidth="1.8" fill="none" />
        <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" stroke={color} strokeWidth="1.8" fill="none" />
        <path d="M10 20v-5h4v5" stroke={color} strokeWidth="1.8" fill="none" />
      </>
    ),
    filled: (color) => (
      <path
        d="M12 2.5 2 10.5h2.5V20a1 1 0 0 0 1 1H9v-6h6v6h3.5a1 1 0 0 0 1-1v-9.5H22L12 2.5Z"
        fill={color}
        stroke="none"
      />
    ),
  },
  markets: {
    // Pure closed rects — an unfilled stroked rect already reads as an
    // "outline bar", and the same rects filled solid read as a bar chart,
    // so this one icon works for both variants with no separate filled
    // definition needed (see the module comment above).
    outline: (color) => (
      <>
        <rect x="4" y="12" width="4" height="8" rx="1" stroke={color} strokeWidth="1.6" fill="none" />
        <rect x="10" y="6" width="4" height="14" rx="1" stroke={color} strokeWidth="1.6" fill="none" />
        <rect x="16" y="9" width="4" height="11" rx="1" stroke={color} strokeWidth="1.6" fill="none" />
      </>
    ),
    filled: (color) => (
      <>
        <rect x="4" y="12" width="4" height="8" rx="1" fill={color} stroke="none" />
        <rect x="10" y="6" width="4" height="14" rx="1" fill={color} stroke="none" />
        <rect x="16" y="9" width="4" height="11" rx="1" fill={color} stroke="none" />
      </>
    ),
  },
  trade: {
    // Two candlesticks (wick + body) — distinct from `markets`'s plain
    // bars, and thematically direct: the Trade screen itself shows real
    // candlesticks. Wicks are lines, which set their own stroke
    // explicitly and so render identically in both variants; only the
    // rect bodies differ between outline (stroked, hollow) and filled
    // (solid) — same split `home` already uses for its own mixed
    // line+shape icon.
    outline: (color) => (
      <>
        <line x1="8" y1="4" x2="8" y2="20" stroke={color} strokeWidth="1.6" />
        <rect x="6" y="9" width="4" height="7" rx="1" stroke={color} strokeWidth="1.6" fill="none" />
        <line x1="16" y1="2" x2="16" y2="18" stroke={color} strokeWidth="1.6" />
        <rect x="14" y="6" width="4" height="8" rx="1" stroke={color} strokeWidth="1.6" fill="none" />
      </>
    ),
    filled: (color) => (
      <>
        <line x1="8" y1="4" x2="8" y2="20" stroke={color} strokeWidth="1.6" />
        <rect x="6" y="9" width="4" height="7" rx="1" fill={color} stroke="none" />
        <line x1="16" y1="2" x2="16" y2="18" stroke={color} strokeWidth="1.6" />
        <rect x="14" y="6" width="4" height="8" rx="1" fill={color} stroke="none" />
      </>
    ),
  },
  bots: {
    // 2x2 grid — matches the Grid-strategy glyph reused for the Bots tab.
    outline: (color) => (
      <>
        <rect x="4" y="4" width="7" height="7" rx="1.5" stroke={color} strokeWidth="1.6" fill="none" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" stroke={color} strokeWidth="1.6" fill="none" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" stroke={color} strokeWidth="1.6" fill="none" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" stroke={color} strokeWidth="1.6" fill="none" />
      </>
    ),
    filled: (color) => (
      <>
        <rect x="4" y="4" width="7" height="7" rx="1.5" fill={color} stroke="none" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" fill={color} stroke="none" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" fill={color} stroke="none" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" fill={color} stroke="none" />
      </>
    ),
  },
  wallet: {
    outline: (color) => (
      <>
        <rect x="3" y="6" width="18" height="13" rx="2.5" stroke={color} strokeWidth="1.7" fill="none" />
        <circle cx="16.5" cy="12.5" r="1.3" stroke={color} strokeWidth="1.5" fill="none" />
      </>
    ),
    filled: (color) => (
      <>
        <rect x="3" y="6" width="18" height="13" rx="2.5" fill={color} stroke="none" />
        <circle cx="16.5" cy="12.5" r="1.5" fill="var(--on-accent)" stroke="none" />
      </>
    ),
  },
  menu: {
    // No real "filled hamburger" shape exists — the active state instead
    // just goes bolder (a slightly heavier stroke). Both variants stay
    // stroke-based on purpose.
    outline: (color) => (
      <>
        <line x1="4" y1="7" x2="20" y2="7" stroke={color} strokeWidth="1.8" />
        <line x1="4" y1="12" x2="20" y2="12" stroke={color} strokeWidth="1.8" />
        <line x1="4" y1="17" x2="20" y2="17" stroke={color} strokeWidth="1.8" />
      </>
    ),
    filled: (color) => (
      <>
        <line x1="4" y1="7" x2="20" y2="7" stroke={color} strokeWidth="2.6" />
        <line x1="4" y1="12" x2="20" y2="12" stroke={color} strokeWidth="2.6" />
        <line x1="4" y1="17" x2="20" y2="17" stroke={color} strokeWidth="2.6" />
      </>
    ),
  },

  // ── Quick actions (Home) ─────────────────────────────────────────────
  deposit: {
    outline: (color) => (
      <>
        <path d="M12 3v12" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M7 10l5 5 5-5" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 19h16" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
  },
  withdraw: {
    outline: (color) => (
      <>
        <path d="M12 21V9" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M7 14l5-5 5 5" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 5h16" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
  },
  newBot: {
    outline: (color) => (
      <>
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" fill="none" />
        <path d="M12 8v8" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M8 12h8" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
  },

  // ── System / chrome ──────────────────────────────────────────────────
  bell: {
    outline: (color) => (
      <>
        <path
          d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10Z"
          stroke={color}
          strokeWidth="1.7"
          fill="none"
          strokeLinejoin="round"
        />
        <path d="M10 19a2 2 0 0 0 4 0" stroke={color} strokeWidth="1.7" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  chevronLeft: {
    outline: (color) => <path d="M15 5l-7 7 7 7" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  },
  chevronRight: {
    outline: (color) => <path d="M9 5l7 7-7 7" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  },
  // Used by SelectField.jsx's collapsed trigger button (coin/network
  // dropdown pickers) — a downward chevron indicating "tap to open a list
  // of choices", the same role a native <select>'s arrow plays.
  chevronDown: {
    outline: (color) => <path d="M5 9l7 7 7-7" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  },
  moreDots: {
    outline: (color) => (
      <>
        <circle cx="12" cy="6" r="1.3" fill={color} stroke="none" />
        <circle cx="12" cy="12" r="1.3" fill={color} stroke="none" />
        <circle cx="12" cy="18" r="1.3" fill={color} stroke="none" />
      </>
    ),
  },

  // ── Menu / account ───────────────────────────────────────────────────
  user: {
    outline: (color) => (
      <>
        <circle cx="12" cy="8" r="3.5" stroke={color} strokeWidth="1.7" fill="none" />
        <path d="M5 20a7 7 0 0 1 14 0" stroke={color} strokeWidth="1.7" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  shield: {
    outline: (color) => (
      <>
        <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" stroke={color} strokeWidth="1.7" fill="none" strokeLinejoin="round" />
        <path d="M9 12l2 2 4-4" stroke={color} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  gift: {
    outline: (color) => (
      <>
        <rect x="4" y="9" width="16" height="11" rx="1.5" stroke={color} strokeWidth="1.6" fill="none" />
        <path d="M4 13h16" stroke={color} strokeWidth="1.6" />
        <path d="M12 9v11" stroke={color} strokeWidth="1.6" />
        <path d="M12 9c-3 0-4-3-2.5-4.5S13 4 12 9Z" stroke={color} strokeWidth="1.6" fill="none" strokeLinejoin="round" />
        <path d="M12 9c3 0 4-3 2.5-4.5S11 4 12 9Z" stroke={color} strokeWidth="1.6" fill="none" strokeLinejoin="round" />
      </>
    ),
  },
  globe: {
    outline: (color) => (
      <>
        <circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth="1.6" fill="none" />
        <path d="M3.5 12h17" stroke={color} strokeWidth="1.6" />
        <path d="M12 3.5c3 3 3 14 0 17" stroke={color} strokeWidth="1.6" fill="none" />
        <path d="M12 3.5c-3 3-3 14 0 17" stroke={color} strokeWidth="1.6" fill="none" />
      </>
    ),
  },
  settings: {
    outline: (color) => (
      <>
        <circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.6" fill="none" />
        <path
          d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.1 5.9l-1.55 1.55M7.45 16.55 5.9 18.1M18.1 18.1l-1.55-1.55M7.45 7.45 5.9 5.9"
          stroke={color}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </>
    ),
  },
  logout: {
    outline: (color) => (
      <>
        <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" stroke={color} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15 8l4 4-4 4" stroke={color} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M19 12H9" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      </>
    ),
  },
  // Open eye / eye-with-slash pair — used by the Home hero card's
  // show/hide-balance toggle (Bybit's own "eye" icon next to Total
  // Assets). Both share the same almond-shaped eye outline + pupil dot;
  // eyeOff adds a single diagonal strike through it rather than being a
  // wholly separate drawing, so the two stay visually paired at a glance.
  eye: {
    outline: (color) => (
      <>
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke={color} strokeWidth="1.7" fill="none" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2.8" stroke={color} strokeWidth="1.7" fill="none" />
      </>
    ),
  },
  eyeOff: {
    outline: (color) => (
      <>
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke={color} strokeWidth="1.7" fill="none" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2.8" stroke={color} strokeWidth="1.7" fill="none" />
        <path d="M4 4l16 16" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      </>
    ),
  },
  // A crescent — the outer boundary arced one way, a second arc cut back
  // across it the other way, closing into a lens shape. Used by the Menu
  // screen's dark mode row.
  moon: {
    outline: (color) => (
      <path
        d="M19.5 14.5a8 8 0 0 1-10-10 8 8 0 1 0 10 10Z"
        stroke={color}
        strokeWidth="1.7"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
    filled: (color) => <path d="M19.5 14.5a8 8 0 0 1-10-10 8 8 0 1 0 10 10Z" fill={color} stroke="none" />,
  },
  // ── Toast severity glyphs (Toast.jsx) ───────────────────────────────
  // A ring plus an inner mark identifying the toast's severity — success
  // gets a checkmark, error/warning share the same "!" mark (their
  // difference is communicated by the toast's accent-border color, not
  // the icon shape), info gets an "i". Only outline variants exist —
  // Toast.jsx never renders these filled.
  checkCircle: {
    outline: (color) => (
      <>
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.7" fill="none" />
        <path d="M8 12.3l2.6 2.6L16 9.5" stroke={color} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  alertCircle: {
    outline: (color) => (
      <>
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.7" fill="none" />
        <path d="M12 7.5v6" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="12" cy="16.3" r="1" fill={color} stroke="none" />
      </>
    ),
  },
  infoCircle: {
    outline: (color) => (
      <>
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.7" fill="none" />
        <path d="M12 11v5.2" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="12" cy="7.8" r="1" fill={color} stroke="none" />
      </>
    ),
  },

  // Magnifying glass — used by MarketsPage.jsx's coin search box. Only an
  // outline variant exists; nothing renders this filled.
  search: {
    outline: (color) => (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" stroke={color} strokeWidth="1.8" fill="none" />
        <path d="M19.5 19.5l-4.3-4.3" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
  },

  // Two overlapping rounded rects — the standard "copy to clipboard" glyph.
  // Used by DepositPage.jsx's address-copy button; swapped out for
  // checkCircle (above) for a moment right after a successful copy, so the
  // feedback sits at the exact spot the user just tapped, not only in a
  // separate toast. Only an outline variant exists; nothing renders this
  // filled.
  copy: {
    outline: (color) => (
      <>
        <rect x="8.5" y="8.5" width="10" height="10" rx="1.6" stroke={color} strokeWidth="1.6" fill="none" />
        <path d="M15.5 8.5V6.6a1.6 1.6 0 0 0-1.6-1.6H6.6A1.6 1.6 0 0 0 5 6.6v7.3a1.6 1.6 0 0 0 1.6 1.6h1.9" stroke={color} strokeWidth="1.6" fill="none" />
      </>
    ),
  },

  // A circled "$" — used as the "USD" option's icon wherever a currency
  // picker lists USD alongside real coin logos (CoinGlyph) that have no
  // dollar-sign equivalent of their own — see HomePage/WalletPage's
  // display-currency picker.
  dollar: {
    outline: (color) => (
      <>
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.7" fill="none" />
        <path
          d="M12 6.5v11M15 9.3c0-1.1-1.3-2-3-2s-3 .9-3 2c0 1.1 1.3 1.6 3 2s3 .9 3 2c0 1.1-1.3 2-3 2s-3-.9-3-2"
          stroke={color}
          strokeWidth="1.4"
          fill="none"
          strokeLinecap="round"
        />
      </>
    ),
  },

  // A circled clock face (ring + two hands pointing to a fixed time) —
  // used by CreateBotPage.jsx's session-length picker, where a coin/network
  // logo (CoinGlyph/NetworkGlyph) makes no sense per-option since every
  // option there is a plain duration, not an asset. Only an outline
  // variant exists; nothing renders this filled.
  clock: {
    outline: (color) => (
      <>
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.7" fill="none" />
        <path d="M12 7v5.2l3.3 1.9" stroke={color} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },

  // Plain X — used as the "clear this input" glyph inside MarketsPage.jsx's
  // search box once it has text typed into it. Only an outline variant
  // exists; nothing renders this filled.
  close: {
    outline: (color) => (
      <>
        <path d="M6 6l12 12" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M18 6L6 18" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
  },
};

/**
 * <Icon name="home" size={22} variant="filled" color="var(--teal-base)" />
 *
 * name: any key in ICONS above.
 * variant: "outline" (default) or "filled" — "filled" falls back to the
 *   outline render if that icon has no dedicated filled entry.
 * size: render width/height in px (viewBox is always the design system's
 *   standard 0 0 24 24 — see Section 7 of the design spec).
 * color: any CSS color, defaults to currentColor so the icon inherits
 *   whatever text color its parent has, exactly like AnimatedPsi.jsx.
 * className: optional, passed straight through to the rendered <svg> —
 *   e.g. TabBar.jsx uses this to attach the "qx-tab-pop" bounce animation
 *   class (see index.css) to whichever tab icon just became active.
 *   Omitted entirely by every other call site, which behave exactly as
 *   before.
 */
export default function Icon({ name, size = 22, variant = "outline", color = "currentColor", className }) {
  const entry = ICONS[name];
  if (!entry) {
    // Fails loud in dev rather than silently rendering nothing — a typo'd
    // icon name should be obvious immediately, not a mysteriously blank
    // spot discovered later.
    console.warn(`Icon: unknown icon name "${name}"`);
    return null;
  }
  const render = variant === "filled" && entry.filled ? entry.filled : entry.outline;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" className={className}>
      {render(color)}
    </svg>
  );
}
