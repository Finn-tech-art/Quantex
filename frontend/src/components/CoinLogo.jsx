// A small round coin icon, keyed off the base asset ticker (e.g. "BTC",
// "ETH"). Used anywhere the app shows a row per coin from the markets feed
// (MarketsPage's full list, HomePage's Hots/Spots widget) so both places
// render the exact same logo-with-fallback behavior instead of two copies
// of the same code drifting apart over time.
//
// Image source: jsDelivr's mirror of the "cryptocurrency-icons" npm package
// (MIT-licensed) — a colored SVG per coin, keyed by lowercase ticker (e.g.
// "btc.svg", "eth.svg"). To point this at a different icon set later
// (e.g. a paid icon CDN, or self-hosted SVGs), only the `src` template
// string below needs to change — every call site stays the same.
//
// That icon set covers the well-known coins but not every long-tail
// Binance listing, so `broken` (flipped by the <img>'s onError) swaps in a
// plain circular letter-avatar (first character of the ticker, e.g. "B"
// for a coin whose logo 404s) instead of showing a broken-image icon.
import { useState } from "react";

export default function CoinLogo({ base, size = 34 }) {
  const [broken, setBroken] = useState(false);
  const src = `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/${base.toLowerCase()}.svg`;

  if (broken) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "var(--radius-full)",
          background: "var(--teal-pale)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          // Scales the fallback letter's font-size proportionally to
          // whatever `size` this call site asked for (34px logo -> 13px
          // letter is the ratio MarketsPage originally used), so a smaller
          // logo elsewhere (e.g. a denser Home widget row) doesn't end up
          // with an oversized letter inside a small circle.
          fontSize: `${Math.round(size * 0.38)}px`,
          color: "var(--teal-deep)",
          flexShrink: 0,
        }}
      >
        {base.charAt(0)}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={base}
      width={size}
      height={size}
      onError={() => setBroken(true)}
      style={{ borderRadius: "var(--radius-full)", flexShrink: 0 }}
    />
  );
}
