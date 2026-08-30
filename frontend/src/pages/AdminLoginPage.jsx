// Mirrors LoginPage.jsx's shape but posts to the separate admin credential
// (see AdminAuthContext.jsx) — this is NOT the same login as a regular
// platform user, and the two sessions never interact.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "../context/AdminAuthContext";
import AnimatedPsi from "../components/AnimatedPsi";
import { Field, ErrorText, PrimaryButton } from "../components/FormControls";

export default function AdminLoginPage() {
  const { t } = useTranslation();
  const { login } = useAdminAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate("/admin/win-rate");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div className="w-full max-w-sm" style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
        <div className="flex justify-center">
          <AnimatedPsi mode="static" size={40} color="var(--teal-base)" />
        </div>

        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "28px", color: "var(--ink-base)", margin: 0 }}>
            {t("admin.login.title")}
          </h1>
          <p style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--ink-soft)", marginTop: "var(--space-4)" }}>
            {t("admin.login.subtitle")}
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <Field label={t("auth.emailLabel")} type="email" value={email} onChange={setEmail} autoComplete="username" />
          <Field label={t("auth.passwordLabel")} type="password" value={password} onChange={setPassword} autoComplete="current-password" />

          {error && <ErrorText message={error} />}

          <PrimaryButton submitting={submitting}>{t("admin.login.submit")}</PrimaryButton>
        </form>
      </div>
    </div>
  );
}
