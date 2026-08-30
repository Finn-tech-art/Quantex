// The Markets tab — a live, searchable list of every USDT-quoted coin's
// 24hr performance, fed by GET /market/tickers (see
// backend/app/routers/market.py + binance_market_service.stream_all_tickers()
// for where this data actually comes from: one combined Binance WebSocket
// stream covering the whole exchange, cached in Redis and re-read here
// every POLL_INTERVAL_MS). This used to be a "coming soon" placeholder —
// that's gone now that the backend feed exists.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import AnimatedPsi from "../components/AnimatedPsi";
import Icon from "../components/Icon";
import { getMarkets } from "../lib/api";

// How often the list re-fetches from the backend. 15s matches the poll
// interval TradePage.jsx already uses for its single live price — fast
// enough to feel live, slow enough not to hammer the backend for a list
// this size. Lower this for a snappier-feeling ticker, raise it to reduce
// backend load.
const POLL_INTERVAL_MS = 15000;

export default function MarketsPage() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  // null = still loading the very first response; [] would mean "loaded,
  // zero tickers" (shouldn't happen in practice, but handled the same way
  // ActiveBotsSection on Home distinguishes "loading" from "empty").
  const [tickers, setTickers] = useState(null);
  // Holds the actual thrown error's message (e.g. the backend's 503 detail
  // string, or the browser's own "Failed to fetch" on a network/CORS
  // problem) rather than just a boolean — surfacing the real reason here
  // instead of one generic string is what makes a stuck "can't load" state
  // debuggable from the screen alone, without needing devtools open.
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    function refresh() {
      getMarkets(accessToken)
        .then((res) => {
          if (cancelled) return;
          setTickers(res.tickers);
          setLoadError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setLoadError(err.message || "Unknown error");
        });
    }

    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accessToken]);

  // Case-insensitive filter on the base asset only (e.g. typing "sol"
  // matches "SOL", not "USDT") — applied client-side since the whole list
  // is already in memory from the last poll, no need to round-trip to the
  // backend just to filter it.
  const filtered = (tickers || []).filter((ticker) =>
    ticker.base.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div style={{ paddingTop: "var(--space-11)" }}>
      <div style={{ maxWidth: 384, margin: "0 auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "18px", color: "var(--ink-base)" }}>
          {t("markets.title")}
        </span>

        <SearchBox value={search} onChange={setSearch} placeholder={t("markets.searchPlaceholder")} />

        {loadError ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--loss)" }}>
              {t("markets.loadError")}
            </span>
            {/* The actual thrown error message — e.g. the backend's 503
                detail string when market_data_feed hasn't ticked yet, or
                the browser's own network-failure text. Shown in a smaller,
                softer line under the main message so this screen is
                debuggable on its own without opening devtools. */}
            <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", color: "var(--ink-soft)" }}>
              {loadError}
            </span>
          </div>
        ) : tickers === null ? (
          <AnimatedPsi mode="working" size={26} color="var(--teal-base)" />
        ) : filtered.length === 0 ? (
          <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)" }}>
            {t("markets.empty")}
          </span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
            {filtered.map((ticker) => (
              <CoinRow key={ticker.symbol} ticker={ticker} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <div style={{ position: "absolute", left: 14, display: "flex", pointerEvents: "none" }}>
        <Icon name="search" size={15} color="var(--ink-soft)" />
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          background: "var(--cream-deep)",
          border: "1px solid var(--cream-line)",
          borderRadius: "var(--radius-md)",
          padding: "11px 14px 11px 38px",
          fontFamily: "var(--font-body)",
          fontSize: "13px",
          color: "var(--ink-base)",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

function CoinRow({ ticker }) {
  const changePercent = Number(ticker.change_percent);
  // Same gain/loss semantic-color rule BotRow (BotsPage.jsx) and BotCard
  // (HomePage.jsx) already use — never the teal brand color for this,
  // always the dedicated --gain/--loss tokens.
  const changeColor = changePercent >= 0 ? "var(--gain)" : "var(--loss)";
  const price = Number(ticker.price);
  // Binance prices span a huge range (BTC in the tens of thousands, some
  // coins worth a fraction of a cent) — a fixed 2-decimal format would
  // round tiny-priced coins straight to "$0.00". Showing more decimals
  // under $1 keeps those readable without cluttering BTC/ETH-sized prices
  // with trailing zeros. Adjust the 1/6 thresholds here for different
  // precision.
  const priceDecimals = price >= 1 ? 2 : 6;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "10px 14px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
        <CoinLogo base={ticker.base} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "13px", color: "var(--ink-base)" }}>
            {ticker.base}
          </span>
          <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", letterSpacing: "0.03em", color: "var(--ink-soft)" }}>
            USDT
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
        <span style={{ fontFamily: "var(--font-data)", fontSize: "13px", color: "var(--ink-base)" }}>
          ${price.toLocaleString(undefined, { minimumFractionDigits: priceDecimals, maximumFractionDigits: priceDecimals })}
        </span>
        <span style={{ fontFamily: "var(--font-data)", fontSize: "11px", color: changeColor }}>
          {changePercent >= 0 ? "+" : ""}
          {changePercent.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}

// jsDelivr's mirror of the "cryptocurrency-icons" package (MIT-licensed,
// npm: cryptocurrency-icons) — a colored SVG per coin, keyed by lowercase
// ticker (e.g. "btc.svg", "eth.svg"). Covers the well-known coins but not
// every long-tail listing, so onError swaps in a plain letter-avatar (same
// look as the "Q" avatar in HomePage.jsx's LeaderboardSection) instead of
// a broken image icon. To point this at a different icon set later, only
// this one template string needs to change.
function CoinLogo({ base }) {
  const [broken, setBroken] = useState(false);
  const src = `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/${base.toLowerCase()}.svg`;

  if (broken) {
    return (
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: "var(--radius-full)",
          background: "var(--teal-pale)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: "13px",
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
      width={34}
      height={34}
      onError={() => setBroken(true)}
      style={{ borderRadius: "var(--radius-full)", flexShrink: 0 }}
    />
  );
}
