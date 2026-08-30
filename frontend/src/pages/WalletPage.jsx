import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AnimatedPsi from "../components/AnimatedPsi";
import Icon from "../components/Icon";
import CoinGlyph from "../components/CoinGlyph";
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

  useEffect(() => {
    if (!accessToken) return;
    getBalances(accessToken).then((res) => setBalances(res.balances));
    getActivity(accessToken).then((res) => setActivity(res.entries));
  }, [accessToken]);

  const totalUsd = (balances || []).reduce((sum, b) => sum + Number(b.amount), 0);

  return (
    <div style={{ paddingTop: "var(--space-11)" }}>
      <div style={{ maxWidth: 384, margin: "0 auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <TopNav t={t} />

        <HeroCard
          totalUsd={totalUsd}
          loading={balances === null}
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

function HeroCard({ totalUsd, loading, onWithdrawClick, onHistoryClick, t }) {
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

      {loading ? (
        <AnimatedPsi mode="working" size={26} color="var(--on-accent)" />
      ) : (
        <span style={{ fontFamily: "var(--font-data)", fontWeight: 600, fontSize: "28px", color: "var(--on-accent)" }}>
          ${totalUsd.toFixed(2)}
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
            <div
              key={`${e.tx_hash || "internal"}-${i}`}
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
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", color: "var(--ink-base)" }}>
                  {e.entry_type} · {e.network || "internal"}
                </span>
                <span style={{ fontFamily: "var(--font-data)", fontSize: "9.5px", color: "var(--ink-soft)" }}>
                  {new Date(e.created_at).toLocaleString()}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "var(--space-2)" }}>
                <span style={{ fontFamily: "var(--font-data)", fontSize: "12.5px", color: "var(--ink-base)" }}>
                  +{e.amount} {e.asset}
                </span>
                <span
                  style={{
                    background: "var(--teal-pale)",
                    color: "var(--teal-deep)",
                    borderRadius: "var(--radius-sm)",
                    padding: "2px 7px",
                    fontFamily: "var(--font-data)",
                    fontWeight: 600,
                    fontSize: "8.5px",
                  }}
                >
                  {t("wallet.completed").toUpperCase()}
                </span>
              </div>
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
