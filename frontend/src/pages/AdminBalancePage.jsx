// Admin manual balance adjustment — lets an admin look up a user by email
// and credit (or debit) their USDT balance directly, through the same
// ledger system every other balance-affecting action in this app uses (see
// backend/app/services/admin_balance_service.py's module comment). Most
// commonly used to hand a fresh test account (one that hasn't made a real
// deposit yet, still sitting at 0) a starting balance so it can actually
// create a bot.
//
// Same two-step lookup-then-edit shape AdminSessionLimitsPage.jsx already
// uses, since there's no single row to show here until an admin actually
// looks someone up.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "../context/AdminAuthContext";
import AdminNav from "../components/AdminNav";
import { ErrorText, PrimaryButton } from "../components/FormControls";
import { adjustUserBalance, getUserBalance } from "../lib/api";

export default function AdminBalancePage() {
  const { t } = useTranslation();
  const { admin, adminToken, logout } = useAdminAuth();

  const [emailInput, setEmailInput] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState(null);

  // null until a lookup succeeds — the shape returned by GET
  // /admin/balance/{email}: {user_id, email, balance}.
  const [current, setCurrent] = useState(null);
  const [amountInput, setAmountInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedJustNow, setSavedJustNow] = useState(false);

  async function handleLookup(e) {
    e.preventDefault();
    setLookupError(null);
    setSavedJustNow(false);
    setLookingUp(true);
    try {
      const res = await getUserBalance(adminToken, emailInput.trim());
      setCurrent(res);
    } catch (err) {
      setCurrent(null);
      setLookupError(err.message);
    } finally {
      setLookingUp(false);
    }
  }

  async function handleAdjust(e) {
    e.preventDefault();
    setSaveError(null);
    setSavedJustNow(false);

    const amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount === 0) {
      setSaveError(t("admin.balance.amountInvalid"));
      return;
    }

    setSaving(true);
    try {
      const res = await adjustUserBalance(adminToken, { email: current.email, amount: amountInput, note: noteInput });
      setCurrent(res);
      if (res.applied) {
        setSavedJustNow(true);
        setAmountInput("");
        setNoteInput("");
      } else {
        setSaveError(t("admin.balance.insufficientBalance"));
      }
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen justify-center px-5 py-8">
      <div className="w-full max-w-sm" style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "17px", color: "var(--ink-base)" }}>
            {t("admin.balance.title")}
          </span>
          <button
            type="button"
            onClick={logout}
            style={{ background: "none", border: "none", fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)", cursor: "pointer" }}
          >
            {t("admin.balance.logout")}
          </button>
        </div>

        {admin && (
          <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", color: "var(--ink-soft)" }}>{admin.email}</span>
        )}

        <AdminNav />

        <span style={{ fontFamily: "var(--font-body)", fontSize: "11.5px", color: "var(--ink-soft)", lineHeight: 1.5 }}>
          {t("admin.balance.intro")}
        </span>

        <form onSubmit={handleLookup} style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <TextField
            label={t("admin.balance.emailLabel")}
            value={emailInput}
            onChange={setEmailInput}
            type="email"
          />
          {lookupError && <ErrorText message={lookupError} />}
          <PrimaryButton submitting={lookingUp}>
            {lookingUp ? t("admin.balance.lookingUp") : t("admin.balance.lookUp")}
          </PrimaryButton>
        </form>

        {current && (
          <>
            <CurrentStatusCard current={current} />

            <form onSubmit={handleAdjust} style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
              <TextField
                label={t("admin.balance.amountLabel")}
                hint={t("admin.balance.amountHint")}
                value={amountInput}
                onChange={setAmountInput}
                type="number"
              />
              <TextField
                label={t("admin.balance.noteLabel")}
                value={noteInput}
                onChange={setNoteInput}
                required={false}
              />

              {saveError && <ErrorText message={saveError} />}
              {savedJustNow && !saveError && (
                <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--gain)" }}>
                  {t("admin.balance.saved")}
                </span>
              )}

              <PrimaryButton submitting={saving}>
                {saving ? t("admin.balance.saving") : t("admin.balance.submit")}
              </PrimaryButton>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function CurrentStatusCard({ current }) {
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
        {current.email.toUpperCase()}
      </span>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-6)" }}>
        <span style={{ fontFamily: "var(--font-data)", fontWeight: 600, fontSize: "28px", color: "var(--on-accent)" }}>
          {current.balance}
        </span>
        <span style={{ fontFamily: "var(--font-data)", fontSize: "11px", color: "var(--teal-sage)" }}>
          USDT
        </span>
      </div>
    </div>
  );
}

function TextField({ label, hint, value, onChange, type = "text", required = true }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "11px", color: "var(--ink-soft)" }}>
        {label}
      </span>
      <input
        type={type}
        required={required}
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
      {hint && (
        <span style={{ fontFamily: "var(--font-body)", fontSize: "10.5px", color: "var(--ink-soft)" }}>{hint}</span>
      )}
    </label>
  );
}
