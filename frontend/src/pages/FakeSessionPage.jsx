// FakeSessionPage — live 10-minute demo session with streaming execution log.
//
// User flow:
//   1. Press "Run session" → fetches all fills from /bots/demo/fake-session
//   2. Fills are revealed one at a time every 2.5 s (streaming playback)
//   3. The execution log grows entry by entry — BUYs and SELLs appear in
//      chronological order, newest at the top
//   4. The hero P&L card updates its figure live each time a SELL completes
//   5. A progress bar shows simulated time (T+MM:SS / T+10:00)
//   6. When the last fill fires → session complete → saveDemoSession called
//
// Design tokens, typography, and color rules follow quantex-design-system-spec_2.md
// exactly. No hardcoded hex or px values.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getFakeSession, saveDemoSession } from "../lib/api";
import AnimatedPsi from "../components/AnimatedPsi";
import LiveChart from "../components/LiveChart";
import { ExecutionLog } from "../components/ExecutionLog";



// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function formatSimTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `T+${m}:${String(s).padStart(2, "0")}`;
}

function formatSessionLen(minutes) {
  return `T+${minutes}:00`;
}

// ─────────────────────────────────────────────
// Page root
// ─────────────────────────────────────────────
export default function FakeSessionPage() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();

  // "idle" | "loading" | "playing" | "complete"
  const [phase, setPhase] = useState("idle");

  const [allFills, setAllFills] = useState([]);         // all fills from backend
  const [allCandles, setAllCandles] = useState([]);     // all OHLC candles
  const [sessionDetail, setSessionDetail] = useState(null);
  const [visibleFills, setVisibleFills] = useState([]); // fills revealed so far
  const [runningPnl, setRunningPnl] = useState(0);      // live P&L from visible sells
  const [simTime, setSimTime] = useState(0);            // simulated seconds elapsed
  const [creditResult, setCreditResult] = useState(null);
  const [error, setError] = useState(null);

  // ── Trigger: fetch then start playback ─────────────────────────────────
  const runSession = useCallback(() => {
    setPhase("loading");
    setAllFills([]);
    setAllCandles([]);
    setVisibleFills([]);
    setRunningPnl(0);
    setSimTime(0);
    setCreditResult(null);
    setError(null);
    setSessionDetail(null);

    getFakeSession()
      .then((res) => {
        setSessionDetail(res.detail);
        setAllFills(res.fills); // kicks off the playback effect below
        setAllCandles(res.candles || []);
        setPhase("playing");
      })
      .catch((err) => {
        setError(err.message || "Could not start session.");
        setPhase("idle");
      });
  }, []);

  // ── Streaming playback — 1-second real-time clock ──────────────────────
  // Each second of real time = one second of simulated time. Fills are
  // revealed when real elapsed seconds reaches their simulated_offset_seconds,
  // so the session genuinely runs for session_length_minutes (10 min) of
  // wall-clock time with fills appearing at their true positions.
  useEffect(() => {
    if (phase !== "playing" || allFills.length === 0 || !sessionDetail) return;

    const totalSeconds = (sessionDetail._session_length_minutes ?? 10) * 60;
    let elapsed = 0;
    let fillIdx = 0; // next un-revealed fill index (fills are chronological)

    const timer = setInterval(() => {
      elapsed += 1;
      setSimTime(elapsed);

      // Reveal every fill whose simulated time has now been reached.
      while (
        fillIdx < allFills.length &&
        allFills[fillIdx].simulated_offset_seconds <= elapsed
      ) {
        const fill = allFills[fillIdx];
        setVisibleFills((prev) => [fill, ...prev]); // newest at top
        if (fill.side === "SELL" && fill.trade_pnl != null) {
          setRunningPnl((prev) => prev + Number(fill.trade_pnl));
        }
        fillIdx += 1;
      }

      if (elapsed >= totalSeconds) {
        clearInterval(timer);
        setPhase("complete");
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [phase, allFills, sessionDetail]);

  // ── Save on complete ────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "complete" || !sessionDetail) return;
    saveDemoSession(accessToken, {
      sessionId: sessionDetail.id,
      totalPnl: sessionDetail.total_pnl,
      isWin: sessionDetail._win,
    })
      .then(setCreditResult)
      .catch(() => {}); // silent — the session result is already visible
  }, [phase, sessionDetail, accessToken]);

  const sessionLenMinutes = sessionDetail?._session_length_minutes ?? 10;
  const isPlaying = phase === "playing";
  const isComplete = phase === "complete";
  const hasSession = isPlaying || isComplete;

  return (
    <div className="flex min-h-screen justify-center px-5 py-8">
      <div
        style={{
          width: "100%",
          maxWidth: 375,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-8)",
        }}
      >
        {/* ── Top nav ──────────────────────────────────────── */}
        <TopNav isPlaying={isPlaying} />

        {/* ── Disclaimer ───────────────────────────────────── */}
        {!hasSession && <DisclaimerBanner t={t} />}

        {/* ── Target profile cards (idle only) ─────────────── */}
        {!hasSession && <TargetProfile t={t} />}

        {/* ── Session progress bar (playing / complete) ─────── */}
        {hasSession && (
          <SessionProgress
            simTime={simTime}
            sessionLenMinutes={sessionLenMinutes}
            isComplete={isComplete}
          />
        )}

        {/* ── Live P&L hero card ────────────────────────────── */}
        {hasSession && sessionDetail && (
          <LivePnlCard
            runningPnl={runningPnl}
            sessionDetail={sessionDetail}
            isComplete={isComplete}
            t={t}
          />
        )}

        {/* ── Metric row (allocation / trades / return) ─────── */}
        {hasSession && sessionDetail && (
          <MetricRow
            sessionDetail={sessionDetail}
            visibleFills={visibleFills}
            isComplete={isComplete}
            runningPnl={runningPnl}
            t={t}
          />
        )}

        {/* ── Live Candlestick Chart ────────────────────────── */}
        {hasSession && sessionDetail && allCandles.length > 0 && (
          <LiveChart
            chartId={sessionDetail.id}
            allCandles={allCandles}
            fills={visibleFills}
            // allCandles[0].time is the session's own start (real epoch
            // seconds — see fake_trading_service.py's candle generation),
            // so start + simTime is "how far into real time this session's
            // playback clock has reached" — exactly what should be revealed
            // on the chart so far.
            revealUpToTime={allCandles[0].time + simTime}
          />
        )}

        {/* ── Loading state ─────────────────────────────────── */}
        {phase === "loading" && <LoadingState />}

        {/* ── Error ─────────────────────────────────────────── */}
        {error && <ErrorBanner message={error} />}

        {/* ── Execution log ─────────────────────────────────── */}
        {visibleFills.length > 0 && (
          <ExecutionLog
            fills={visibleFills.map((f) => ({ ...f, timeLabel: formatSimTime(f.simulated_offset_seconds) }))}
            showLiveIndicator={isPlaying}
          />
        )}

        {/* ── Credit notice ─────────────────────────────────── */}
        {isComplete && creditResult && (
          <CreditNotice
            credited={creditResult.credited}
            amount={creditResult.amount_credited}
          />
        )}

        {/* ── Run button ────────────────────────────────────── */}
        <RunButton phase={phase} onRun={runSession} t={t} />

        {/* ── Hint after complete ───────────────────────────── */}
        {isComplete && (
          <p
            style={{
              fontFamily: "var(--font-data)",
              fontSize: "9.5px",
              letterSpacing: "0.04em",
              color: "var(--ink-soft)",
              textAlign: "center",
              margin: 0,
            }}
          >
            Each session is independently generated — run again for new results.
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// TopNav
// ─────────────────────────────────────────────
function TopNav({ isPlaying }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
        <Link
          to="/bots"
          style={{
            fontFamily: "var(--font-body)",
            fontWeight: 500,
            fontSize: "16px",
            color: "var(--ink-base)",
            textDecoration: "none",
          }}
        >
          ←
        </Link>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: "17px",
            color: "var(--ink-base)",
          }}
        >
          Demo Session
        </span>
      </div>
      {/* Live dot while playing, amber when idle/complete */}
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: isPlaying ? "var(--gain)" : "var(--pending-dot)",
          display: "inline-block",
          transition: "background 0.3s ease",
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// Disclaimer — warning toast style (§9)
// ─────────────────────────────────────────────
function DisclaimerBanner({ t }) {
  return (
    <div
      style={{
        background: "var(--warning-bg)",
        border: "1px solid var(--cream-line)",
        borderLeft: "3px solid var(--pending-dot)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-8)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontWeight: 600,
          fontSize: "11px",
          color: "var(--warning-text)",
        }}
      >
        {t("bots.demo.disclaimerTitle")}
      </span>
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "11.5px",
          color: "var(--warning-text)",
          lineHeight: 1.5,
        }}
      >
        {t("bots.demo.disclaimerBody")}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────
// Target profile — 3 metric boxes (idle state only)
// ─────────────────────────────────────────────
function TargetProfile({ t }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-4)" }}>
      <MetricBox label={t("bots.demo.targetLabel")} value="40%" />
      <MetricBox label={t("bots.demo.winRateLabel")} value="90%" />
      <MetricBox label={t("bots.demo.sessionLength")} value="10 min" />
    </div>
  );
}

function MetricBox({ label, value, highlight }) {
  return (
    <div
      style={{
        flex: 1,
        background: highlight ? "var(--teal-pale)" : "var(--cream-deep)",
        border: `1px solid ${highlight ? "var(--teal-base)" : "var(--cream-line)"}`,
        borderRadius: "var(--radius-lg)",
        padding: "10px 8px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        transition: "background 0.25s ease, border-color 0.25s ease",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-data)",
          fontSize: "8.5px",
          letterSpacing: "0.06em",
          color: "var(--ink-soft)",
        }}
      >
        {label.toUpperCase()}
      </span>
      <span
        style={{
          fontFamily: "var(--font-data)",
          fontSize: "12px",
          color: highlight ? "var(--teal-base)" : "var(--ink-base)",
          fontWeight: highlight ? 600 : 400,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────
// Session progress bar — thin track with teal fill
// ─────────────────────────────────────────────
function SessionProgress({ simTime, sessionLenMinutes, isComplete }) {
  const totalSeconds = sessionLenMinutes * 60;
  const pct = isComplete ? 100 : Math.min(100, (simTime / totalSeconds) * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {/* Label row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span
          style={{
            fontFamily: "var(--font-data)",
            fontSize: "9px",
            letterSpacing: "0.06em",
            color: "var(--ink-soft)",
          }}
        >
          {isComplete ? "SESSION COMPLETE" : "LIVE SESSION"}
        </span>
        <span
          style={{
            fontFamily: "var(--font-data)",
            fontSize: "9.5px",
            color: isComplete ? "var(--gain)" : "var(--teal-base)",
            fontWeight: 600,
          }}
        >
          {isComplete
            ? `${formatSimTime(totalSeconds)} ✓`
            : `${formatSimTime(simTime)} / ${formatSessionLen(sessionLenMinutes)}`}
        </span>
      </div>
      {/* Track */}
      <div
        style={{
          width: "100%",
          height: 4,
          background: "var(--cream-line)",
          borderRadius: 99,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: isComplete ? "var(--gain)" : "var(--teal-base)",
            borderRadius: 99,
            transition: "width 0.6s ease, background 0.3s ease",
          }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Live P&L hero card — updates live as sells fire
// Design system §9 "Card — Hero"
// ─────────────────────────────────────────────
function LivePnlCard({ runningPnl, sessionDetail, isComplete, t }) {
  const positive = runningPnl >= 0;
  // On complete, show the final total_pnl for precision; during play show live running sum.
  const displayPnl = isComplete ? Number(sessionDetail.total_pnl) : runningPnl;
  const displayPositive = displayPnl >= 0;

  return (
    <div
      style={{
        background: "var(--teal-deep)",
        borderRadius: "var(--radius-2xl)",
        padding: "var(--space-11)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
        transition: "opacity 0.2s ease",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-data)",
          fontSize: "9px",
          letterSpacing: "0.08em",
          color: "var(--teal-sage)",
        }}
      >
        {isComplete ? "SESSION P&L" : "LIVE P&L"}
      </span>

      {/* Animated figure */}
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-6)" }}>
        <span
          key={Math.round(displayPnl * 100)} // re-mounts on each change for the pop effect
          style={{
            fontFamily: "var(--font-data)",
            fontWeight: 600,
            fontSize: "28px",
            color: displayPositive ? "var(--gain-on-dark)" : "var(--loss)",
            transition: "color 0.3s ease",
          }}
        >
          {displayPositive ? "+" : ""}${Math.abs(displayPnl).toFixed(2)}
        </span>
        {isComplete && (
          <span
            style={{
              fontFamily: "var(--font-data)",
              fontSize: "11px",
              color: displayPositive ? "var(--gain-on-dark)" : "var(--loss)",
              opacity: 0.85,
            }}
          >
            {displayPositive ? "+" : ""}{sessionDetail._return_pct}
          </span>
        )}
      </div>

      <span
        style={{
          fontFamily: "var(--font-data)",
          fontSize: "11px",
          color: "var(--teal-sage)",
        }}
      >
        {t("bots.currentPrice")}: ${Number(sessionDetail.current_price).toLocaleString()}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────
// Metric row — allocation / completed trades / return
// ─────────────────────────────────────────────
function MetricRow({ sessionDetail, visibleFills, isComplete, runningPnl, t }) {
  const sells = visibleFills.filter((f) => f.side === "SELL");
  const wins = sells.filter((f) => f.trade_pnl != null && Number(f.trade_pnl) > 0).length;
  const losses = sells.length - wins;

  return (
    <div style={{ display: "flex", gap: "var(--space-4)" }}>
      <MetricBox
        label={t("bots.allocation")}
        value={`$${Number(sessionDetail.allocation_amount).toFixed(0)}`}
      />
      <MetricBox
        label="Trades"
        value={`${sells.length} / ${sessionDetail._num_trips}`}
      />
      <MetricBox
        label="W / L"
        value={`${wins} / ${losses}`}
        highlight={isComplete && wins > losses}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// Loading state
// ─────────────────────────────────────────────
function LoadingState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-6)",
        padding: "var(--space-16) 0",
      }}
    >
      <AnimatedPsi mode="working" size={28} color="var(--teal-base)" />
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "12px",
          color: "var(--ink-soft)",
        }}
      >
        Generating session…
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────
// Error banner
// ─────────────────────────────────────────────
function ErrorBanner({ message }) {
  return (
    <div
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderLeft: "3px solid var(--loss)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-8)",
      }}
    >
      <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--loss)" }}>
        {message}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────
// Credit notice — §9 toast pattern
// ─────────────────────────────────────────────
function CreditNotice({ credited, amount }) {
  if (credited) {
    return (
      <div
        style={{
          background: "var(--teal-pale)",
          border: "1px solid var(--cream-line)",
          borderLeft: "3px solid var(--gain)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-8)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontWeight: 600,
            fontSize: "11px",
            color: "var(--gain)",
          }}
        >
          Profit credited to your balance
        </span>
        <span
          style={{
            fontFamily: "var(--font-data)",
            fontSize: "12px",
            color: "var(--ink-base)",
          }}
        >
          +${Number(amount).toFixed(2)} USDT added — visible in your Wallet.
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderLeft: "3px solid var(--ink-soft)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-8)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "11.5px",
          color: "var(--ink-soft)",
        }}
      >
        Loss session — no real funds deducted.
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────
// Run button — §9 "Button — Primary"
// ─────────────────────────────────────────────
function RunButton({ phase, onRun, t }) {
  const isLoading = phase === "loading";
  const isPlaying = phase === "playing";
  const disabled = isLoading || isPlaying;

  let label;
  if (isLoading || isPlaying) {
    label = isLoading ? "Generating session…" : "Session running…";
  } else if (phase === "complete") {
    label = "Run new session";
  } else {
    label = t("bots.demo.runSession");
  }

  return (
    <button
      type="button"
      onClick={onRun}
      disabled={disabled}
      style={{
        width: "100%",
        background: disabled ? "var(--teal-sage)" : "var(--teal-base)",
        border: "none",
        borderRadius: "var(--radius-md)",
        padding: "14px",
        fontFamily: "var(--font-body)",
        fontWeight: 600,
        fontSize: "13px",
        color: "var(--on-accent)",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.15s ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-4)",
      }}
    >
      {(isLoading || isPlaying) && (
        <AnimatedPsi mode="working" size={16} color="var(--on-accent)" />
      )}
      {label}
    </button>
  );
}
