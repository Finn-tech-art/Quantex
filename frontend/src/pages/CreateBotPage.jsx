// Module 4's user-facing creation form — the only kind of bot a user can
// self-serve create right now is a simulated (scripted) one; see
// routers/bots.py's module comment for why there's still no real-Grid
// creation endpoint. Submitting navigates straight to the new bot's detail
// page, which already renders a simulated bot correctly (BotDetailPage.jsx
// never assumed grid-only fields — see that file for confirmation).

import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import CoinGlyph from "../components/CoinGlyph";
import SelectField from "../components/SelectField";
import { ErrorText, PrimaryButton } from "../components/FormControls";
import { createBot } from "../lib/api";

// The only pairs a scripted bot can actually run on — a bot's pair has to
// exist in market_data_feed.py's TRACKED_SYMBOLS (mirrored here exactly
// like TradePage.jsx's own PAIRS list already has to be, per that file's
// comment) or bot_engine.py's sweep just silently never finds a price for
// it and the bot never trades. This used to be a free-text field a user
// could type ANYTHING into — including a pair that would create a bot
// stuck doing nothing forever — which is why this is now a constrained
// dropdown instead. Add a pair here AND to TradePage.jsx's PAIRS AND to
// the backend's trading_service.SUPPORTED_PAIRS AND
// market_data_feed.TRACKED_SYMBOLS together, or it either 400s or silently
// never runs.
const PAIRS = ["BTC/USDT", "ETH/USDT", "SOL/USDT"];

function baseAsset(pair) {
  return pair.split("/")[0];
}

export default function CreateBotPage() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  const navigate = useNavigate();

  const [pair, setPair] = useState(PAIRS[0]);
  const [allocationAmount, setAllocationAmount] = useState("100");
  const [sessionLengthMinutes, setSessionLengthMinutes] = useState("10");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await createBot(accessToken, {
        pair,
        allocationAmount, // stays a string all the way to the backend — see api.js's comment
        sessionLengthMinutes: Number(sessionLengthMinutes),
        // No intervalSeconds passed here on purpose — this used to be a
        // "Minutes between sessions" field the user could edit, but
        // nothing in this form's flow actually surfaced what changing it
        // did (it's a non-functional control for now), so it's been
        // removed rather than left on screen doing nothing visible.
        // Omitting it lets createBot()'s own default (900s / 15 minutes,
        // matching the backend's own CreateSimulatedBotRequest default in
        // models/bot.py) apply instead.
      });
      navigate(`/bots/${res.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen justify-center px-5 py-8">
      <div className="w-full max-w-sm" style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
          <Link to="/bots" style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "16px", color: "var(--ink-base)", textDecoration: "none" }}>
            ←
          </Link>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "17px", color: "var(--ink-base)" }}>
            {t("bots.create.title")}
          </span>
        </div>

        <div
          style={{
            background: "var(--teal-pale)",
            border: "1px solid var(--teal-base)",
            borderRadius: "var(--radius-lg)",
            padding: "var(--space-8)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", color: "var(--teal-base)" }}>
            {t("bots.create.cardTitle")}
          </span>
          <span style={{ fontFamily: "var(--font-body)", fontSize: "11.5px", color: "var(--ink-soft)", lineHeight: 1.5 }}>
            {t("bots.create.cardBody")}
          </span>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <SelectField
            label={t("bots.create.pairLabel")}
            value={pair}
            options={PAIRS}
            onChange={setPair}
            renderIcon={(p) => <CoinGlyph asset={baseAsset(p)} size={20} />}
          />

          <NumberFieldWithHint
            label={t("bots.create.allocationLabel")}
            hint={t("bots.create.allocationHint")}
            value={allocationAmount}
            onChange={setAllocationAmount}
            min="50"
            step="1"
          />
          <NumberFieldWithHint
            label={t("bots.create.sessionLengthLabel")}
            hint={t("bots.create.sessionLengthHint")}
            value={sessionLengthMinutes}
            onChange={setSessionLengthMinutes}
            min="5"
            step="1"
          />

          {error && <ErrorText message={error} />}

          <PrimaryButton submitting={submitting}>
            {submitting ? t("bots.create.creating") : t("bots.create.submit")}
          </PrimaryButton>
        </form>
      </div>
    </div>
  );
}

function NumberFieldWithHint({ label, hint, value, onChange, min, step }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "11px", color: "var(--ink-soft)" }}>
        {label}
      </span>
      <input
        type="number"
        min={min}
        step={step}
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
      {hint && (
        <span style={{ fontFamily: "var(--font-body)", fontSize: "10.5px", color: "var(--ink-soft)" }}>{hint}</span>
      )}
    </label>
  );
}
