import { useEffect, useState } from "react";
import { getRealPrices } from "../lib/api";

// The REAL (never-jittered) counterpart to useAssetPrices.js — same shape
// ({ BTC: 68000.12, ETH: 3400.5, ... }), same polling pattern, but sourced
// from GET /market/real-prices instead of GET /market/tickers. See that
// route's own comment (backend/app/routers/market.py) for why the two are
// kept as separate endpoints: /market/tickers is deliberately jittered
// every few seconds so the Markets page feels alive, which would make the
// Wallet/Home balance's actual dollar figure wobble with fake movement too
// if it read from that same feed. This hook is what HomePage/WalletPage use
// instead for the BIG balance figure (and for STABLECOIN_ASSETS/other real
// math in lib/currency.js) — the jittered useAssetPrices.js hook is kept
// around purely to drive the small "≈ X USDT" caption's cosmetic wobble.
//
// Polled on the same POLL_INTERVAL_MS cadence as useAssetPrices.js so both
// price maps refresh in step with each other — lower this for a snappier
// real figure, raise it to reduce backend/Redis load.
const POLL_INTERVAL_MS = 15000;

export default function useRealAssetPrices(accessToken) {
  const [prices, setPrices] = useState(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    function refresh() {
      getRealPrices(accessToken)
        .then((res) => {
          if (cancelled) return;
          const map = {};
          for (const [asset, price] of Object.entries(res.prices)) {
            map[asset] = Number(price);
          }
          setPrices(map);
        })
        .catch(() => {
          // Same "never clear a value we already have" behavior as
          // useAssetPrices.js — a stale-but-present map beats blanking out
          // the balance figure over one missed poll.
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
