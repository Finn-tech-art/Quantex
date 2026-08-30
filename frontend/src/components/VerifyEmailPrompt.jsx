import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import * as api from "../lib/api";
import { ErrorText, PrimaryButton } from "./FormControls";

export default function VerifyEmailPrompt() {
  const { t } = useTranslation();
  const { accessToken, refreshUser } = useAuth();

  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSend() {
    setError(null);
    setSubmitting(true);
    try {
      await api.sendVerifyEmailOtp(accessToken);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.confirmVerifyEmailOtp(accessToken, code);
      await refreshUser();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        // Was a translucent white-on-dark overlay left over from when this
        // component lived directly inside HomePage's old teal-deep card —
        // it now renders straight on the plain page background (see
        // HomePage.jsx's rewrite), where that overlay was nearly invisible.
        // Normal surface tokens instead, same as every other standalone
        // card on the page — and unlike the old hardcoded rgba() values,
        // these correctly follow light/dark mode automatically.
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-8)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "12.5px",
          color: "var(--ink-base)",
          margin: 0,
        }}
      >
        {sent ? t("home.verifyEmail.sentBody") : t("home.verifyEmail.body")}
      </p>

      {error && <ErrorText message={error} />}

      {!sent ? (
        <PrimaryButton type="button" submitting={submitting} onClick={handleSend}>
          {t("home.verifyEmail.send")}
        </PrimaryButton>
      ) : (
        <form
          onSubmit={handleConfirm}
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}
        >
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("home.verifyEmail.codePlaceholder")}
            style={{
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.16)",
              borderRadius: "var(--radius-md)",
              padding: "13px 14px",
              fontFamily: "var(--font-data)",
              fontSize: "16px",
              letterSpacing: "0.2em",
              color: "var(--cream-base)",
              outline: "none",
              textAlign: "center",
            }}
          />
          <PrimaryButton submitting={submitting}>
            {t("home.verifyEmail.confirm")}
          </PrimaryButton>
          <button
            type="button"
            onClick={handleSend}
            disabled={submitting}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              fontFamily: "var(--font-body)",
              fontSize: "12px",
              color: "var(--teal-sage)",
              cursor: submitting ? "default" : "pointer",
            }}
          >
            {t("home.verifyEmail.resend")}
          </button>
        </form>
      )}
    </div>
  );
}
