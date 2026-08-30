// The whole Module 2 admin surface: shows today's scripted win rate (what
// every simulated bot session and the demo session currently resolve to —
// see backend/app/services/win_rate_service.py) and lets an admin overwrite
// it for today. No date picker here on purpose — "set a rate for a future
// date" is possible on the backend (PUT /admin/win-rate accepts win_date)
// but this page only ever exercises "today", which is the only thing that
// actually affects anything live right now.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "../context/AdminAuthContext";
import AdminNav from "../components/AdminNav";
import AnimatedPsi from "../components/AnimatedPsi";
import { ErrorText, PrimaryButton } from "../components/FormControls";
import { getWinRate, setWinRate } from "../lib/api";

export default function AdminWinRatePage() {
  const { t } = useTranslation();
  const { admin, adminToken, logout } = useAdminAuth();

  const [current, setCurrent] = useState(null); // null = still loading
  const [winRateInput, setWinRateInput] = useState("");
  const [targetReturnInput, setTargetReturnInput] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedJustNow, setSavedJustNow] = useState(false);

  function refresh() {
    if (!adminToken) return;
    getWinRate(adminToken).then((res) => {
      setCurrent(res);
      setWinRateInput(String(res.win_rate));
      setTargetReturnInput(String(res.target_min_return));
    });
  }

  useEffect(refresh, [adminToken]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSavedJustNow(false);

    const winRate = Number(winRateInput);
    const targetReturn = Number(targetReturnInput);
    if (Number.isNaN(winRate) || winRate < 0 || winRate > 1) {
      setError("Win rate must be a number between 0 and 1.");
      return;
    }
    if (Number.isNaN(targetReturn) || targetReturn < 0) {
      setError("Target min return must be a number >= 0.");
      return;
    }

    setSaving(true);
    try {
      const res = await setWinRate(adminToken, { winRate, targetMinReturn: targetReturn });
      setCurrent(res);
      setSavedJustNow(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (current === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <AnimatedPsi mode="working" size={30} color="var(--teal-base)" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen justify-center px-5 py-8">
      <div className="w-full max-w-sm" style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "17px", color: "var(--ink-base)" }}>
            {t("admin.winRate.title")}
          </span>
          <button
            type="button"
            onClick={logout}
            style={{ background: "none", border: "none", fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)", cursor: "pointer" }}
          >
            {t("admin.winRate.logout")}
          </button>
        </div>

        {admin && (
          <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", color: "var(--ink-soft)" }}>{admin.email}</span>
        )}

        <AdminNav />

        <CurrentStatusCard current={current} t={t} />

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <NumberField
            label={t("admin.winRate.winRateLabel")}
            hint={t("admin.winRate.winRateHint")}
            value={winRateInput}
            onChange={setWinRateInput}
          />
          <NumberField
            label={t("admin.winRate.targetReturnLabel")}
            hint={t("admin.winRate.targetReturnHint")}
            value={targetReturnInput}
            onChange={setTargetReturnInput}
          />

          {error && <ErrorText message={error} />}
          {savedJustNow && !error && (
            <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--gain)" }}>
              {t("admin.winRate.saved")}
            </span>
          )}

          <PrimaryButton submitting={saving}>
            {saving ? t("admin.winRate.saving") : t("admin.winRate.submit")}
          </PrimaryButton>
        </form>
      </div>
    </div>
  );
}

function CurrentStatusCard({ current, t }) {
  return (
    <div
      style={{
        background: "var(--teal-deep)",
        borderRadius: "var(--radius-2xl)",
        padding: "var(--space-11)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
      }}
    >
      <span style={{ fontFamily: "var(--font-data)", fontSize: "9px", letterSpacing: "0.08em", color: "var(--teal-sage)" }}>
        {t("admin.winRate.currentLabel").toUpperCase()}
      </span>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-6)" }}>
        <span style={{ fontFamily: "var(--font-data)", fontWeight: 600, fontSize: "28px", color: "var(--on-accent)" }}>
          {(current.win_rate * 100).toFixed(0)}%
        </span>
        <span style={{ fontFamily: "var(--font-data)", fontSize: "11px", color: "var(--teal-sage)" }}>
          win rate · {(current.target_min_return * 100).toFixed(0)}% min return
        </span>
      </div>
      <span
        style={{
          fontFamily: "var(--font-data)",
          fontSize: "8.5px",
          letterSpacing: "0.05em",
          color: current.is_default ? "var(--warning-text)" : "var(--gain-on-dark)",
        }}
      >
        {current.is_default ? t("admin.winRate.defaultBadge") : t("admin.winRate.setBadge")}
      </span>
    </div>
  );
}

function NumberField({ label, hint, value, onChange }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "11px", color: "var(--ink-soft)" }}>
        {label}
      </span>
      <input
        type="number"
        step="0.01"
        min="0"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "var(--cream-deep)",
          border: "1px solid var(--cream-line)",
          borderRadius: "var(--radius-md)",
          padding: "13px 14px",
          fontFamily: "var(--font-body)",
          fontSize: "13px",
          color: "var(--ink-base)",
          outline: "none",
        }}
      />
      <span style={{ fontFamily: "var(--font-body)", fontSize: "10.5px", color: "var(--ink-soft)" }}>{hint}</span>
    </label>
  );
}
