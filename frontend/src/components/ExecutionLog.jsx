// Shared execution log — the colored BUY/SELL/THINKING fill list with
// per-trade win/loss badges, extracted from FakeSessionPage.jsx so a
// persistent bot's activity page (BotDetailPage.jsx) can show the exact
// same look instead of a plainer list.
//
// Each fill needs a `timeLabel` (a caller-formatted string — "T+2:15" for
// the demo's simulated clock, a real wall-clock time for a persistent bot)
// rather than this component deriving one itself, since the two callers'
// notions of "time" are genuinely different and neither belongs baked into
// a shared component.

export function ExecutionLog({ fills, showLiveIndicator, title = "Execution log", emptyLabel = "No fills yet." }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "14px", color: "var(--ink-base)" }}>
          {title}
        </span>
        {showLiveIndicator && (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--gain)",
                display: "inline-block",
                animation: "pulse 1.4s ease-in-out infinite",
              }}
            />
            <span style={{ fontFamily: "var(--font-data)", fontSize: "9px", letterSpacing: "0.06em", color: "var(--gain)" }}>
              LIVE
            </span>
          </div>
        )}
      </div>

      {fills.length === 0 ? (
        <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)" }}>{emptyLabel}</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {fills.map((fill, i) => (
            <ExecutionLogEntry key={`${fill.created_at}-${i}`} fill={fill} isNewest={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function ExecutionLogEntry({ fill, isNewest }) {
  if (fill.side === "THINKING") {
    return (
      <div
        style={{
          background: "transparent",
          borderLeft: "2px solid var(--cream-line)",
          padding: "8px 12px",
          marginLeft: "8px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <span style={{ fontFamily: "var(--font-data)", fontSize: "8.5px", color: "var(--ink-soft)" }}>{fill.timeLabel}</span>
          <span
            style={{
              fontFamily: "var(--font-body)",
              fontWeight: 600,
              fontSize: "9px",
              color: "var(--ink-soft)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Thinking
          </span>
        </div>
        <span style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--ink-soft)", fontStyle: "italic" }}>
          {fill.reasoning_text}
        </span>
      </div>
    );
  }

  const isBuy = fill.side === "BUY";
  const tradePnl = fill.trade_pnl != null ? Number(fill.trade_pnl) : null;
  const pnlPositive = tradePnl != null && tradePnl >= 0;
  const sideColor = isBuy ? "var(--gain)" : tradePnl != null && !pnlPositive ? "var(--loss)" : "var(--ink-base)";

  return (
    <div
      style={{
        background: isNewest ? "var(--teal-pale)" : "var(--cream-deep)",
        border: `1px solid ${isNewest ? "var(--teal-base)" : "var(--cream-line)"}`,
        borderRadius: "var(--radius-lg)",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        transition: "background 0.8s ease, border-color 0.8s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}>
          <span style={{ fontFamily: "var(--font-data)", fontSize: "8.5px", letterSpacing: "0.05em", color: "var(--ink-soft)", minWidth: 42 }}>
            {fill.timeLabel}
          </span>
          <span style={{ fontFamily: "var(--font-body)", fontWeight: 700, fontSize: "11.5px", color: sideColor, letterSpacing: "0.04em" }}>
            {fill.side}
          </span>
        </div>

        {tradePnl != null && (
          <span
            style={{
              background: pnlPositive ? "var(--teal-pale)" : "#F5E8E4",
              color: pnlPositive ? "var(--gain)" : "var(--loss)",
              fontFamily: "var(--font-data)",
              fontWeight: 700,
              fontSize: "10px",
              padding: "2px 8px",
              borderRadius: "var(--radius-sm)",
              letterSpacing: "0.04em",
            }}
          >
            {pnlPositive ? "+" : ""}${Math.abs(tradePnl).toFixed(2)}
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: "var(--space-4)" }}>
        <span style={{ fontFamily: "var(--font-data)", fontSize: "11px", color: "var(--ink-base)" }}>
          ${Number(fill.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span style={{ fontFamily: "var(--font-data)", fontSize: "11px", color: "var(--ink-soft)" }}>
          × {Number(fill.quantity).toFixed(5)}
        </span>
      </div>

      <span style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--ink-soft)", lineHeight: 1.45 }}>
        {fill.reasoning_text}
      </span>
    </div>
  );
}
