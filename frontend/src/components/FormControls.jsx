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
      {submitting ? <AnimatedPsi mode="working" size={18} color="var(--on-accent)" /> : children}
    </button>
  );
}
