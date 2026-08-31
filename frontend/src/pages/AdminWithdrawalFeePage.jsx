// Lets an admin change the flat fee charged on every withdrawal, at any
// time, with no redeploy — see backend/app/services/withdrawal_fee_service.py
// for the full design. Mirrors AdminWinRatePage.jsx's shape closely (both
// are "show the current admin-set value, let it be overwritten" screens),
// just with a single fee amount instead of a rate + target return pair, and
// no date scoping — there's only ever one "current" fee, applied to whatever
// withdrawal gets requested next (see that service module's comment on why
// a change never touches withdrawals already requested).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "../context/AdminAuthContext";
import AdminNav from "../components/AdminNav";
import AnimatedPsi from "../components/AnimatedPsi";
import { ErrorText, PrimaryButton } from "../components/FormControls";
import { getWithdrawalFee, setWithdrawalFee } from "../lib/api";

export default function AdminWithdrawalFeePage() {
  const { t } = useTranslation();
  const { admin, adminToken, logout } = useAdminAuth();

  const [current, setCurrent] = useState(null); // null = still loading
  const [feeInput, setFeeInput] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedJustNow, setSavedJustNow] = useState(false);

  function refresh() {
    if (!adminToken) return;
    getWithdrawalFee(adminToken).then((res) => {
      setCurrent(res);
      setFeeInput(res.fee_amount);
    });
  }

  useEffect(refresh, [adminToken]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSavedJustNow(false);

    // Kept as a plain string all the way to the backend (see
    // lib/api.js's setWithdrawalFee) — this Number() call is only a
    // client-side sanity check before sending, never what actually gets
    // posted, so it never introduces float rounding into the real value.
    const feeNumber = Number(feeInput);
    if (Number.isNaN(feeNumber) || feeNumber < 0) {
      setError("Fee must be a number >= 0.");
      return;
    }

    setSaving(true);
    try {
      const res = await setWithdrawalFee(adminToken, feeInput);
      setCurrent(res);
      setFeeInput(res.fee_amount);
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
            {t("admin.withdrawalFee.title")}
          </span>
          <button
            type="button"
            onClick={logout}
            style={{ background: "none", border: "none", fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)", cursor: "pointer" }}
          >
            {t("admin.withdrawalFee.logout")}
          </button>
        </div>

        {admin && (
          <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", color: "var(--ink-soft)" }}>{admin.email}</span>
        )}

        <AdminNav />

        <CurrentStatusCard current={current} t={t} />

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <NumberField
            label={t("admin.withdrawalFee.feeLabel")}
            hint={t("admin.withdrawalFee.feeHint")}
            value={feeInput}
            onChange={setFeeInput}
          />

          {error && <ErrorText message={error} />}
          {savedJustNow && !error && (
            <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--gain)" }}>
              {t("admin.withdrawalFee.saved")}
            </span>
          )}

          <PrimaryButton submitting={saving}>
            {saving ? t("admin.withdrawalFee.saving") : t("admin.withdrawalFee.submit")}
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
        {t("admin.withdrawalFee.currentLabel").toUpperCase()}
      </span>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-6)" }}>
        <span style={{ fontFamily: "var(--font-data)", fontWeight: 600, fontSize: "28px", color: "var(--on-accent)" }}>
          {current.fee_amount}
        </span>
        <span style={{ fontFamily: "var(--font-data)", fontSize: "11px", color: "var(--teal-sage)" }}>
          {t("admin.withdrawalFee.perWithdrawal")}
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
        {current.is_default ? t("admin.withdrawalFee.defaultBadge") : t("admin.withdrawalFee.setBadge")}
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
