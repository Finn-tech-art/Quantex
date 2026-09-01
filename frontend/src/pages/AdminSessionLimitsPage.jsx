// Free-tier session limits admin surface — lets an admin look up a user by
// email and raise their daily_session_limit above the out-of-the-box default
// (3) — see backend/app/services/session_limit_service.py's module comment
// for what that one number controls: both how many sessions a simulated bot
// can start per UTC day, AND (once above the default) whether that user is
// still capped at a 30-minute session length when creating a bot at all.
//
// Unlike AdminWinRatePage.jsx (which always has "today's" row to show the
// moment the page loads), there's no single row to show here until an admin
// actually looks someone up — this page is a two-step lookup-then-edit flow
// instead of the win-rate page's always-loaded single form.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "../context/AdminAuthContext";
import AdminNav from "../components/AdminNav";
import { ErrorText, PrimaryButton } from "../components/FormControls";
import { getSessionLimit, setSessionLimit } from "../lib/api";

export default function AdminSessionLimitsPage() {
  const { t } = useTranslation();
  const { admin, adminToken, logout } = useAdminAuth();

  const [emailInput, setEmailInput] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState(null);

  // null until a lookup succeeds — the shape returned by GET
  // /admin/session-limits/{email}: {user_id, email, daily_session_limit, is_default}.
  const [current, setCurrent] = useState(null);
  const [limitInput, setLimitInput] = useState("");
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedJustNow, setSavedJustNow] = useState(false);

  async function handleLookup(e) {
    e.preventDefault();
    setLookupError(null);
    setSavedJustNow(false);
    setLookingUp(true);
    try {
      const res = await getSessionLimit(adminToken, emailInput.trim());
      setCurrent(res);
      setLimitInput(String(res.daily_session_limit));
    } catch (err) {
      setCurrent(null);
      setLookupError(err.message);
    } finally {
      setLookingUp(false);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaveError(null);
    setSavedJustNow(false);

    const limit = Number(limitInput);
    if (!Number.isInteger(limit) || limit < 0) {
      setSaveError("Daily session limit must be a whole number >= 0.");
      return;
    }

    setSaving(true);
    try {
      const res = await setSessionLimit(adminToken, { email: current.email, dailySessionLimit: limit });
      setCurrent(res);
      setSavedJustNow(true);
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
            {t("admin.sessionLimits.title")}
          </span>
          <button
            type="button"
            onClick={logout}
            style={{ background: "none", border: "none", fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)", cursor: "pointer" }}
          >
            {t("admin.sessionLimits.logout")}
          </button>
        </div>

        {admin && (
          <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", color: "var(--ink-soft)" }}>{admin.email}</span>
        )}

        <AdminNav />

        <span style={{ fontFamily: "var(--font-body)", fontSize: "11.5px", color: "var(--ink-soft)", lineHeight: 1.5 }}>
          {t("admin.sessionLimits.intro")}
        </span>

        <form onSubmit={handleLookup} style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <TextField
            label={t("admin.sessionLimits.emailLabel")}
            value={emailInput}
            onChange={setEmailInput}
            type="email"
          />
          {lookupError && <ErrorText message={lookupError} />}
          <PrimaryButton submitting={lookingUp}>
            {lookingUp ? t("admin.sessionLimits.lookingUp") : t("admin.sessionLimits.lookUp")}
          </PrimaryButton>
        </form>

        {current && (
          <>
            <CurrentStatusCard current={current} t={t} />

            <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
              <NumberField
                label={t("admin.sessionLimits.limitLabel")}
                hint={t("admin.sessionLimits.limitHint")}
                value={limitInput}
                onChange={setLimitInput}
              />

              {saveError && <ErrorText message={saveError} />}
              {savedJustNow && !saveError && (
                <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--gain)" }}>
                  {t("admin.sessionLimits.saved")}
                </span>
              )}

              <PrimaryButton submitting={saving}>
                {saving ? t("admin.sessionLimits.saving") : t("admin.sessionLimits.submit")}
              </PrimaryButton>
            </form>
          </>
        )}
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
        {current.email.toUpperCase()}
      </span>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-6)" }}>
        <span style={{ fontFamily: "var(--font-data)", fontWeight: 600, fontSize: "28px", color: "var(--on-accent)" }}>
          {current.daily_session_limit}
        </span>
        <span style={{ fontFamily: "var(--font-data)", fontSize: "11px", color: "var(--teal-sage)" }}>
          {t("admin.sessionLimits.perDay")}
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
        {current.is_default ? t("admin.sessionLimits.defaultBadge") : t("admin.sessionLimits.setBadge")}
      </span>
    </div>
  );
}

function TextField({ label, value, onChange, type = "text" }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "11px", color: "var(--ink-soft)" }}>
        {label}
      </span>
      <input
        type={type}
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
    </label>
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
        step="1"
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
