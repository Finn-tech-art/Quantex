// The Convert screen — Bybit's one-tap "swap one asset for another"
// flow, reached from the Convert quick-action tile on Home (right next
// to New bot; see QuickActions in HomePage.jsx). Deliberately
// one-directional (USDT -> a supported coin only, not any-asset <->
// any-asset the way Bybit's own Convert screen allows) since that's
// exactly what was asked for; the "from" side is fixed to USDT rather
// than being its own picker.
//
// This is PURE UI on top of the exact same backend endpoint TradePage.jsx
// already uses for a "Buy": POST /trade/buy (see buyTrade() in lib/api.js
// and backend/app/services/trading_service.py's own module comment for
// what it actually does). A convert is nothing more than a buy where the
// user thinks of it as "swapping" rather than "trading" — same simulated
// execution, same real balance movement (USDT debited, the chosen coin
// credited), same live price and 0.1% fee — so no new backend code exists
// or is needed for this screen; it's a relabeled, simplified TradeForm.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import CoinGlyph from "../components/CoinGlyph";
import Icon from "../components/Icon";
import SelectField from "../components/SelectField";
import { ErrorText, PrimaryButton } from "../components/FormControls";
import ConfirmSheet from "../components/ConfirmSheet";
import { useToast } from "../context/ToastContext";
import { buyTrade, getBalances, getTradePrice } from "../lib/api";

// Which coins USDT can be converted into — the base-asset half of
// TradePage.jsx's own PAIRS list (kept in sync BY HAND with that file,
// same as every other pair list in this app per TradePage's own comment
// on PAIRS — add a coin here AND to TradePage.jsx's PAIRS AND to the
// backend's trading_service.SUPPORTED_PAIRS together, or it either 400s
// here or this screen simply never offers converting into it).
const TO_ASSETS = ["BTC", "ETH", "SOL"];

// Same display-only fee preview TradePage.jsx computes — this never
// decides what actually executes (the backend always recomputes for real
// at submit time using its own FEE_RATE in trading_service.py), so a
// mismatch here would only ever produce a slightly-off preview number,
// never a wrong balance movement.
const FEE_RATE = 0.001;

export default function ConvertPage() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  const toast = useToast();

  const [toAsset, setToAsset] = useState(TO_ASSETS[0]);
  const [price, setPrice] = useState(null); // null = loading, a Decimal-string once loaded
  const [balances, setBalances] = useState(null);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  // Same two-step "form submit opens a sheet, the sheet's own button
  // actually executes" pattern TradePage.jsx and CreateBotPage.jsx both
  // use — see TradePage's own comment on confirmSnapshot for exactly why
  // a frozen snapshot is taken here rather than reading live state from
  // inside the sheet.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmSnapshot, setConfirmSnapshot] = useState(null);

  function refresh() {
    if (!accessToken) return;
    getTradePrice(accessToken, `${toAsset}/USDT`)
      .then((res) => setPrice(res.price))
      .catch(() => setPrice(null));
    getBalances(accessToken).then((res) => setBalances(res.balances));
  }

  useEffect(() => {
    refresh();
    // Same 15s live-price cadence TradePage.jsx and BotDetailPage.jsx
    // both already settled on.
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, toAsset]);

  // Switching which coin USDT converts into invalidates whatever amount
  // was typed against the OLD coin's price — same reasoning TradePage.jsx
  // applies when its pair or mode changes.
  useEffect(() => {
    setAmount("");
    setError(null);
  }, [toAsset]);

  const usdtBalance = balances?.find((b) => b.asset === "USDT")?.amount ?? "0";
  const priceNum = price !== null ? Number(price) : null;
  const amountNum = Number(amount) || 0;

  const preview =
    priceNum && amountNum > 0
      ? { fee: amountNum * FEE_RATE, receiveQty: (amountNum * (1 - FEE_RATE)) / priceNum }
      : null;

  function handleSubmit(e) {
    e.preventDefault();
    // Guards a stray Enter-key submit racing the button's own disabled
    // state, same as TradePage.jsx's identical guard.
    if (!preview) return;
    setError(null);
    setConfirmSnapshot({ qty: preview.receiveQty, totalUsdt: amountNum, price: priceNum });
    setConfirmOpen(true);
  }

  async function handleConfirmConvert() {
    setError(null);
    setSubmitting(true);
    try {
      await buyTrade(accessToken, `${toAsset}/USDT`, amount);
      setConfirmOpen(false);
      toast.success(t("convert.success", { qty: confirmSnapshot.qty.toFixed(6), asset: toAsset }));
      setAmount("");
      refresh();
    } catch (err) {
      // Left open (not setConfirmOpen(false)) so the sheet itself is where
      // the error surfaces — same reasoning as TradePage.jsx's identical
      // catch block.
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen justify-center px-5 py-8">
      <div className="w-full max-w-sm" style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
          <Link to="/" style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "16px", color: "var(--ink-base)", textDecoration: "none" }}>
            ←
          </Link>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "17px", color: "var(--ink-base)" }}>
            {t("convert.title")}
          </span>
        </div>

        <p style={{ fontFamily: "var(--font-body)", fontSize: "10.5px", color: "var(--ink-soft)", lineHeight: 1.5, margin: 0 }}>
          {t("convert.simulatedNotice", { feePct: "0.1%" })}
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          <FromCard amount={amount} onAmountChange={setAmount} usdtBalance={usdtBalance} t={t} />

          <SwapDivider />

          <ToCard toAsset={toAsset} onToAssetChange={setToAsset} preview={preview} price={priceNum} t={t} />

          {preview && (
            <span style={{ fontFamily: "var(--font-data)", fontSize: "10.5px", color: "var(--ink-soft)" }}>
              {t("convert.feeNotice", { feePct: "0.1%", amount: preview.fee.toFixed(4) })}
            </span>
          )}

          <PrimaryButton submitting={submitting} type="submit">
            {submitting ? t("convert.submitting") : t("convert.submit", { asset: toAsset })}
          </PrimaryButton>
        </form>

        <ConfirmSheet
          open={confirmOpen}
          onClose={() => {
            setConfirmOpen(false);
            setError(null);
          }}
          title={t("convert.confirmTitle", { amount: confirmSnapshot?.totalUsdt?.toFixed(2) })}
          body={
            <>
              {t("convert.confirmBody", {
                qty: confirmSnapshot?.qty?.toFixed(6),
                asset: toAsset,
                price: confirmSnapshot?.price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
              })}
              {error && (
                <div style={{ marginTop: "var(--space-4)" }}>
                  <ErrorText message={error} />
                </div>
              )}
            </>
          }
          cancelLabel={t("convert.confirmCancel")}
          confirmLabel={t("convert.confirmSubmit")}
          confirmingLabel={t("convert.confirmSubmitting")}
          confirming={submitting}
          onConfirm={handleConfirmConvert}
        />
      </div>
    </div>
  );
}

// The fixed "From" side — always USDT, so this is a display row (coin
// glyph + "USDT" + available balance) plus the amount input, rather than
// a picker the way ToCard below is.
function FromCard({ amount, onAmountChange, usdtBalance, t }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-5)",
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "14px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "11px", color: "var(--ink-soft)" }}>
          {t("convert.fromLabel")}
        </span>
        <button
          type="button"
          // "Max" fills the input with the full USDT balance as typed text
          // (not the raw Decimal string verbatim) so it round-trips cleanly
          // through the same `type="number"` input a user typing by hand
          // would produce.
          onClick={() => onAmountChange(String(Number(usdtBalance)))}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            fontFamily: "var(--font-body)",
            fontWeight: 600,
            fontSize: "11px",
            color: "var(--teal-base)",
            cursor: "pointer",
          }}
        >
          {t("convert.max")}
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}>
        <CoinGlyph asset="USDT" size={26} />
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
            flex: 1,
            background: "none",
            border: "none",
            padding: 0,
            fontFamily: "var(--font-data)",
            fontSize: "18px",
            color: "var(--ink-base)",
            outline: "none",
            textAlign: "right",
          }}
        />
      </div>

      <span style={{ fontFamily: "var(--font-data)", fontSize: "10.5px", color: "var(--ink-soft)" }}>
        {t("convert.available", { amount: usdtBalance })}
      </span>
    </div>
  );
}

// Purely decorative — direction is fixed (USDT -> toAsset always), so
// unlike Bybit's own Convert screen this isn't a tappable "flip" control,
// just the same visual beat between the two cards.
function SwapDivider() {
  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: "-10px", marginBottom: "-10px" }}>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: "var(--radius-full)",
          background: "var(--cream-base)",
          border: "3px solid var(--cream-base)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1,
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: "var(--radius-full)",
            background: "var(--teal-pale)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="convert" size={14} color="var(--teal-base)" />
        </div>
      </div>
    </div>
  );
}

function ToCard({ toAsset, onToAssetChange, preview, price, t }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-5)",
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "14px",
      }}
    >
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "11px", color: "var(--ink-soft)" }}>
        {t("convert.toLabel")}
      </span>

      <SelectField
        value={toAsset}
        options={TO_ASSETS}
        onChange={onToAssetChange}
        renderIcon={(asset) => <CoinGlyph asset={asset} size={22} />}
        renderTrigger={({ value, open }) => (
          <button
            type="button"
            onClick={open}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-5)",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              width: "100%",
            }}
          >
            <CoinGlyph asset={value} size={26} />
            <span style={{ fontFamily: "var(--font-body)", fontWeight: 700, fontSize: "15px", color: "var(--ink-base)" }}>{value}</span>
            <Icon name="chevronDown" size={16} color="var(--ink-soft)" />
            <span
              className="qx-num"
              style={{ flex: 1, textAlign: "right", fontFamily: "var(--font-data)", fontSize: "18px", color: "var(--ink-base)" }}
            >
              {preview ? preview.receiveQty.toFixed(6) : "0.00"}
            </span>
          </button>
        )}
      />

      <span style={{ fontFamily: "var(--font-data)", fontSize: "10.5px", color: "var(--ink-soft)" }}>
        {price === null ? t("convert.noPrice") : `1 ${toAsset} ≈ $${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
      </span>
    </div>
  );
}
