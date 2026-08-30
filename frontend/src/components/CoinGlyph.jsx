// Real, brand-colored per-coin icons — Bitcoin's orange, Ethereum's
// grey-blue, Solana's gradient, Tether's green — instead of the
// first-letter-in-a-circle monogram this app used everywhere before. Uses
// the @web3icons/react package (see package.json) rather than hand-drawing
// these the way Icon.jsx's app-chrome icons are drawn: a coin's brand mark
// is a fixed, recognizable logo (the whole point is that it looks like the
// REAL Bitcoin/Ethereum/etc. symbol), not a line-art glyph this app has any
// business reinterpreting the way it does for its own nav icons.
//
// Each of that package's Token* components ships three built-in color
// variants (see its own TokenBTC.js for the exact list): "mono" (single
// color, for monochrome contexts), "branded" (the flat colored glyph with
// no backdrop), and "background" (the one used here — a solid brand-color
// square with the glyph in white on top, which is what actually matches
// Bybit's circular coin badges once clipped to a circle below).
import { TokenBTC, TokenETH, TokenSOL, TokenUSDT } from "@web3icons/react";

// Maps this app's asset symbols to their icon component. Add a new line
// here whenever a new asset is added to TradePage.jsx's PAIRS or becomes
// depositable — anything NOT in this map falls back to the plain letter
// monogram below instead of crashing, so a balance in some future asset
// still renders something rather than breaking the page.
const TOKEN_ICONS = {
  BTC: TokenBTC,
  ETH: TokenETH,
  SOL: TokenSOL,
  USDT: TokenUSDT,
};

/**
 * <CoinGlyph asset="BTC" size={28} />
 *
 * asset: an asset symbol, e.g. "BTC", "USDT" — case-insensitive.
 * size: render width/height in px, defaults to 28 (WalletPage's asset-row
 *   size, the only size this was used at before this component existed).
 */
export default function CoinGlyph({ asset, size = 28 }) {
  const TokenIcon = TOKEN_ICONS[asset?.toUpperCase()];

  if (!TokenIcon) {
    // Same first-letter-in-a-circle look this whole app used before —
    // kept as the fallback for any asset this component doesn't
    // recognize yet, rather than rendering nothing.
    return (
      <span
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: "var(--teal-pale)",
          color: "var(--teal-deep)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: size * 0.4,
          flexShrink: 0,
        }}
      >
        {asset?.[0]}
      </span>
    );
  }

  return (
    <TokenIcon
      variant="background"
      size={size}
      style={{
        // The "background" variant is a solid-colored SQUARE with the
        // glyph in white on top (see this file's module comment) —
        // clipping it to a circle here is what actually gives it Bybit's
        // round coin-badge look.
        borderRadius: "50%",
        flexShrink: 0,
      }}
    />
  );
}
