import AnimatedPsi from "./AnimatedPsi";

export function Field({ label, type, value, onChange, autoComplete }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontWeight: 500,
          fontSize: "11px",
          color: "var(--ink-soft)",
        }}
      >
        {label}
      </span>
      <input
        type={type}
        required
        autoComplete={autoComplete}
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
    </label>
  );
}

// Same look as Field above, but a native <select> — used for the signup
// country dropdown (see SignupPage.jsx). `options` is an array of
// { value, label } pairs; pass a `placeholder` to render a disabled first
// option (e.g. "Select country") so the field starts visibly empty instead
// of defaulting to whatever the first real option happens to be.
export function SelectField({ label, value, onChange, options, placeholder }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontWeight: 500,
          fontSize: "11px",
          color: "var(--ink-soft)",
        }}
      >
        {label}
      </span>
      <select
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
          color: value ? "var(--ink-base)" : "var(--ink-soft)",
          outline: "none",
        }}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ErrorText({ message }) {
  return (
    <p
      style={{
        fontFamily: "var(--font-body)",
        fontSize: "12.5px",
        color: "var(--loss)",
        margin: 0,
      }}
    >
      {message}
    </p>
  );
}

export function Divider({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
      <span style={{ flex: 1, height: 1, background: "var(--cream-line)" }} />
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "11px",
          color: "var(--ink-soft)",
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, height: 1, background: "var(--cream-line)" }} />
    </div>
  );
}

export function PrimaryButton({ children, submitting, type = "submit", onClick }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={submitting}
      style={{
        background: "var(--teal-base)",
        color: "var(--on-accent)",
        border: "none",
        borderRadius: "var(--radius-md)",
        padding: "13px 14px",
        fontFamily: "var(--font-body)",
        fontWeight: 600,
        fontSize: "13px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-4)",
        cursor: submitting ? "default" : "pointer",
        opacity: submitting ? 0.8 : 1,
      }}
    >
      {/* Previously the spinner REPLACED children while submitting, which
          silently discarded any "Saving…"/"Approving…" label a caller
          passed in — the button just showed a bare spinner with no text.
          Rendering both together (spinner first, label after, joined by
          the gap above) means a caller can still pass plain unchanging
          text (e.g. "Save") and get a label-less-but-clear spinner state,
          or pass a submitting-aware label (e.g. saving ? "Saving…" :
          "Save") and have that text actually show up next to the spinner. */}
      {submitting && <AnimatedPsi mode="working" size={18} color="var(--on-accent)" />}
      {children}
    </button>
  );
}
