// The live view for one bot — shows its current P&L, what it's doing right
// now (in plain language, via reasoning_text), and its fill history, all
// updating instantly as real trades/simulated fills happen. The instant
// part comes from a WebSocket, not polling — see the useEffect below that
// opens one — using the exact same "Redis pub-sub -> WebSocket -> browser"
// pattern already built for deposits (see DepositPage.jsx and
// routers/deposits.py's /deposits/ws for the twin of this).
//
// Layout follows Bybit's own trading-pair screen structure (a persistent
// price header, then Chart / Overview / Data / Feed tabs below it, then a
// full-width split action bar fixed to the bottom) rendered in Quantex's
// own cream/teal tokens rather than Bybit's palette — see the "Bybit
// structure, Quantex colours" direction this project's frontend follows.
// Two deliberate departures from a literal copy, both because this is an
// AUTOMATED bot's page, not a manual trading screen:
//   - No MA overlay lines and no order book — those exist on Bybit to help
//     a human read the market and place their own orders; a Quantex bot
//     decides for itself and explains why via reasoning_text, so the chart
//     doesn't need to teach the viewer to read it themselves.
//   - The bottom bar is Pause/Stop, not Buy/Sell — colored as the neutral
//     control actions they are (Stop uses the same teal-base "primary
//     action" color used everywhere else in the app), not a green/red
//     buy/sell split, since pausing or stopping isn't a directional trade.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AnimatedPsi from "../components/AnimatedPsi";
import Icon from "../components/Icon";
import LiveChart from "../components/LiveChart";
import { ExecutionLog } from "../components/ExecutionLog";
import SessionProgress from "../components/SessionProgress";
import { ErrorText } from "../components/FormControls";
import ConfirmSheet from "../components/ConfirmSheet";
import { useToast } from "../context/ToastContext";
import { getBotChart, getBotDetail, getBotFills, stopBot, WS_BASE } from "../lib/api";

const ACTION_BAR_HEIGHT = 66;

export default function BotDetailPage() {
  const { t } = useTranslation();
  const { botId } = useParams(); // from the :botId part of the route path, see App.jsx
  const { accessToken } = useAuth();
  const [detail, setDetail] = useState(null);
  const [fills, setFills] = useState(null);
  // null while loading; stays null (rather than erroring the whole page) if
  // the chart endpoint 503s — see getBotChart's catch below and
  // routers/bots.py's /chart docstring for when that happens.
  const [chart, setChart] = useState(null);
  const [tab, setTab] = useState("chart"); // "chart" | "overview" | "data" | "feed"
  // A simulated bot's idle-tick "thinking" narration (see
  // simulated_bot_engine.py's _publish_thinking) — pushed live over the
  // WebSocket below, NEVER fetched from the backend and never persisted
  // (bot_fills has no THINKING row for these), so this is the one piece of
  // feed content that lives only in this component's own state. Newest
  // first, same order as `fills`. Cleared by refresh() below, since a real
  // fetch (a new fill, or the poll timer) always supersedes whatever was
  // being "thought" before it.
  const [liveThoughts, setLiveThoughts] = useState([]);

  function refresh() {
    if (!accessToken) return;
    setLiveThoughts([]);
    getBotDetail(accessToken, botId).then(setDetail);
    getBotFills(accessToken, botId).then((res) => setFills(res.fills));
    getBotChart(accessToken, botId)
      .then((res) => setChart(res.candles))
      .catch(() => setChart([])); // no chart data available right now — page still works without it
  }

  // Load once immediately when the page opens (or if botId/accessToken
  // change, e.g. navigating from one bot straight to another).
  useEffect(refresh, [accessToken, botId]);

  // Open exactly one WebSocket for this bot, for as long as this page is
  // open. Most messages (a real fill, or a simulated session starting) mean
  // "something changed server-side" and we simply re-fetch every piece of
  // state — simpler than trying to hand-merge the pushed event into local
  // state, at the cost of one extra API round-trip per event (fine at this
  // scale). A THINKING message (see simulated_bot_engine.py's
  // _publish_thinking) is the one exception: it never becomes a real
  // bot_fills row, so there's nothing to re-fetch — it's appended straight
  // into liveThoughts instead, capped at 10 so a long-idle session can't
  // grow this list without bound.
  useEffect(() => {
    if (!accessToken || !botId) return;
    const ws = new WebSocket(`${WS_BASE}/bots/${botId}/ws?token=${accessToken}`);
    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        refresh(); // not JSON (or unparseable) — fall back to the old "just refetch" behavior
        return;
      }
      if (data.side === "THINKING") {
        setLiveThoughts((prev) =>
          [{ side: "THINKING", reasoning_text: data.reasoning_text, created_at: new Date().toISOString() }, ...prev].slice(0, 10)
        );
      } else {
        refresh();
      }
    };
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, botId]);

  // The WebSocket above only ever sends a message when a FILL happens (or,
  // for a simulated bot, when a session starts) — see routers/bots.py's
  // /ws route and grid.py's _publish_fill. That means a bot that currently
  // has nothing to do (e.g. a Grid bot whose price has wandered outside its
  // configured range — see grid.py's evaluate_grid, which simply has no BUY
  // or SELL condition left to trigger in that case) can sit for hours with
  // no fills at all, and this whole page — including the chart and the
  // "current price" figure in PnlBlock — would stay frozen at whatever it
  // showed on the last page load, even though the real price keeps moving
  // every second.
  //
  // This interval fixes that by calling the SAME refresh() used above, but
  // on a plain timer instead of waiting for a fill. refresh() already pulls
  // a fresh current_price from Redis (see routers/bots.py's GET /{id}
  // handler, which reads the live price on every single call rather than
  // caching it) and fresh candles from Binance (getBotChart), so nothing
  // backend-side needed to change for this to work — we just needed to
  // actually call it on a schedule.
  //
  // 15000ms (15s) matches the real Grid engine's own sweep interval (see
  // celery_app.py's beat_schedule -> "bot-engine-sweep") — there's no point
  // polling faster than the engine itself re-evaluates the bot, since
  // nothing new could have happened in between. To make the chart feel
  // "snappier", lower this number; to reduce how often this page hits the
  // backend/Binance, raise it.
  //
  // Once a bot is no longer ACTIVE (STOPPED or SESSION_CAPPED), its price
  // history is done changing as far as this bot is concerned — polling
  // would just be wasted requests — so this checks detail?.status and skips
  // scheduling the interval at all once that's true. detail starts out
  // null (before the first refresh() above has resolved), which is also
  // treated as "don't poll yet" until we actually know the bot's status.
  useEffect(() => {
    if (!accessToken || !botId) return;
    if (detail?.status !== "ACTIVE") return;
    const pollMs = 15000;
    const timer = setInterval(refresh, pollMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, botId, detail?.status]);

  if (detail === null || fills === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <AnimatedPsi mode="working" size={30} color="var(--teal-base)" />
      </div>
    );
  }

  const totalPnl = Number(detail.total_pnl);
  const latestFill = fills[0];
  // Shared between the Chart tab (rendered directly under LiveChart, per
  // the "feed right below the chart" layout) and the standalone Feed tab
  // below — same fills, same timeLabel derivation, just two different
  // places on the page that want to show them. liveThoughts (see the
  // WebSocket effect above) are prepended ahead of the real fills — they
  // only ever get pushed on a tick where nothing new was revealed, so
  // chronologically they always belong ahead of whatever's already in
  // `fills`, newest-first same as the rest of this list.
  const feedFills = [
    ...liveThoughts.map((th) => ({ ...th, timeLabel: new Date(th.created_at).toLocaleTimeString() })),
    ...fills.map((f) => ({ ...f, timeLabel: new Date(f.created_at).toLocaleTimeString() })),
  ];

  return (
    <>
      <div style={{ paddingTop: "var(--space-11)", paddingBottom: ACTION_BAR_HEIGHT + 16 }}>
        <div style={{ maxWidth: 384, margin: "0 auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <Header pair={detail.pair} detail={detail} t={t} />

          <PnlBlock totalPnl={totalPnl} currentPrice={detail.current_price} t={t} />

          {detail.session_started_at && detail.session_length_minutes && (
            <SessionProgress
              startedAt={detail.session_started_at}
              lengthMinutes={detail.session_length_minutes}
              isComplete={detail.status === "SESSION_CAPPED"}
            />
          )}

          {detail.next_session_due_at && <NextSessionNotice dueAt={detail.next_session_due_at} />}

          <TabStrip active={tab} onChange={setTab} t={t} />

          {tab === "chart" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
              {chart && chart.length > 0 ? (
                <LiveChart chartId={botId} allCandles={toChartCandles(chart)} fills={fills} />
              ) : (
                <EmptyTabNote text={t("bots.data.noChart")} />
              )}
              <ExecutionLog
                fills={feedFills}
                showLiveIndicator={detail.status === "ACTIVE"}
                title={t("bots.fillFeed")}
                emptyLabel={t("bots.noFills")}
              />
            </div>
          )}

          {tab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
              <MetricRow detail={detail} t={t} />
              <ReasoningCard latestFill={latestFill} t={t} />
            </div>
          )}

          {tab === "data" && <DataTab detail={detail} t={t} />}

          {tab === "feed" && (
            <ExecutionLog
              fills={feedFills}
              showLiveIndicator={detail.status === "ACTIVE"}
              title={t("bots.fillFeed")}
              emptyLabel={t("bots.noFills")}
            />
          )}
        </div>
      </div>

      <ActionRow botId={botId} accessToken={accessToken} status={detail.status} onStopped={refresh} t={t} />
    </>
  );
}

function Header({ pair, detail, t }) {
  // Status dot color follows the design system's Status Dot spec:
  // live/running = gain-green, paused = ink-soft, failed = loss-red.
  const dotColor = detail.status === "ACTIVE" ? "var(--gain)" : detail.status === "ERROR" ? "var(--loss)" : "var(--ink-soft)";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
        <Link to="/bots" style={{ display: "flex", textDecoration: "none" }}>
          <Icon name="chevronLeft" size={20} color="var(--ink-base)" />
        </Link>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "17px", color: "var(--ink-base)" }}>{pair}</span>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, display: "inline-block" }} />
            <span style={{ fontFamily: "var(--font-data)", fontSize: "9px", color: "var(--ink-soft)" }}>
              {detail.strategy_type} {detail.is_paper ? `· ${t("bots.paper")}` : ""}
              {detail.is_simulated ? "· Simulated " : ""}· {detail.status}
            </span>
          </div>
        </div>
      </div>
      <Icon name="moreDots" size={18} color="var(--ink-soft)" />
    </div>
  );
}

function PnlBlock({ totalPnl, currentPrice, t }) {
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
        {t("bots.pnlLabel").toUpperCase()}
      </span>
      {/* Plain --gain is only approved for LIGHT backgrounds per the design
          system's color rules — this card is dark teal, so a positive P&L
          uses --gain-on-dark instead (a negative one still uses plain
          --loss, which is approved on both). See the design doc's "never
          use --gain on a dark teal background" rule — this is exactly the
          case it warns about. */}
      <span
        style={{
          fontFamily: "var(--font-data)",
          fontWeight: 600,
          fontSize: "28px",
          color: totalPnl >= 0 ? "var(--gain-on-dark)" : "var(--loss)",
        }}
      >
        {totalPnl >= 0 ? "+" : ""}
        ${totalPnl.toFixed(2)}
      </span>
      <span style={{ fontFamily: "var(--font-data)", fontSize: "11px", color: "var(--teal-sage)" }}>
        {t("bots.currentPrice")}: ${Number(currentPrice).toLocaleString()}
      </span>
    </div>
  );
}

// The Chart / Overview / Data / Feed tab strip — Bybit's own tab row for a
// trading pair screen, reused here for one bot's own info instead of one
// asset's. A flat underline-style tab (not the toggle-pill shape used
// elsewhere in this app, e.g. AI Strategies vs Manual) since Bybit's own
// version is exactly this shape and there are 4 options here, not 2.
function TabStrip({ active, onChange, t }) {
  const tabs = [
    { key: "chart", label: t("bots.tabs.chart") },
    { key: "overview", label: t("bots.tabs.overview") },
    { key: "data", label: t("bots.tabs.data") },
    { key: "feed", label: t("bots.tabs.feed") },
  ];
  return (
    <div style={{ display: "flex", gap: "var(--space-8)", borderBottom: "1px solid var(--cream-line)" }}>
      {tabs.map((tabItem) => {
        const isActive = tabItem.key === active;
        return (
          <button
            key={tabItem.key}
            type="button"
            onClick={() => onChange(tabItem.key)}
            style={{
              background: "none",
              border: "none",
              padding: "0 0 10px",
              cursor: "pointer",
              fontFamily: "var(--font-body)",
              fontWeight: isActive ? 700 : 500,
              fontSize: "13px",
              color: isActive ? "var(--teal-base)" : "var(--ink-soft)",
              borderBottom: isActive ? "2px solid var(--teal-base)" : "2px solid transparent",
              marginBottom: -1, // sits flush over the strip's own bottom border
            }}
          >
            {tabItem.label}
          </button>
        );
      })}
    </div>
  );
}

function EmptyTabNote({ text }) {
  return (
    <div style={{ padding: "var(--space-16) 0", textAlign: "center" }}>
      <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)" }}>{text}</span>
    </div>
  );
}

function MetricBox({ label, value }) {
  return (
    <div
      style={{
        flex: 1,
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "10px 8px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      <span style={{ fontFamily: "var(--font-data)", fontSize: "8.5px", letterSpacing: "0.06em", color: "var(--ink-soft)" }}>
        {label.toUpperCase()}
      </span>
      <span style={{ fontFamily: "var(--font-data)", fontSize: "12px", color: "var(--ink-base)" }}>{value}</span>
    </div>
  );
}

function MetricRow({ detail, t }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-4)" }}>
      <MetricBox label={t("bots.allocation")} value={`$${Number(detail.allocation_amount).toFixed(0)}`} />
      <MetricBox label={t("bots.realized")} value={`$${Number(detail.realized_pnl).toFixed(2)}`} />
      <MetricBox label={t("bots.unrealized")} value={`$${Number(detail.unrealized_pnl).toFixed(2)}`} />
    </div>
  );
}

function ReasoningCard({ latestFill, t }) {
  // "What it's doing now" always shows the most recent fill's own
  // reasoning_text (written by the strategy engine itself — see
  // strategies/grid.py's _buy_reasoning/_sell_reasoning) — this card never
  // invents its own summary, it just surfaces exactly what the backend
  // already decided to say about its own most recent action.
  return (
    <div
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-8)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "11px", color: "var(--ink-soft)" }}>
        {t("bots.whatItsDoing")}
      </span>
      <span style={{ fontFamily: "var(--font-body)", fontSize: "12.5px", color: "var(--ink-base)" }}>
        {latestFill ? latestFill.reasoning_text : t("bots.watching")}
      </span>
    </div>
  );
}

// The bot's own configuration/state, previously fetched (BotDetailResponse
// already returns grid_lines + holdings) but never actually shown anywhere
// — real data, just newly surfaced here rather than invented for this tab.
// grid_lines is a Grid bot's price levels; holdings maps a level's index
// (as a string — see strategies/grid.py's `level_key = str(i)`) to whether
// that level currently holds an open position. A non-Grid or simulated bot
// has grid_lines=[] (see routers/bots.py's SIMULATED_BOT_DETAIL branch),
// which renders as an honest empty state rather than a blank tab.
function DataTab({ detail, t }) {
  const gridLines = detail.grid_lines || [];
  const holdings = detail.holdings || {};

  if (gridLines.length === 0) {
    return <EmptyTabNote text={t("bots.data.none")} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "13px", color: "var(--ink-base)" }}>
        {t("bots.data.gridLevels")}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {gridLines.map((price, i) => {
          const state = holdings[String(i)];
          const isHolding = Boolean(state?.holding);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "var(--cream-deep)",
                border: `1px solid ${isHolding ? "var(--teal-base)" : "var(--cream-line)"}`,
                borderRadius: "var(--radius-md)",
                padding: "8px 12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}>
                <span style={{ fontFamily: "var(--font-data)", fontSize: "9px", color: "var(--ink-soft)", minWidth: 20 }}>#{i + 1}</span>
                <span style={{ fontFamily: "var(--font-data)", fontSize: "12px", color: "var(--ink-base)" }}>
                  ${Number(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              {isHolding ? (
                <span
                  style={{
                    background: "var(--teal-pale)",
                    color: "var(--teal-deep)",
                    fontFamily: "var(--font-data)",
                    fontWeight: 600,
                    fontSize: "9.5px",
                    padding: "2px 7px",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  {t("bots.data.holding")} @ ${Number(state.buy_price).toFixed(2)}
                </span>
              ) : (
                <span style={{ fontFamily: "var(--font-body)", fontSize: "10.5px", color: "var(--ink-soft)" }}>{t("bots.data.empty")}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Backend candle fields (open/high/low/close/volume) travel as decimal
// STRINGS (see models/bot.py's ChartCandle — same convention as every
// other money-shaped API field in this app), but LiveChart does arithmetic
// (comparisons, the volume pane's Number(c.volume)) on them, so they need
// converting to numbers once here rather than at every call site inside
// that shared component. volume is only ever present on a real bot's
// candles (this page's own use) — FakeSessionPage's demo candles never
// carry it, which is what makes LiveChart draw a volume pane here but not
// there. `?? null` keeps that distinction intact rather than coercing a
// genuinely-absent field into the number 0.
function toChartCandles(candles) {
  return candles.map((c) => ({
    time: c.time,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: c.volume != null ? Number(c.volume) : null,
  }));
}

function NextSessionNotice({ dueAt }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remainingSeconds = Math.max(0, Math.round((new Date(dueAt).getTime() - now) / 1000));
  const m = Math.floor(remainingSeconds / 60);
  const s = remainingSeconds % 60;

  return (
    <div
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "10px 14px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span style={{ fontFamily: "var(--font-body)", fontSize: "11.5px", color: "var(--ink-soft)" }}>
        Next scripted session
      </span>
      <span style={{ fontFamily: "var(--font-data)", fontSize: "11.5px", color: "var(--teal-base)", fontWeight: 600 }}>
        {remainingSeconds > 0 ? `${m}:${String(s).padStart(2, "0")}` : "any moment now"}
      </span>
    </div>
  );
}

// Full-width, fixed-to-the-bottom split bar — Bybit's own Buy/Sell shape
// (edge-to-edge, no gap, no surrounding card) reused for this page's real
// actions, Pause/Stop. Colored as the neutral controls they are rather
// than a green/red buy/sell split — see this file's module comment for
// why that distinction matters here. Centered to the same max-w-sm column
// every screen uses via the identical fixed+transform technique
// TabBar.jsx already established, so it lines up with page content on
// wide viewports instead of stretching edge-to-edge there too.
function ActionRow({ botId, accessToken, status, onStopped, t }) {
  // Pause still has no backend endpoint (that's still-to-come — see this
  // file's TopNav-adjacent history) so it stays shown-but-disabled, same as
  // before. Stop is real now — POST /bots/{id}/stop (see lib/api.js's
  // stopBot and routers/bots.py's stop_bot docstring for exactly what it
  // does for each bot kind).
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState(null);
  // Drives the ConfirmSheet below — tapping Stop only opens this; the
  // actual stopBot() call happens in handleConfirmStop, once the user taps
  // the sheet's own "Stop" button.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const toast = useToast();

  // Only an ACTIVE bot has anything to stop — a SESSION_CAPPED or already-
  // STOPPED bot would just get a 400 back from the backend's own status
  // check, so the button is disabled ahead of time to match rather than
  // letting a user click it and see an error for something the UI could
  // have just prevented.
  const canStop = status === "ACTIVE";

  async function handleConfirmStop() {
    setError(null);
    setStopping(true);
    try {
      await stopBot(accessToken, botId);
      setConfirmOpen(false);
      toast.success(t("bots.stopSuccess"));
      // Re-fetch full bot detail (status, P&L, fills) rather than trying to
      // hand-construct the post-stop state locally — same "let the backend
      // be the single source of truth" choice this page already makes for
      // every fill via the WebSocket's onmessage handler above.
      onStopped();
    } catch (err) {
      // Left open (not setConfirmOpen(false)) so the sheet itself is
      // where the error surfaces — closing it on failure would silently
      // discard the very feedback the user needs to see.
      setError(err.message);
    } finally {
      setStopping(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: 0,
        width: "100%",
        maxWidth: 384,
        zIndex: 20,
        background: "var(--cream-base)",
      }}
    >
      <div style={{ display: "flex", borderTop: "1px solid var(--cream-line)", height: ACTION_BAR_HEIGHT }}>
        <button
          type="button"
          disabled
          title="Coming soon"
          style={{
            flex: 1,
            background: "var(--cream-deep)",
            border: "none",
            fontFamily: "var(--font-body)",
            fontWeight: 600,
            fontSize: "13px",
            color: "var(--ink-soft)",
            opacity: 0.6,
          }}
        >
          {t("bots.pause")}
        </button>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={!canStop || stopping}
          title={canStop ? undefined : t("bots.stopNotActive")}
          style={{
            flex: 1,
            background: "var(--teal-base)",
            border: "none",
            fontFamily: "var(--font-body)",
            fontWeight: 600,
            fontSize: "13px",
            color: "var(--on-accent)",
            cursor: canStop && !stopping ? "pointer" : "not-allowed",
            // Same dimmed-when-unusable treatment the disabled Pause button
            // above already uses, so an inactive Stop reads the same way.
            opacity: canStop && !stopping ? 1 : 0.6,
          }}
        >
          {stopping ? t("bots.stopping") : t("bots.stop")}
        </button>
      </div>
      <ConfirmSheet
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
          // Clears any failed-attempt error along with closing — otherwise
          // it would sit around invisible (the sheet that shows it is
          // gone) and reappear stale next time the sheet is reopened.
          setError(null);
        }}
        title={t("bots.stopConfirmTitle")}
        body={
          <>
            {t("bots.stopConfirm")}
            {error && (
              <div style={{ marginTop: "var(--space-4)" }}>
                <ErrorText message={error} />
              </div>
            )}
          </>
        }
        cancelLabel={t("bots.stopCancel")}
        confirmLabel={t("bots.stop")}
        confirmingLabel={t("bots.stopping")}
        confirming={stopping}
        onConfirm={handleConfirmStop}
      />
    </div>
  );
}
