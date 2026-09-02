import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AnimatedPsi from "../components/AnimatedPsi";
import Icon from "../components/Icon";
import CoinGlyph from "../components/CoinGlyph";
import CurrencyPicker from "../components/CurrencyPicker";
import useAssetPrices from "../hooks/useAssetPrices";
import useDisplayCurrency from "../hooks/useDisplayCurrency";
import { convertUsdTo, totalUsdValue } from "../lib/currency";
import { getBalances } from "../lib/api";

const KYC_DOT_COLOR = {
  APPROVED: "var(--gain)",
  PENDING: "var(--pending-dot)",
  UNDER_REVIEW: "var(--pending-dot)",
  REJECTED: "var(--loss)",
  UNSUBMITTED: "var(--ink-soft)",
};

export default function WalletPage() {
  const { t } = useTranslation();
  const { accessToken, user } = useAuth();
  const navigate = useNavigate();
  const [balances, setBalances] = useState(null);
  // Live USD price per asset — see lib/currency.js's module comment for
  // why summing raw balance quantities 1:1 (the old `totalUsd` line just
  // below used to do exactly that) undercounts any non-stablecoin
  // balance, and useAssetPrices.js for where this comes from.
  const prices = useAssetPrices(accessToken);
  // Shared with HomePage's identical picker via localStorage — see
  // useDisplayCurrency.js.
  const [currency, setCurrency] = useDisplayCurrency();

  useEffect(() => {
    if (!accessToken) return;
    getBalances(accessToken).then((res) => setBalances(res.balances));
  }, [accessToken]);

  // null (not a wrong number) until balances have loaded AND every held
  // asset is priced — see totalUsdValue()'s own doc comment.
  const totalUsd = balances ? totalUsdValue(balances, prices) : null;
  // The figure HeroCard actually shows — totalUsd itself for "USD", or
  // that total divided by the chosen coin's live price otherwise.
  const displayValue = convertUsdTo(totalUsd, currency, prices);

  return (
    <div style={{ paddingTop: "var(--space-11)" }}>
      <div style={{ maxWidth: 384, margin: "0 auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <TopNav t={t} />

        <HeroCard
          displayValue={displayValue}
          totalUsd={totalUsd}
          currency={currency}
          onCurrencyChange={setCurrency}
          loading={displayValue === null}
          // Withdraw's destination depends on KYC status, exactly like the
          // KycStrip link below it: an APPROVED user goes straight to the
          // withdrawal form, anyone else is sent to start/check KYC instead
          // (that screen explains why withdrawals are locked) — see
          // WithdrawPage.jsx's own defensive KYC check for the second half
          // of this gate, in case this route is ever opened directly.
          onWithdrawClick={() => navigate(user?.kyc_status === "APPROVED" ? "/withdraw" : "/kyc")}
          onHistoryClick={() => navigate("/wallet/history")}
          t={t}
        />

        <KycStrip kycStatus={user?.kyc_status} t={t} />

        <AssetsSection balances={balances} t={t} />
      </div>
    </div>
  );
}

// No back chevron here anymore — Wallet is a tab-root screen reached
// straight off the bottom nav now (see App.jsx's AppShell route group),
// not a pushed screen you navigate back out of, so it drops the "←" a
// pushed screen like KycPage or DepositPage still uses.
function TopNav({ t }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "18px", color: "var(--ink-base)" }}>
        {t("wallet.title")}
      </span>
      {/* Opens WalletHistoryPage.jsx — the full ledger activity list that
          used to render inline at the bottom of this page as "Recent
          activity" (see that page's own module comment). The overflow
          "···" menu that used to sit next to this was removed — it had
          no menu behind it, so it was just a dead icon taking up space. */}
      <Link to="/wallet/history" style={{ display: "flex" }}>
        <Icon name="history" size={18} color="var(--ink-soft)" />
      </Link>
    </div>
  );
}

function ActionPill({ label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      title={disabled ? "Coming soon" : undefined}
      style={{
        flex: 1,
        background: "rgba(255,255,255,0.12)",
        color: disabled ? "var(--teal-sage)" : "var(--on-accent)",
        border: "none",
        borderRadius: "var(--radius-md)",
        padding: "10px 8px",
        fontFamily: "var(--font-body)",
        fontWeight: 600,
        fontSize: "12px",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}

function HeroCard({ displayValue, totalUsd, currency, onCurrencyChange, loading, onWithdrawClick, onHistoryClick, t }) {
  // Coin-equivalent amounts need more decimal places than a dollar figure
  // to read as meaningful (e.g. "0.001846 BTC" rather than "0.00 BTC") —
  // same threshold HomePage's own BalanceFigure uses.
  const decimals = currency === "USD" ? 2 : 6;

  return (
    <div
      style={{
        background: "var(--teal-deep)",
        borderRadius: "var(--radius-2xl)",
        padding: "var(--space-11)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-8)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontFamily: "var(--font-data)",
            fontSize: "9px",
            letterSpacing: "0.08em",
            color: "var(--teal-sage)",
          }}
        >
          {t("wallet.totalBalance").toUpperCase()}
        </span>
        <CurrencyPicker currency={currency} onChange={onCurrencyChange} />
      </div>

      {loading ? (
        <AnimatedPsi mode="working" size={26} color="var(--on-accent)" />
      ) : (
        // Grouped in its own tight-gap column, separate from the card's
        // own outer gap (var(--space-8) between this group and the
        // Deposit/Withdraw/History row below) — the balance figure and
        // its "≈ X USDT" caption read as one unit, sitting close
        // together, rather than getting the same breathing room as the
        // card's other, unrelated rows. Lower this gap further to pull
        // them closer still.
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          <span style={{ fontFamily: "var(--font-data)", fontWeight: 600, fontSize: "28px", color: "var(--on-accent)" }}>
            {currency === "USD"
              ? `$${displayValue.toFixed(decimals)}`
              : `${displayValue.toFixed(decimals)} ${currency}`}
          </span>

          {/* Bybit-style "≈ X USDT" caption — always the live USD/USDT
              total (see totalUsdValue() in lib/currency.js, and that
              file's STABLECOIN_ASSETS treating USDT 1:1 with USD),
              regardless of which currency the picker above is set to.
              Ticks on its own every time useAssetPrices' poll lands a
              fresh price map (see that hook's own comment). `totalUsd`
              can still be null for a tick after balances resolve if it's
              waiting on one more asset's price, so this is gated
              separately from `loading` rather than assumed ready
              whenever displayValue is. */}
          {totalUsd != null && (
            <span style={{ fontFamily: "var(--font-data)", fontSize: "11px", color: "var(--teal-sage)" }}>
              {t("wallet.equivalent", {
                amount: totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
              })}
            </span>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-4)" }}>
        {/* `display: "flex"` here (on top of `flex: 1`) matters: without it
            this <Link> is just a block box that happens to be 1/3 of the
            row's width, and the ActionPill button inside it — which isn't
            itself a flex item of the row, only a normal child of the Link —
            would shrink-wrap its text instead of filling that width. Making
            the Link a flex container of its own lets the button's `flex: 1`
            (set inside ActionPill) stretch to fill it, so the colored pill
            matches the Withdraw/History pills instead of leaving a gap. */}
        <Link to="/deposit" style={{ flex: 1, display: "flex", textDecoration: "none" }}>
          <ActionPill label={t("wallet.deposit")} />
        </Link>
        <ActionPill label={t("wallet.withdraw")} onClick={onWithdrawClick} />
        <ActionPill label={t("wallet.history")} onClick={onHistoryClick} />
      </div>
    </div>
  );
}

function KycStrip({ kycStatus, t }) {
  const dotColor = KYC_DOT_COLOR[kycStatus] || "var(--ink-soft)";
  return (
    <Link
      to="/kyc"
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        textDecoration: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}>
        {/* Same 28px icon-chip pattern NotificationBell.jsx already uses
            for its own KYC row (circle background + centered Icon, tinted
            by status color) — swapped in here for the plain colored dot
            this used to be, so the strip reads as "identity verification"
            at a glance instead of just an unlabeled status light. `shield`
            is the same glyph already used for KYC everywhere else in the
            app (NotificationBell's KYC_APPROVED entry, MenuPage's KYC
            item), so this doesn't introduce a new icon-to-meaning mapping
            — just brings this one screen in line with the other two. */}
        <div
          style={{
            width: 22,
            height: 22,
            flexShrink: 0,
            borderRadius: "var(--radius-full)",
            background: "var(--cream-line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="shield" size={12} color={dotColor} />
        </div>
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "12.5px", color: "var(--ink-base)" }}>
          {t("wallet.kycPrefix")} {kycStatus || "…"}
        </span>
      </div>
      <span
        style={{
          fontFamily: "var(--font-data)",
          fontSize: "9.5px",
          letterSpacing: "0.06em",
          color: "var(--teal-base)",
        }}
      >
        {t("wallet.checkStatus").toUpperCase()}
      </span>
    </Link>
  );
}

function AssetsSection({ balances, t }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "14px", color: "var(--ink-base)" }}>
        {t("wallet.assets")}
      </span>

      {balances === null ? (
        <AnimatedPsi mode="working" size={22} color="var(--teal-base)" />
      ) : balances.length === 0 ? (
        <EmptyLine text={t("wallet.noAssets")} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          {balances.map((b) => (
            <div
              key={b.asset}
              style={{
                background: "var(--cream-deep)",
                border: "1px solid var(--cream-line)",
                borderRadius: "var(--radius-lg)",
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
                <CoinGlyph asset={b.asset} />
                <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", color: "var(--ink-base)" }}>
                  {b.asset}
                </span>
              </div>
              <span style={{ fontFamily: "var(--font-data)", fontSize: "12.5px", color: "var(--ink-base)" }}>
                {b.amount}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyLine({ text }) {
  return <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)" }}>{text}</span>;
}
