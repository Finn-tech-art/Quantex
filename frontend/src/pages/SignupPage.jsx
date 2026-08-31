import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import AnimatedPsi from "../components/AnimatedPsi";
import { Field, SelectField, ErrorText, PrimaryButton, Divider } from "../components/FormControls";
import GoogleButton from "../components/GoogleButton";
import { COUNTRIES } from "../data/countries";

// Built once, outside the component, from the shared COUNTRIES list — no
// need to recompute this array on every render since it never changes.
const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.code, label: c.name }));

export default function SignupPage() {
  const { t } = useTranslation();
  const { signup, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [country, setCountry] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signup(email, password, firstName, lastName, country);
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(err.message);
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
              fontSize: "32px",
              color: "var(--ink-base)",
              margin: 0,
            }}
          >
            {t("auth.signup.title")}
          </h1>
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "13px",
              color: "var(--ink-soft)",
              marginTop: "var(--space-4)",
            }}
          >
            {t("auth.signup.subtitle")}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}
        >
          <Field
            label={t("auth.firstNameLabel")}
            type="text"
            value={firstName}
            onChange={setFirstName}
            autoComplete="given-name"
          />
          <Field
            label={t("auth.lastNameLabel")}
            type="text"
            value={lastName}
            onChange={setLastName}
            autoComplete="family-name"
          />
          <Field
            label={t("auth.emailLabel")}
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
          />
          <Field
            label={t("auth.passwordLabel")}
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />
          <SelectField
            label={t("auth.countryLabel")}
            value={country}
            onChange={setCountry}
            options={COUNTRY_OPTIONS}
            placeholder={t("auth.countryPlaceholder")}
          />

          {error && <ErrorText message={error} />}

          <PrimaryButton submitting={submitting}>
            {t("auth.signup.submit")}
          </PrimaryButton>
        </form>

        <Divider label={t("auth.or")} />

        <GoogleButton onClick={handleGoogle}>
          {t("auth.continueWithGoogle")}
        </GoogleButton>

        <p style={{ textAlign: "center", fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--ink-soft)" }}>
          {t("auth.signup.haveAccount")}{" "}
          <Link to="/login" style={{ color: "var(--teal-base)", fontWeight: 600 }}>
            {t("auth.signup.logIn")}
          </Link>
        </p>
      </div>
    </div>
  );
}
