// The manual Trade screen — Bybit's spot trading layout (pair selector,
// price header, candlestick+volume chart, Buy/Sell form, trade history)
// rendered in Quantex's own tokens. See backend/app/services/
// trading_service.py's module comment for exactly what a trade does:
// simulated execution (no real Binance order), but real USDT/asset
// balances, moved at the live market price, minus a real fee.
//
// A tab-root screen (see TabBar.jsx / App.jsx's AppShell route group) —
// no back chevron, matching Home/Bots/Wallet/Menu's header convention.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import AnimatedPsi from "../components/AnimatedPsi";
import Icon from "../components/Icon";
import LiveChart from "../components/LiveChart";
import { ErrorText } from "../components/FormControls";
import ConfirmSheet from "../components/ConfirmSheet";
import CoinGlyph from "../components/CoinGlyph";
import { useToast } from "../context/ToastContext";
import { buyTrade, getBalances, getTradeChart, getTradeHistory, getTradePrice, sellTrade } from "../lib/api";

// Binance symbol has no slash ("BTCUSDT"); every asset/UI-facing name uses
// the slash form ("BTC/USDT") — same split trading_service.py's own
// _binance_symbol()/_base_asset() use, kept in sync with SUPPORTED_PAIRS
// there. Add a pair here AND to that backend set AND to
// market_data_feed.py's TRACKED_SYMBOLS together — all three have to agree
// or a pair added to just one place either 400s or never gets a price.
const PAIRS = ["BTC/USDT", "ETH/USDT", "SOL/USDT"];

function baseAsset(pair) {
  return pair.split("/")[0];
}

export default function TradePage() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  const toast = useToast();

  const [pair, setPair] = useState(PAIRS[0]);
  const [price, setPrice] = useState(null); // null = loading, a Decimal-string once loaded
  const [chart, setChart] = useState(null);
  const [balances, setBalances] = useState(null);
  const [history, setHistory] = useState(null);
  const [mode, setMode] = useState("buy"); // "buy" | "sell"
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  // Drives the trade ConfirmSheet below — submitting the form only opens
  // this; the real buyTrade()/sellTrade() call happens in
  // handleConfirmTrade, once the user taps the sheet's own Buy/Sell button.
  // Same two-step pattern BotDetailPage.jsx uses for Stop.
  const [confirmOpen, setConfirmOpen] = useState(false);
  // A frozen copy of {qty, totalUsdt, price} taken at the instant the sheet
  // opens. Without this, the background's 15s refresh() could update
  // `price` while the sheet is sitting open, silently changing the numbers
  // the user is looking at right before they tap Confirm — exactly the
  // "can I trust what's on screen" problem this confirmation step exists
  // to solve. The actual trade still executes at the real-time price the
  // backend sees at confirm time regardless (see trading_service.py); this
  // snapshot only pins what's DISPLAYED, never what's submitted.
  const [confirmSnapshot, setConfirmSnapshot] = useState(null);

  function refresh() {
    if (!accessToken) return;
    getTradePrice(accessToken, pair)
      .then((res) => setPrice(res.price))
      .catch(() => setPrice(null));
    getTradeChart(accessToken, pair)
      .then((res) => setChart(res.candles))
      .catch(() => setChart([]));
    getBalances(accessToken).then((res) => setBalances(res.balances));
    getTradeHistory(accessToken, pair).then((res) => setHistory(res.trades));
  }

  // Reload everything when the pair changes, and on a plain interval so the
  // price/chart stay live — same 15s cadence BotDetailPage.jsx already
  // settled on (matches the real Grid engine's own sweep interval; there's
  // no point polling faster than the underlying price feed itself ticks).
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, pair]);

  // Switching pairs (or Buy<->Sell) invalidates whatever amount was typed
  // for the OLD context — a "0.5" that meant "0.5 BTC to sell" is nonsense
  // once you're back on the Buy tab typing a USDT amount instead.
  useEffect(() => {
    setAmount("");
    setError(null);
  }, [pair, mode]);

  const usdtBalance = balances?.find((b) => b.asset === "USDT")?.amount ?? "0";
  const assetBalance = balances?.find((b) => b.asset === baseAsset(pair))?.amount ?? "0";

  const asset = baseAsset(pair);
  const priceNum = price !== null ? Number(price) : null;
  const amountNum = Number(amount) || 0;

  // Pure display math, mirrors trading_service.py's own buy()/sell() exactly
  // (fee taken out of what you receive, not added on top of what you pay) —
  // see that module's header comment. Recomputing FEE_RATE here as a
  // literal 0.001 is a deliberate, display-only duplication: this is never
  // what actually executes the trade (the backend always recomputes for
  // real at submit time using its own FEE_RATE), so a mismatch here would
  // only ever produce a slightly-off preview number, never a wrong balance
  // movement. Lifted up from TradeForm (rather than computed there) so the
  // ConfirmSheet below — which needs the same numbers for its "Buy 0.00124
  // BTC at $X — Total $Y" summary — doesn't have to duplicate this math.
  const FEE_RATE = 0.001;
  const preview =
    mode === "buy" && priceNum && amountNum > 0
      ? { fee: amountNum * FEE_RATE, receiveQty: (amountNum * (1 - FEE_RATE)) / priceNum }
      : mode === "sell" && priceNum && amountNum > 0
        ? { fee: amountNum * priceNum * FEE_RATE, receiveQuote: amountNum * priceNum * (1 - FEE_RATE) }
        : null;

  // The asset-quantity and USDT-total sides of the trade, independent of
  // which field the user actually typed into — buy mode's typed `amount`
  // IS the USDT total already, while sell mode's typed `amount` IS the
  // asset quantity already; the other side comes from `preview`.
  const confirmQty = mode === "buy" ? preview?.receiveQty : amountNum;
  const confirmTotalUsdt = mode === "buy" ? amountNum : preview?.receiveQuote;

  function handleFormSubmit(e) {
    e.preventDefault();
    // Guards against a stray Enter-key submit racing the button's own
    // disabled state (e.g. price flips to null between keystrokes) —
    // opening a confirm sheet with nothing valid to confirm would be worse
    // than just no-opping.
    if (!preview) return;
    setError(null);
    setConfirmSnapshot({ qty: confirmQty, totalUsdt: confirmTotalUsdt, price: priceNum });
    setConfirmOpen(true);
  }

  async function handleConfirmTrade() {
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "buy") {
        await buyTrade(accessToken, pair, amount);
      } else {
        await sellTrade(accessToken, pair, amount);
      }
      setConfirmOpen(false);
      toast.success(
        t(mode === "buy" ? "trade.buySuccess" : "trade.sellSuccess", {
          qty: confirmSnapshot.qty.toFixed(6),
          asset,
        })
      );
      setAmount("");
      refresh();
    } catch (err) {
      // Left open (not setConfirmOpen(false)) so the sheet itself is where
      // the error surfaces — same reasoning as BotDetailPage.jsx's Stop
      // confirmation: closing on failure would discard the very feedback
      // the user needs to see.
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ paddingTop: "var(--space-11)", paddingBottom: "var(--space-16)" }}>
      <div style={{ maxWidth: 384, margin: "0 auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "18px", color: "var(--ink-base)" }}>
          {t("trade.title")}
        </span>

        <PairTabs pair={pair} onSelect={setPair} />

        <PriceHeader price={price} chart={chart} />

        {chart && chart.length > 0 && (
          <LiveChart allCandles={toChartCandles(chart)} fills={toMarkerFills(history)} chartId={pair} />
        )}

        <p style={{ fontFamily: "var(--font-body)", fontSize: "10.5px", color: "var(--ink-soft)", lineHeight: 1.5, margin: 0 }}>
          {t("trade.simulatedNotice", { feePct: "0.1%" })}
        </p>

        <TradeForm
          mode={mode}
          onModeChange={setMode}
          pair={pair}
          price={price}
          amount={amount}
          onAmountChange={setAmount}
          usdtBalance={usdtBalance}
          assetBalance={assetBalance}
          preview={preview}
          onSubmit={handleFormSubmit}
          t={t}
        />

        <ConfirmSheet
          open={confirmOpen}
          onClose={() => {
            setConfirmOpen(false);
            // Clears any failed-attempt error along with closing — otherwise
            // it would sit around invisible (the sheet that shows it is
            // gone) and reappear stale next time the sheet is reopened.
            setError(null);
          }}
          title={t(mode === "buy" ? "trade.confirmTitleBuy" : "trade.confirmTitleSell", {
            qty: confirmSnapshot?.qty?.toFixed(6),
            asset,
          })}
          body={
            <>
              {t("trade.confirmPrice", { price: confirmSnapshot?.price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}
              {" — "}
              {t("trade.confirmTotal", { amount: confirmSnapshot?.totalUsdt?.toFixed(2) })}
              {error && (
                <div style={{ marginTop: "var(--space-4)" }}>
                  <ErrorText message={error} />
                </div>
              )}
            </>
          }
          cancelLabel={t("trade.confirmCancel")}
          confirmLabel={t(mode === "buy" ? "trade.submitBuy" : "trade.submitSell", { asset })}
          confirmingLabel={t("trade.submitting")}
          confirming={submitting}
          onConfirm={handleConfirmTrade}
        />

        <TradeHistory history={history} t={t} />
      </div>
    </div>
  );
}

function PairTabs({ pair, onSelect }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-4)" }}>
      {PAIRS.map((p) => {
        const active = p === pair;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onSelect(p)}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--space-3)",
              background: active ? "var(--teal-base)" : "var(--cream-deep)",
              color: active ? "var(--on-accent)" : "var(--ink-soft)",
              border: `1px solid ${active ? "var(--teal-base)" : "var(--cream-line)"}`,
              borderRadius: "var(--radius-md)",
              padding: "8px 4px",
              fontFamily: "var(--font-data)",
              fontWeight: 600,
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            <CoinGlyph asset={baseAsset(p)} size={16} />
            {p}
          </button>
        );
      })}
    </div>
  );
}

function PriceHeader({ price, chart }) {
  const loading = price === null || chart === null;
  const firstClose = chart && chart.length > 0 ? Number(chart[0].close) : null;
  const lastClose = price !== null ? Number(price) : null;
  const pctChange = firstClose && lastClose && firstClose !== 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;
  const isUp = pctChange >= 0;

  if (loading) return <AnimatedPsi mode="working" size={24} color="var(--teal-base)" />;

  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-6)" }}>
      <span className="qx-num" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "26px", color: "var(--ink-base)" }}>
        ${Number(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <span style={{ fontFamily: "var(--font-data)", fontSize: "12px", color: isUp ? "var(--gain)" : "var(--loss)" }}>
        {isUp ? "+" : ""}
        {pctChange.toFixed(2)}%
      </span>
    </div>
  );
}

function TradeForm({ mode, onModeChange, pair, price, amount, onAmountChange, usdtBalance, assetBalance, preview, onSubmit, t }) {
  const asset = baseAsset(pair);
  const priceNum = price !== null ? Number(price) : null;

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <div style={{ display: "flex", background: "var(--cream-deep)", borderRadius: "var(--radius-md)", padding: 3 }}>
        <ModeButton active={mode === "buy"} onClick={() => onModeChange("buy")} label={t("trade.buy")} kind="buy" />
        <ModeButton active={mode === "sell"} onClick={() => onModeChange("sell")} label={t("trade.sell")} kind="sell" />
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "11px", color: "var(--ink-soft)" }}>
          {mode === "buy" ? t("trade.amountLabel") : t("trade.quantityLabel")}
        </span>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          required
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="0.00"
          style={{
            background: "var(--cream-deep)",
            border: "1px solid var(--cream-line)",
            borderRadius: "var(--radius-md)",
            padding: "13px 14px",
            fontFamily: "var(--font-data)",
            fontSize: "16px",
            color: "var(--ink-base)",
            outline: "none",
          }}
        />
        <span style={{ fontFamily: "var(--font-data)", fontSize: "10.5px", color: "var(--ink-soft)" }}>
          {t("trade.available", { amount: mode === "buy" ? usdtBalance : assetBalance, asset: mode === "buy" ? "USDT" : asset })}
        </span>
      </label>

      {preview && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span style={{ fontFamily: "var(--font-data)", fontSize: "10.5px", color: "var(--ink-soft)" }}>
            {t("trade.feeNotice", { feePct: "0.1%", amount: preview.fee.toFixed(4) })}
          </span>
          <span style={{ fontFamily: "var(--font-data)", fontSize: "10.5px", color: "var(--ink-soft)" }}>
            {t("trade.youReceive", {
              amount: mode === "buy" ? preview.receiveQty.toFixed(6) : preview.receiveQuote.toFixed(2),
              asset: mode === "buy" ? asset : "USDT",
            })}
          </span>
        </div>
      )}

      <button
        type="submit"
        disabled={!amount || priceNum === null}
        style={{
          background: mode === "buy" ? "var(--gain)" : "var(--loss)",
          color: "var(--on-accent)",
          border: "none",
          borderRadius: "var(--radius-md)",
          padding: "14px",
          fontFamily: "var(--font-body)",
          fontWeight: 700,
          fontSize: "13px",
          cursor: !amount || priceNum === null ? "default" : "pointer",
          opacity: !amount || priceNum === null ? 0.6 : 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {mode === "buy" ? t("trade.submitBuy", { asset }) : t("trade.submitSell", { asset })}
      </button>
    </form>
  );
}

function ModeButton({ active, onClick, label, kind }) {
  const activeColor = kind === "buy" ? "var(--gain)" : "var(--loss)";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        background: active ? activeColor : "none",
        color: active ? "var(--on-accent)" : "var(--ink-soft)",
        border: "none",
        borderRadius: "var(--radius-sm)",
        padding: "9px 0",
        fontFamily: "var(--font-body)",
        fontWeight: 700,
        fontSize: "12.5px",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function TradeHistory({ history, t }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "14px", color: "var(--ink-base)" }}>
        {t("trade.historyTitle")}
      </span>
      {history === null ? (
        <AnimatedPsi mode="working" size={20} color="var(--teal-base)" />
      ) : history.length === 0 ? (
        <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)" }}>{t("trade.noHistory")}</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {history.map((trade) => {
            const isBuy = trade.side === "BUY";
            return (
              <div
                key={trade.id}
                style={{
                  background: "var(--cream-deep)",
                  border: "1px solid var(--cream-line)",
                  borderRadius: "var(--radius-lg)",
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}>
                  <Icon name={isBuy ? "deposit" : "withdraw"} size={16} color={isBuy ? "var(--gain)" : "var(--loss)"} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12px", color: "var(--ink-base)" }}>
                      {trade.side} {trade.pair}
                    </span>
                    <span style={{ fontFamily: "var(--font-data)", fontSize: "9.5px", color: "var(--ink-soft)" }}>
                      {new Date(trade.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                  <span style={{ fontFamily: "var(--font-data)", fontSize: "11.5px", color: "var(--ink-base)" }}>
                    {Number(trade.quantity).toFixed(6)} {baseAsset(trade.pair)}
                  </span>
                  <span style={{ fontFamily: "var(--font-data)", fontSize: "9.5px", color: "var(--ink-soft)" }}>
                    @ ${Number(trade.price).toLocaleString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Same conversion BotDetailPage.jsx's own toChartCandles() does — see that
// file's comment for why volume needs an explicit null-check rather than
// coercing a genuinely-absent field to 0.
function toChartCandles(candles) {
  return candles.map((c) => ({
    time: c.time,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: c.volume != null ? Number(c.volume) : null,
  }));
}

// Reuses this user's own trade history as the chart's BUY/SELL markers —
// LiveChart already expects exactly this {side, created_at} shape (see its
// own fillEpochSeconds()), since a bot's fills and a manual trade's
// history are structurally the same "something happened at this price and
// time" event.
function toMarkerFills(history) {
  return (history || []).map((trade) => ({ side: trade.side, created_at: trade.created_at }));
}
