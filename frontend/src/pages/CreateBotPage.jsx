// Module 4's user-facing creation form — the only kind of bot a user can
// self-serve create right now is a simulated (scripted) one; see
// routers/bots.py's module comment for why there's still no real-Grid
// creation endpoint. Submitting navigates straight to the new bot's detail
// page, which already renders a simulated bot correctly (BotDetailPage.jsx
// never assumed grid-only fields — see that file for confirmation).

import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import CoinGlyph from "../components/CoinGlyph";
import Icon from "../components/Icon";
import SelectField from "../components/SelectField";
import ConfirmSheet from "../components/ConfirmSheet";
import { ErrorText, PrimaryButton } from "../components/FormControls";
import { useToast } from "../context/ToastContext";
import { createBot, getBalances } from "../lib/api";

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

// The two grid-spacing modes a real grid bot would let you pick between —
// "Arithmetic" spaces each grid line by the same fixed price gap (e.g. a
// line every $50), "Geometric" spaces them by the same fixed PERCENTAGE
// gap instead (so lines bunch closer together at lower prices and spread
// out higher up, which suits volatile pairs better). This dropdown is
// purely cosmetic for now — its value is read into state below but never
// sent to createBot() or read by anything else, because the only bot type
// this form can actually create is the simulated/scripted one (see this
// file's top-of-file comment), and bot_engine.py's simulation loop has no
// concept of grid spacing to apply it to. It exists so the creation flow
// asks for one more real-looking configuration decision instead of just
// pair + allocation + duration. If a real Grid bot type is ever wired up
// (see routers/bots.py's comment on why that endpoint doesn't exist yet),
// this is the field to start actually plumbing through to the backend.
const GRID_MODES = ["Arithmetic", "Geometric"];

// Preset session lengths, in minutes — replaces what used to be a free-type
// number input with a fixed list, same reasoning as PAIRS above: a wide-open
// number field lets a user land on something that quietly behaves worse
// than they'd expect. Concretely, anything over ~16 minutes (960 seconds)
// pushes fake_trading_service.py's real-price fetch past Binance's
// documented 1000-candle-per-call cap on 1-second klines — see
// binance_market_service.fetch_klines's own comment on that cap. That
// fetch is written to fail closed (catches the error, returns None) rather
// than raise, so a long session never breaks a bot creation; it just makes
// _fetch_real_price_series() silently fall back to the fully-synthetic
// price path instead of drawing the chart from genuine Binance history —
// see generate_fake_trading_result's own docstring for that fallback. So
// every option below is safe to offer; the ones past "30 min" simply trade
// away real-price realism in the chart for a longer-running bot. Each
// array entry's value is the raw minutes number sent to createBot();
// SESSION_LENGTHS's translated display text lives in i18n.js under
// bots.create.sessionLengthOption<minutes> — add both together if a new
// preset is ever added here.
const SESSION_LENGTHS = [5, 10, 30, 60, 1440, 4320, 10080, 20160, 43200];

// Mirrors backend/app/services/session_limit_service.py's
// DEFAULT_DAILY_SESSION_LIMIT and FREE_TIER_MAX_SESSION_LENGTH_MINUTES —
// duplicated here rather than fetched, since there's no shared
// frontend/backend module for plain constants in this codebase. This is
// purely a UX nicety (a free-tier user never even sees an option that would
// just 400 on submit) — the backend is what actually enforces the cap
// regardless of what this file does or doesn't filter. Keep both files' two
// numbers in sync if either ever changes.
const DEFAULT_DAILY_SESSION_LIMIT = 3;
const FREE_TIER_MAX_SESSION_LENGTH_MINUTES = 30;

function baseAsset(pair) {
  return pair.split("/")[0];
}

export default function CreateBotPage() {
  const { t } = useTranslation();
  const { accessToken, user } = useAuth();
  const navigate = useNavigate();

  // A user an admin hasn't raised above the default is free-tier — same
  // is_free_tier() comparison session_limit_service.py makes on the
  // backend. Filters the session-length picker down to only what this user
  // could actually submit successfully, rather than showing every option
  // and letting a free-tier pick fail after the fact.
  const isFreeTier = (user?.daily_session_limit ?? DEFAULT_DAILY_SESSION_LIMIT) <= DEFAULT_DAILY_SESSION_LIMIT;
  const availableSessionLengths = isFreeTier
    ? SESSION_LENGTHS.filter((minutes) => minutes <= FREE_TIER_MAX_SESSION_LENGTH_MINUTES)
    : SESSION_LENGTHS;

  const [pair, setPair] = useState(PAIRS[0]);
  const [gridMode, setGridMode] = useState(GRID_MODES[0]);
  const [allocationAmount, setAllocationAmount] = useState("100");
  const [sessionLengthMinutes, setSessionLengthMinutes] = useState(SESSION_LENGTHS[1]); // 10 min, matches the old default
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Drives the ConfirmSheet below — submitting the form only opens this
  // (the browser's own HTML5 validation on the number inputs still runs
  // first, so the sheet never opens over an invalid amount); the actual
  // createBot() call happens in handleConfirmCreate, once the user taps
  // the sheet's own "Confirm & create" button. Same two-step shape
  // BotDetailPage.jsx already uses for its Stop button.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const toast = useToast();

  // Fetched once on mount, same call TradePage.jsx already makes for its own
  // "Available: X USDT" line — used below to reject an over-allocation
  // BEFORE the confirm sheet even opens, rather than only finding out via a
  // failed createBot() call after the user has already confirmed. This is a
  // UX nicety only, not the real guard — simulated_bot_service.
  // create_simulated_bot re-checks the user's balance fresh on the backend
  // regardless (balance can change between this fetch and submit), so a
  // stale or unfetched value here can never let an over-allocation through,
  // only fail to catch it a moment earlier than the backend would anyway.
  const [usdtBalance, setUsdtBalance] = useState(null); // null = not loaded yet

  useEffect(() => {
    if (!accessToken) return;
    getBalances(accessToken).then((res) => {
      setUsdtBalance(res.balances.find((b) => b.asset === "USDT")?.amount ?? "0");
    });
  }, [accessToken]);

  function handleSubmit(e) {
    e.preventDefault();
    // usdtBalance === null (still loading) doesn't block submission — the
    // backend check is authoritative either way, this is purely an early,
    // friendlier rejection when the balance IS already known.
    if (usdtBalance !== null && Number(allocationAmount) > Number(usdtBalance)) {
      setError(t("bots.create.insufficientBalance", { balance: usdtBalance }));
      return;
    }
    setConfirmOpen(true);
  }

  async function handleConfirmCreate() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await createBot(accessToken, {
        pair,
        allocationAmount, // stays a string all the way to the backend — see api.js's comment
        sessionLengthMinutes, // already a plain number — SESSION_LENGTHS's entries are numbers, not strings
        // No intervalSeconds passed here on purpose — this used to be a
        // "Minutes between sessions" field the user could edit, but
        // nothing in this form's flow actually surfaced what changing it
        // did (it's a non-functional control for now), so it's been
        // removed rather than left on screen doing nothing visible.
        // Omitting it lets createBot()'s own default (900s / 15 minutes,
        // matching the backend's own CreateSimulatedBotRequest default in
        // models/bot.py) apply instead.
      });
      setConfirmOpen(false);
      toast.success(t("bots.create.success"));
      navigate(`/bots/${res.id}`);
    } catch (err) {
      // Left open (not setConfirmOpen(false)) so the sheet itself is
      // where the error surfaces — same reasoning as BotDetailPage's
      // handleConfirmStop, which leaves its own ConfirmSheet open on
      // failure rather than silently discarding the error along with it.
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

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <SelectField
              label={t("bots.create.gridModeLabel")}
              value={gridMode}
              options={GRID_MODES}
              onChange={setGridMode}
              // Reuses the tab bar's "bots" glyph (a 2x2 grid) for both
              // options rather than drawing two new icons — this field is
              // cosmetic (see GRID_MODES's comment above), so there's no
              // real per-option artwork to show, and the grid glyph is
              // already thematically on-point for a "grid mode" picker.
              renderIcon={() => <Icon name="bots" size={20} color="var(--teal-base)" />}
              renderLabel={(mode) => t(`bots.create.gridMode${mode}`)}
            />
            <span style={{ fontFamily: "var(--font-body)", fontSize: "10.5px", color: "var(--ink-soft)" }}>
              {t("bots.create.gridModeHint")}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <NumberFieldWithHint
              label={t("bots.create.allocationLabel")}
              hint={t("bots.create.allocationHint")}
              value={allocationAmount}
              onChange={setAllocationAmount}
              min="50"
              step="1"
            />
            {usdtBalance !== null && (
              <span style={{ fontFamily: "var(--font-body)", fontSize: "10.5px", color: "var(--ink-soft)" }}>
                {t("bots.create.availableLabel", { balance: usdtBalance })}
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <SelectField
              label={t("bots.create.sessionLengthLabel")}
              value={sessionLengthMinutes}
              options={availableSessionLengths}
              onChange={setSessionLengthMinutes}
              renderIcon={() => <Icon name="clock" size={20} color="var(--teal-base)" />}
              renderLabel={(minutes) => t(`bots.create.sessionLengthOption${minutes}`)}
            />
            <span style={{ fontFamily: "var(--font-body)", fontSize: "10.5px", color: "var(--ink-soft)" }}>
              {t("bots.create.sessionLengthHint")}
            </span>
          </div>

          {error && <ErrorText message={error} />}

          <PrimaryButton submitting={submitting}>
            {submitting ? t("bots.create.creating") : t("bots.create.submit")}
          </PrimaryButton>
        </form>

        <ConfirmSheet
          open={confirmOpen}
          onClose={() => {
            setConfirmOpen(false);
            // Same reasoning as BotDetailPage's own ConfirmSheet close
            // handler — clears any failed-attempt error along with closing
            // so it doesn't sit around invisible and reappear stale next
            // time the sheet reopens.
            setError(null);
          }}
          title={t("bots.create.confirmTitle")}
          body={
            <>
              {t("bots.create.confirmBody")}
              <div style={{ marginTop: "var(--space-4)", fontWeight: 600, color: "var(--ink-base)" }}>
                {allocationAmount} USDT — {pair} · {t(`bots.create.sessionLengthOption${sessionLengthMinutes}`)}
              </div>
              {error && (
                <div style={{ marginTop: "var(--space-4)" }}>
                  <ErrorText message={error} />
                </div>
              )}
            </>
          }
          cancelLabel={t("bots.create.confirmCancel")}
          confirmLabel={t("bots.create.confirmSubmit")}
          confirmingLabel={t("bots.create.creating")}
          confirming={submitting}
          onConfirm={handleConfirmCreate}
        />
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
