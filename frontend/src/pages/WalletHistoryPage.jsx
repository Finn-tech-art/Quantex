// The full ledger activity list — was an inline "Recent activity" section at
// the bottom of WalletPage.jsx (capped at whatever wallet_service.
// get_recent_activity's own `limit` default returns, currently 20 — this
// page doesn't change that cap, it only moves the SAME list off the main
// Wallet screen onto its own pushed page, reached via the paper/"history"
// icon in WalletPage's TopNav or the History pill on its HeroCard). Pushed
// (not a tab-root screen), same back-chevron header shape as DepositPage.jsx/
// KycPage.jsx/CreateBotPage.jsx use for their own pushed screens.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AnimatedPsi from "../components/AnimatedPsi";
import Icon from "../components/Icon";
import { getActivity } from "../lib/api";

export default function WalletHistoryPage() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    if (!accessToken) return;
    getActivity(accessToken).then((res) => setEntries(res.entries));
  }, [accessToken]);

  return (
    <div style={{ paddingTop: "var(--space-11)" }}>
      <div className="w-full max-w-sm" style={{ maxWidth: 384, margin: "0 auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <TopNav t={t} />

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
    </div>
  );
}

function TopNav({ t }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
      <Link to="/wallet" style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "16px", color: "var(--ink-base)", textDecoration: "none" }}>
        ←
      </Link>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "17px", color: "var(--ink-base)" }}>
        {t("wallet.history")}
      </span>
    </div>
  );
}

// Moved here verbatim from WalletPage.jsx's own former ActivityRow — see
// that component's git history for the reasoning comments on the
// isCredit/sign handling and the network-suffix line, unchanged here.
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
