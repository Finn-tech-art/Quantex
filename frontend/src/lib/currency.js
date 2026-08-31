// Shared helpers for turning a raw balances array (from GET /wallet/balances
// — see lib/api.js's getBalances()) into a real USD figure, and for
// converting that USD figure into a coin-equivalent display (e.g. "how
// much BTC is my whole portfolio worth right now").
//
// This fixes a real, currently-live bug, not just adds a new feature:
// HomePage.jsx and WalletPage.jsx both used to compute their "total
// balance" as `balances.reduce((sum, b) => sum + Number(b.amount), 0)` —
// summing every asset's RAW quantity 1:1 as if it were already in USD.
// backend/app/services/portfolio_history_service.py's own module comment
// flags this exact same shortcut on the backend side as a known,
// deliberate limitation that "stops being exactly true the moment a
// non-stablecoin asset is added". That moment already happened: TradePage
// lets a user buy real BTC/ETH/SOL with their real balance today, so
// anyone who's ever made a trade was already seeing a wrong total (e.g.
// holding 0.002 BTC would count as "$0.002" instead of its real ~$130
// value). Building the currency-equivalent display properly requires this
// same real-price conversion anyway, so this fixes both at once — on the
// frontend, for the CURRENT total shown on Home/Wallet. The backend's own
// portfolio-history sparkline calculation still has the old shortcut for
// now — that's a separate, backend-side fix, not touched here.

// Assets whose amount IS already USD-equivalent 1:1, with no live price
// lookup needed — both stablecoins this app can actually hold today (see
// WithdrawPage.jsx's ASSET_NETWORKS: USDT over TRC20, USDC over
// BASE/POLYGON). Add a new stablecoin's asset code here if one is ever
// supported; everything else falls through to needing a real price.
export const STABLECOIN_ASSETS = new Set(["USDT", "USDC"]);

/**
 * usdValueOfBalance({ asset, amount }, prices)
 *
 * prices: a map of asset code -> live USD price (e.g. { BTC: 68000.12 }),
 *   as built by useAssetPrices.js.
 *
 * Returns the USD value of one balance row, or `null` if this asset isn't
 * a stablecoin AND isn't in `prices` yet — the null is deliberate: it
 * means "not safe to compute a total yet", not "worth zero". A caller
 * seeing null back from totalUsdValue() below should keep showing its
 * loading state rather than displaying a partial, silently-undercounted
 * total.
 */
export function usdValueOfBalance({ asset, amount }, prices) {
  if (STABLECOIN_ASSETS.has(asset)) return Number(amount);
  const price = prices?.[asset];
  if (price == null) return null;
  return Number(amount) * price;
}

/**
 * totalUsdValue(balances, prices)
 *
 * Sums usdValueOfBalance() across every balance row. Returns `null` (never
 * a partial/wrong number) if ANY held asset can't be priced yet — the
 * caller is expected to treat that exactly like "balances still loading".
 */
export function totalUsdValue(balances, prices) {
  let total = 0;
  for (const balance of balances) {
    const value = usdValueOfBalance(balance, prices);
    if (value == null) return null;
    total += value;
  }
  return total;
}

/**
 * convertUsdTo(totalUsd, currency, prices)
 *
 * Converts an already-computed USD total into either itself (currency ===
 * "USD") or a coin-equivalent quantity (currency is an asset code with a
 * live price in `prices`) — e.g. convertUsdTo(1000, "BTC", { BTC: 50000 })
 * -> 0.02. Returns null if the target currency's price isn't available
 * yet, same "not ready" convention as the functions above.
 */
export function convertUsdTo(totalUsd, currency, prices) {
  if (totalUsd == null) return null;
  if (currency === "USD") return totalUsd;
  const price = prices?.[currency];
  if (!price) return null;
  return totalUsd / price;
}
