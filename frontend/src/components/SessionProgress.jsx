// The "timer line" from FakeSessionPage.jsx's demo — a thin progress track
// showing how far into its session a bot currently is. Kept as its own
// small component (not unified with the demo's local version) because the
// two have genuinely different data models: the demo drives its bar from a
// parent-managed simTime tied to its own playback/reveal timer, while this
// one is self-contained — given only a real session start time and length,
// it ticks its own clock and needs nothing else wired up by the caller.
// See simulated_bot_engine.py's module docstring for what actually makes a
// persistent bot's session take real time to play out, which is what makes
// a REAL progress bar (not a cosmetic animation) meaningful here.

import { useEffect, useState } from "react";

export default function SessionProgress({ startedAt, lengthMinutes, isComplete }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (isComplete) return; // frozen at 100% — no need to keep ticking
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isComplete]);

  const totalSeconds = lengthMinutes * 60;
  const rawElapsed = Math.floor((now - new Date(startedAt).getTime()) / 1000);
  const elapsedSeconds = Math.max(0, Math.min(totalSeconds, rawElapsed));
  const pct = isComplete ? 100 : (elapsedSeconds / totalSeconds) * 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--font-data)", fontSize: "9px", letterSpacing: "0.06em", color: "var(--ink-soft)" }}>
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
          {isComplete ? `T+${lengthMinutes}:00 ✓` : `${formatTime(elapsedSeconds)} / T+${lengthMinutes}:00`}
        </span>
      </div>
      <div style={{ width: "100%", height: 4, background: "var(--cream-line)", borderRadius: 99, overflow: "hidden" }}>
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

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `T+${m}:${String(s).padStart(2, "0")}`;
}
