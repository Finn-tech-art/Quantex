import { useEffect, useRef, useState } from "react";
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
import { getActivity, getBalances } from "../lib/api";

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
  const [activity, setActivity] = useState(null);
  const activityRef = useRef(null);
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
    getActivity(accessToken).then((res) => setActivity(res.entries));
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
          onHistoryClick={() => activityRef.current?.scrollIntoView({ behavior: "smooth" })}
          t={t}
        />

        <KycStrip kycStatus={user?.kyc_status} t={t} />

        <AssetsSection balances={balances} t={t} />

        <div ref={activityRef}>
          <ActivitySection entries={activity} t={t} />
        </div>
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
      <Icon name="moreDots" size={18} color="var(--ink-soft)" />
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

function HeroCard({ displayValue, currency, onCurrencyChange, loading, onWithdrawClick, onHistoryClick, t }) {
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
        <span style={{ fontFamily: "var(--font-data)", fontWeight: 600, fontSize: "28px", color: "var(--on-accent)" }}>
          {currency === "USD"
            ? `$${displayValue.toFixed(decimals)}`
            : `${displayValue.toFixed(decimals)} ${currency}`}
        </span>
      )}

      <div style={{ display: "flex", gap: "var(--space-4)" }}>
        <Link to="/deposit" style={{ flex: 1, textDecoration: "none" }}>
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
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, display: "inline-block" }} />
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

function ActivitySection({ entries, t }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "14px", color: "var(--ink-base)" }}>
        {t("wallet.recentActivity")}
      </span>

      {entries === null ? (
        <AnimatedPsi mode="working" size={22} color="var(--teal-base)" />
      ) : entries.length === 0 ? (
        <EmptyLine text={t("wallet.noActivity")} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          {entries.map((e, i) => (
            <ActivityRow key={`${e.tx_hash || "internal"}-${i}`} entry={e} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

// `amount` comes straight from the ledger as a SIGNED decimal string
// (positive = credit, negative = debit — see ledger_entries.amount's own
// column comment in the schema) — the row that used to render this
// hardcoded a "+" in front of every entry regardless of sign, which for a
// debit like a withdrawal or fee produced a broken-looking "+-30.00"
// (a literal double sign) instead of just "-30.00". This version only
// adds "+" for an actual credit and otherwise trusts the string's own
// leading "-", and picks the row's icon/color from that same sign —
// exactly the deposit/withdrawal direction split TradePage's own
// TradeHistory rows already use, just generalized to every ledger entry
// type instead of only BUY/SELL.
function ActivityRow({ entry, t }) {
  const isCredit = Number(entry.amount) >= 0;
  const directionColor = isCredit ? "var(--gain)" : "var(--loss)";
  const typeLabel = t(`wallet.activityTypes.${entry.entry_type}`, { defaultValue: entry.entry_type });

  return (
    <div
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-6)",
      }}
    >
      {/* A soft tinted circle behind the direction arrow — same
          color-mix-off-a-token approach DeltaChip.jsx uses for its own
          background wash, so this stays correct in dark mode without a
          separate dark-mode override. */}
      <div
        style={{
          flexShrink: 0,
          width: 34,
          height: 34,
          borderRadius: "50%",
          background: `color-mix(in srgb, ${directionColor} 16%, transparent)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={isCredit ? "deposit" : "withdraw"} size={16} color={directionColor} />
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", color: "var(--ink-base)" }}>
          {typeLabel}
        </span>
        <span style={{ fontFamily: "var(--font-data)", fontSize: "9.5px", color: "var(--ink-soft)" }}>
          {new Date(entry.created_at).toLocaleString()}
          {/* Only entries that actually moved over a real chain (deposits,
              withdrawals) carry a network — internal ledger entries (fees,
              bot allocations, bonuses) have none, and previously showed a
              misleading literal "internal" here instead of just omitting
              it. */}
          {entry.network ? ` · ${entry.network}` : ""}
        </span>
      </div>

      <span style={{ fontFamily: "var(--font-data)", fontSize: "12.5px", color: directionColor, whiteSpace: "nowrap" }}>
        {isCredit ? "+" : ""}
        {entry.amount} {entry.asset}
      </span>
    </div>
  );
}

function EmptyLine({ text }) {
  return <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)" }}>{text}</span>;
}
