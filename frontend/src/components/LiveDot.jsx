// A small pulsing dot + "LIVE" label, for marking data on screen that's
// actually coming from a real, periodically-refreshing backend feed (as
// opposed to static or one-time-loaded data). This is the same exact
// visual spec ExecutionLog.jsx already built inline for its own demo
// status row (6px circle, --gain color, "pulse 1.4s ease-in-out infinite"
// animation) — pulled out here as its own component so TradePage and
// MarketsPage can reuse it instead of copy-pasting that inline style a
// second and third time. ExecutionLog.jsx itself is left as-is (not
// switched to use this) since it isn't broken and touching it isn't part
// of this change.
//
// The "pulse" @keyframes rule itself lives in index.css, not here — that
// file also has the prefers-reduced-motion override for it
// ([style*="animation: pulse"] { animation: none !important }), which
// matches this component automatically because the animation is still
// set via a plain inline `style` attribute below, not a CSS class. If you
// ever move this to a class-based animation instead, remember to update
// that reduced-motion selector in index.css too or it'll stop catching it.
export default function LiveDot({ size = 6, color = "var(--gain)", label = "LIVE", labelColor }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
      <span
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
          // Keep this string's shape ("animation: pulse ...") intact if you
          // ever edit the timing below — index.css's reduced-motion rule
          // matches on the literal substring "animation: pulse", not on
          // the animation-name alone.
          animation: "pulse 1.4s ease-in-out infinite",
        }}
      />
      {label && (
        <span
          style={{
            fontFamily: "var(--font-data)",
            fontSize: "9px",
            letterSpacing: "0.06em",
            color: labelColor || color,
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
