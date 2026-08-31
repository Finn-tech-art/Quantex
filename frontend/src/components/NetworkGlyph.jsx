// Real, brand-colored per-network icons — Tron's red triangle, Base's
// blue circle, Polygon's purple diamond — for the network picker on
// Deposit/Withdraw, following the exact same convention CoinGlyph.jsx
// already established for per-COIN icons (same @web3icons/react package,
// same "background" variant clipped to a circle, same letter-monogram
// fallback for anything not in the map). Kept as its own file rather than
// folded into CoinGlyph because a "network" (a blockchain: Tron, Base,
// Polygon) and a "coin/asset" (BTC, USDT) are conceptually different
// things in this app's own domain model — see withdrawal_service.py's
// ASSET_NETWORKS, where one asset (USDT) can move over more than one
// network — even though today's DepositPage happens to render its
// network picker at a similar size to CoinGlyph.
import { NetworkBase, NetworkPolygon, NetworkTron } from "@web3icons/react";

// Maps this app's network codes (exactly the strings already used in
// TradePage/DepositPage/WithdrawPage's own NETWORKS/ASSET_NETWORKS lists —
// "TRC20", "BASE", "POLYGON") to their icon component. Add a line here
// whenever a new network is added to any of those lists — anything NOT in
// this map falls back to the plain letter monogram below instead of
// crashing.
const NETWORK_ICONS = {
  TRC20: NetworkTron,
  BASE: NetworkBase,
  POLYGON: NetworkPolygon,
};

/**
 * <NetworkGlyph network="TRC20" size={24} />
 *
 * network: one of this app's network codes, e.g. "TRC20", "BASE",
 *   "POLYGON" — case-insensitive.
 * size: render width/height in px, defaults to 24 (SelectField's row
 *   size).
 */
export default function NetworkGlyph({ network, size = 24 }) {
  const NetworkIcon = NETWORK_ICONS[network?.toUpperCase()];

  if (!NetworkIcon) {
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
        {network?.[0]}
      </span>
    );
  }

  return (
    <NetworkIcon
      variant="background"
      size={size}
      style={{
        // Same reasoning as CoinGlyph.jsx: the "background" variant is a
        // solid-colored square with the glyph in white on top — clipping
        // to a circle here is what gives it the round badge look this
        // app's coin/network icons share everywhere else.
        borderRadius: "50%",
        flexShrink: 0,
      }}
    />
  );
}
