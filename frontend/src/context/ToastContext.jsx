// App-wide toast notifications — the floating "Buy successful" / error
// pop-ups defined in quantex-design-system-spec_2.md Section 9 ("Toast /
// Non-blocking Error") and the bottom-anchored, auto-dismiss behavior
// described in quantex-component-composition.md's failure-states table.
// Any component can call useToast() to fire one; this file only owns the
// QUEUE of what's currently showing and the timers that make each one
// disappear on its own — the actual pixels (colors, layout, animation)
// live in Toast.jsx, the same state/pixels split index.css already uses
// for ThemeContext.jsx vs. the CSS token blocks it drives.
import { createContext, useContext, useState, useRef, useCallback } from "react";

const ToastContext = createContext(null);

// How long a toast stays fully visible before it starts fading out. Bump
// this one number up or down to make every toast in the app linger
// longer or shorter — it applies to all four severities equally.
const VISIBLE_MS = 3500;

// How long the fade/slide-out animation takes once a toast starts leaving.
// This MUST match the CSS transition duration on the leaving toast in
// Toast.jsx (its `opacity`/`transform` transition), or the two will drift
// out of sync — either the toast vanishes mid-animation (this constant
// too high) or sits invisible-but-still-mounted for a moment before React
// actually removes it (this constant too low).
const LEAVE_MS = 200;

// Most toasts allowed on screen at once. If a 4th one is fired while 3
// are already showing, the OLDEST is dropped immediately (no exit
// animation for it — it's being crowded out, not naturally expiring) so a
// burst of quick actions can never make the stack grow without bound.
const MAX_VISIBLE = 3;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  // Every currently-pending auto-dismiss timer, keyed by toast id. Kept in
  // a ref (not state) because timers are a side effect, not something a
  // re-render should ever depend on — this only exists so a manual/early
  // dismiss can cancel a toast's timer instead of leaving it to fire
  // uselessly later against a toast that's already gone.
  const timers = useRef(new Map());
  // Monotonically increasing id source for toasts. A ref (not state) since
  // bumping it should never itself trigger a re-render — only the toasts
  // array changing should.
  const nextId = useRef(0);

  const clearTimer = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  // Actually removes a toast from state — called once its exit animation
  // (started by dismissToast below) has had time to finish.
  const removeToast = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    clearTimer(id);
  }, [clearTimer]);

  // Starts a toast's exit animation (flips `leaving: true`, which
  // Toast.jsx reads to fade/slide it out) and schedules its actual removal
  // once that animation has had time to play. Called both by the
  // auto-dismiss timer below and by a manual tap-to-dismiss in Toast.jsx.
  const dismissToast = useCallback((id) => {
    setToasts((current) => current.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => removeToast(id), LEAVE_MS);
  }, [removeToast]);

  const showToast = useCallback((message, variant = "info") => {
    const id = nextId.current++;
    setToasts((current) => {
      const next = [...current, { id, message, variant, leaving: false }];
      if (next.length > MAX_VISIBLE) {
        const dropped = next.shift();
        clearTimer(dropped.id);
      }
      return next;
    });
    timers.current.set(id, setTimeout(() => dismissToast(id), VISIBLE_MS));
  }, [dismissToast, clearTimer]);

  // Convenience wrappers so call sites read as `toast.success("Buy
  // successful")` rather than `toast.showToast("Buy successful",
  // "success")` everywhere they're used. To add a new severity beyond
  // these four, add a wrapper here AND a matching entry in Toast.jsx's
  // VARIANTS map (which supplies its color/icon) — showToast itself
  // accepts any string, it's VARIANTS that limits what actually renders
  // correctly.
  const value = {
    success: (message) => showToast(message, "success"),
    error: (message) => showToast(message, "error"),
    warning: (message) => showToast(message, "warning"),
    info: (message) => showToast(message, "info"),
    dismiss: dismissToast,
    toasts,
  };

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  return useContext(ToastContext);
}
