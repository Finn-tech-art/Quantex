import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import * as api from "../lib/api";
import { SelectField, ErrorText, PrimaryButton } from "./FormControls";
import { COUNTRY_OPTIONS } from "../data/countries";
import AnimatedPsi from "./AnimatedPsi";

// Rendered by ProtectedRoute.jsx in place of the actual screen whenever a
// signed-in user's profile has country = null — a fresh Google OAuth signup
// (that flow never passes through the SignupPage form at all, so it never
// collects one) or a pre-existing account from before country was collected.
// Blocking rather than dismissible is deliberate: it's the only reliable way
// to guarantee every account eventually has a country on file, which is what
// this whole field exists for (see 013_users_signup_fields.sql).
export default function CountryGate() {
  const { t } = useTranslation();
  const { accessToken, refreshUser } = useAuth();
  const [country, setCountry] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.setCountry(accessToken, country);
      // Pulls the freshly-saved country back into AuthContext's `user` —
      // ProtectedRoute re-renders right after this resolves and, seeing
      // user.country now set, swaps this gate out for the actual screen.
      await refreshUser();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div
        className="w-full max-w-sm"
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}
      >
        <div className="flex justify-center">
          <AnimatedPsi mode="static" size={40} color="var(--teal-base)" />
        </div>

        <div style={{ textAlign: "center" }}>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "28px",
              color: "var(--ink-base)",
              margin: 0,
            }}
          >
            {t("auth.completeProfile.title")}
          </h1>
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "13px",
              color: "var(--ink-soft)",
              marginTop: "var(--space-4)",
            }}
          >
            {t("auth.completeProfile.subtitle")}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}
        >
          <SelectField
            label={t("auth.countryLabel")}
            value={country}
            onChange={setCountry}
            options={COUNTRY_OPTIONS}
            placeholder={t("auth.countryPlaceholder")}
          />

          {error && <ErrorText message={error} />}

          <PrimaryButton submitting={submitting}>
            {submitting ? t("auth.completeProfile.submitting") : t("auth.completeProfile.submit")}
          </PrimaryButton>
        </form>
      </div>
    </div>
  );
}
