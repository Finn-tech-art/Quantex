// A toggle switch — the primitive quantex-component-composition.md already
// anticipated ("reinvest-row → form-label + switch(off)" on the Manual
// Config screen) but nothing had built yet. First real use is the dark
// mode row in MenuPage.jsx.
//
// The knob uses --on-accent (always light, never redefined per theme —
// see index.css) rather than --cream-base, because the track it sits on
// is --teal-base when on: same "fixed light foreground on a permanently
// dark accent surface" reasoning as everywhere else --on-accent is used.
// If it used --cream-base instead, the knob would turn dark-on-dark and
// disappear the moment dark mode is the very thing being toggled on.
export default function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        width: 42,
        height: 24,
        borderRadius: "var(--radius-full)",
        background: checked ? "var(--teal-base)" : "var(--cream-line)",
        border: "none",
        padding: 0,
        cursor: "pointer",
        flexShrink: 0,
        transition: "background-color 0.15s ease",
      }}
    >
      {/* Positioned (not flex-aligned) and moved via `transform` — a
          justify-content flip doesn't reliably transition across browsers,
          transform does. */}
      <span
        style={{
          position: "absolute",
          top: 3,
          left: 3,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "var(--on-accent)",
          display: "block",
          transform: checked ? "translateX(18px)" : "translateX(0)",
          transition: "transform 0.15s ease",
        }}
      />
    </button>
  );
}
