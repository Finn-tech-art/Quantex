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
// Fetched once per mount, not polled — the balance/currency-equivalent
// display this feeds (HomePage/WalletPage's hero card) already only
// refreshes its own balances once per mount too, so polling prices on a
// faster cadence than the balances themselves change would just be extra
// backend load for a figure that already isn't meant to update live
// second-to-second. If a future call site needs fresher prices, add a
// setInterval here the same way TradePage/MarketsPage already do for
// their own polling.
export default function useAssetPrices(accessToken) {
  const [prices, setPrices] = useState(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

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
        // Left as null on failure — every call site treats a null price
        // map as "not ready yet" (see currency.js), which is the correct
        // behavior here too: better to keep showing a loading state than
        // to silently compute a wrong total off a stale/empty price map.
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return prices;
}
