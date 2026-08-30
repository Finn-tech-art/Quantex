// The title / body / Cancel+primary-action layout from
// quantex-component-composition.md's "7b. Pause/Stop Confirmation" pattern,
// built on top of the generic BottomSheet.jsx shell. First used by
// BotDetailPage's Stop button (replacing the old window.confirm()); the
// same component is meant to be reused wherever else this app needs a
// "are you sure, here's what happens, Cancel or go ahead" prompt — e.g.
// TradePage's trade confirmation — rather than each screen building its
// own copy of this layout.
import BottomSheet from "./BottomSheet";

/**
 * <ConfirmSheet
 *   open={confirmOpen}
 *   onClose={() => setConfirmOpen(false)}
 *   title="Stop this bot?"
 *   body="Any unrealized profit or loss will be locked in..."
 *   cancelLabel="Cancel"
 *   confirmLabel="Stop"
 *   confirmingLabel="Stopping…"   // shown on the button instead of confirmLabel while confirming is true
 *   confirming={stopping}
 *   onConfirm={handleStop}
 * />
 *
 * `body` accepts a plain string (the common case) or any React node, so a
 * future call site needing something richer than a paragraph (e.g. a
 * price/amount breakdown for a trade confirmation) can pass JSX instead of
 * text without this component needing to change.
 */
export default function ConfirmSheet({
  open,
  onClose,
  title,
  body,
  cancelLabel,
  confirmLabel,
  confirmingLabel,
  confirming = false,
  onConfirm,
}) {
  return (
    <BottomSheet open={open} onClose={onClose}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "17px", color: "var(--ink-base)", marginBottom: "var(--space-4)" }}>
        {title}
      </div>
      <div style={{ fontFamily: "var(--font-body)", fontSize: "14px", lineHeight: 1.5, color: "var(--ink-soft)", marginBottom: "var(--space-8)" }}>
        {body}
      </div>
      <div style={{ display: "flex", gap: "var(--space-4)" }}>
        <button
          type="button"
          onClick={onClose}
          disabled={confirming}
          style={{
            flex: 1,
            height: 48,
            background: "var(--cream-deep)",
            border: "1px solid var(--cream-line)",
            borderRadius: "var(--radius-md)",
            fontFamily: "var(--font-body)",
            fontWeight: 600,
            fontSize: "14px",
            color: "var(--ink-base)",
            cursor: confirming ? "not-allowed" : "pointer",
            opacity: confirming ? 0.6 : 1,
          }}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirming}
          style={{
            flex: 1,
            height: 48,
            background: "var(--teal-base)",
            border: "none",
            borderRadius: "var(--radius-md)",
            fontFamily: "var(--font-body)",
            fontWeight: 600,
            fontSize: "14px",
            color: "var(--on-accent)",
            cursor: confirming ? "not-allowed" : "pointer",
            opacity: confirming ? 0.6 : 1,
          }}
        >
          {confirming ? confirmingLabel : confirmLabel}
        </button>
      </div>
    </BottomSheet>
  );
}
