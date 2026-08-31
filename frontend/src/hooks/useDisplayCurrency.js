import { useState } from "react";

// Which coin/currency a user's total balance is shown in — "USD" or one of
// this app's tradeable coin codes ("BTC", "ETH", "SOL"). This is a single
// GLOBAL preference shared between HomePage's hero card and WalletPage's
// hero card (same as Bybit's own display-currency setting isn't per-screen
// either) — both call this exact hook rather than keeping their own
// separate state, so switching it on one screen is already reflected on
// the other the next time it renders.
//
// Persisted in localStorage rather than a backend user-profile field:
// this is a per-device display preference with no effect on any real
// balance, trade, or ledger data — nothing about it needs to sync across
// devices or survive a fresh browser profile, so a backend column/endpoint
// for it would be more machinery than the feature is worth. If that ever
// changes (e.g. a real settings page where this belongs alongside other
// synced preferences), swap this hook's internals for a real API call —
// every call site only interacts with the [currency, setCurrency] pair
// this returns, not with localStorage directly.
const STORAGE_KEY = "qx_display_currency";
const DEFAULT_CURRENCY = "USD";

// The only choices offered — USD plus every coin this app actually has a
// live Binance price for and lets a user trade into (TradePage.jsx's own
// PAIRS list). Keep this in sync with that list: adding a coin there
// without adding it here just means it's tradeable but never offered as a
// display currency.
export const DISPLAY_CURRENCIES = ["USD", "BTC", "ETH", "SOL"];

export default function useDisplayCurrency() {
  const [currency, setCurrency] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return DISPLAY_CURRENCIES.includes(stored) ? stored : DEFAULT_CURRENCY;
    } catch {
      // Private browsing / storage disabled — falls back to the default
      // every time rather than throwing, since this is a nice-to-have
      // preference, not something the rest of the page depends on.
      return DEFAULT_CURRENCY;
    }
  });

  function updateCurrency(next) {
    setCurrency(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Same reasoning as above — a failed write just means the choice
      // won't survive a reload, not a crash.
    }
  }

  return [currency, updateCurrency];
}
