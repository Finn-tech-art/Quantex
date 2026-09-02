import { useEffect, useState } from "react";
import { getMarkets } from "../lib/api";

// Fetches live USD prices for every asset the Markets feed knows about
// (the same GET /market/tickers backend/app/routers/market.py serves to
// MarketsPage.jsx) and reshapes it into a plain { BTC: 68000.12, ETH:
// 3400.5, SOL: 145.2, ... } lookup keyed by asset code — exactly what
// lib/currency.js's usdValueOfBalance()/convertUsdTo() need to turn a raw
// balance quantity into a real USD figure, or a USD figure into a coin
// equivalent.
//
// Polled every POLL_INTERVAL_MS (matches MarketsPage.jsx's own polling
// cadence, so every screen reading this feed updates on the same rhythm)
// rather than fetched once — HomePage/WalletPage's hero card balance
// figure and its "≈ X USDT" equivalency line are both meant to tick with
// the live market the way a real exchange's balance screen does, not
// freeze at whatever price happened to be current on page load. Lower
// POLL_INTERVAL_MS for a snappier-feeling figure, raise it to reduce
// backend load.
const POLL_INTERVAL_MS = 15000;

export default function useAssetPrices(accessToken) {
  const [prices, setPrices] = useState(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    function refresh() {
      getMarkets(accessToken)
        .then((res) => {
          if (cancelled) return;
          const map = {};
          for (const ticker of res.tickers) {
            map[ticker.base] = Number(ticker.price);
          }
          setPrices(map);
        })
        .catch(() => {
          // Left at whatever it already held (or null on the very first
          // failed fetch) — every call site treats a null price map as
          // "not ready yet" (see currency.js), and a stale-but-present map
          // is still better than blanking out a live figure over one
          // missed poll, so a failure here never clears an existing value.
        });
    }

    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accessToken]);

  return prices;
}
