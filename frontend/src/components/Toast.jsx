// Renders the floating toast stack. All the QUEUE logic (what's showing,
// how long each one lives, when it starts leaving) lives in
// ToastContext.jsx — this file is pixels only, reading that context's
// `toasts` array and drawing it.
//
// Visual spec: quantex-design-system-spec_2.md Section 9 ("Toast /
// Non-blocking Error") supplies background/border/radius/padding, and
// quantex-component-composition.md's failure-states table supplies the
// "bottom-anchored, auto-dismiss, left accent border by severity"
// behavior. The spec only ever defined error (--loss) and warning
// (--pending-dot) accents — success (--gain) and info (--teal-base) are
// this project's own extension of that same pattern, added because the
// app needs positive/neutral toasts too (e.g. "Buy successful"), not just
// error ones.
//
// One value here has no matching design token and is used as a literal on
// purpose: the 10px corner radius. The token scale jumps from 8px
// (--radius-sm) to 12px (--radius-md) with nothing at 10px, but the spec
// calls out 10px specifically — same reasoning as AnimatedPsi.jsx's
// already-precedented off-token 2.4s animation duration.
import { useToast } from "../context/ToastContext";
import Icon from "./Icon";

// Maps each toast severity to its left accent border color and the
// Icon.jsx glyph shown beside the message. To add a new severity: add a
// key here, AND a matching convenience method in ToastContext.jsx's
// `value` object (e.g. `value.info` calls showToast(message, "info")) —
// this map alone doesn't create new ways to fire a toast, it only decides
// how an existing variant string renders.
const VARIANTS = {
  success: { color: "var(--gain)", icon: "checkCircle" },
  error: { color: "var(--loss)", icon: "alertCircle" },
  warning: { color: "var(--pending-dot)", icon: "alertCircle" },
  info: { color: "var(--teal-base)", icon: "infoCircle" },
};

// Distance from the bottom of the screen. TabBar.jsx's tab bar is a fixed
// 74px tall (see its own `height: 74` comment) — this adds 16px of margin
// above it so toasts never sit flush against it on tab-root screens. On
// pushed screens with no tab bar (e.g. BotDetailPage), this just reads as
// slightly extra bottom margin, which is harmless. If TabBar's height
// ever changes, update the 74 below to match.
const BOTTOM_OFFSET = 74 + 16;

export default function Toast() {
  const { toasts, dismiss } = useToast();

  // Renders nothing at all (not even an empty positioned wrapper) when
  // there's nothing to show, so this component never affects layout or
  // hit-testing anywhere on a toast-free screen.
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: BOTTOM_OFFSET,
        display: "flex",
        // column-reverse means the LAST array entry (the newest toast)
        // renders closest to the bottom of the screen, with older ones
        // stacking upward above it — matches the usual "new one arrives
        // at the bottom, pushes the rest up" toast convention.
        flexDirection: "column-reverse",
        alignItems: "center",
        gap: "var(--space-4)",
        // Sits above normal page content but doesn't need to compete with
        // anything else fixed-position in this app.
        zIndex: 1000,
        // The container spans the full screen width so its children can
        // be centered, but only the toast pills themselves should ever
        // capture a tap — see pointerEvents: "auto" below.
        pointerEvents: "none",
        padding: "0 var(--space-8)",
      }}
    >
      {toasts.map((t) => {
        const variant = VARIANTS[t.variant] || VARIANTS.info;
        return (
          <div
            key={t.id}
            // Tapping a toast dismisses it early instead of waiting out
            // the full VISIBLE_MS in ToastContext.jsx.
            onClick={() => dismiss(t.id)}
            style={{
              pointerEvents: "auto",
              cursor: "pointer",
              width: "100%",
              maxWidth: 360,
              display: "flex",
              alignItems: "center",
              gap: "var(--space-4)",
              background: "var(--cream-deep)",
              border: "1px solid var(--cream-line)",
              borderLeft: `3px solid ${variant.color}`,
              borderRadius: "10px",
              padding: "var(--space-6)",
              // Fade + slight downward slide on the way out. Duration
              // must match LEAVE_MS in ToastContext.jsx (currently 200ms
              // there, 0.2s here) — see that file's comment on LEAVE_MS
              // for why they have to stay in sync.
              opacity: t.leaving ? 0 : 1,
              transform: t.leaving ? "translateY(8px)" : "translateY(0)",
              transition: "opacity 0.2s ease, transform 0.2s ease",
            }}
          >
            <Icon name={variant.icon} size={20} color={variant.color} />
            <span
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 14,
                color: "var(--ink-base)",
                flex: 1,
              }}
            >
              {t.message}
            </span>
          </div>
        );
      })}
    </div>
  );
}
