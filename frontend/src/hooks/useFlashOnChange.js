import { useEffect, useRef, useState } from "react";

// How long the "fade back to normal" transition takes, in milliseconds,
// once a flash has snapped in. Any call site using this hook's return
// value MUST use this exact same duration in its own `transition` CSS
// (e.g. `transition: color ${FLASH_FADE_MS}ms ease`) — if the two drift
// apart, the hook will clear its state (and the color/background snaps
// back to nothing extra to transition) before or after the CSS transition
// actually finishes, which either cuts the fade short or leaves a stale
// transition sitting around doing nothing. Raise this for a slower, more
// lingering fade; lower it for a snappier one.
export const FLASH_FADE_MS = 600;

// Watches a single numeric value across renders and reports, very briefly,
// which direction it just moved — the mechanism behind "flash the price
// green/red for a moment when it ticks" seen on Bybit's ticker rows and
// price header. This hook only tracks WHEN and WHICH WAY a value changed;
// it has no opinion on color or layout — each call site (TradePage's price
// header, MarketsPage's coin rows) decides what "flash" actually looks
// like for its own element.
//
// Returns null most of the time (nothing currently flashing), or
// { direction: "up" | "down", fading: boolean } while a flash is active.
// `fading` is the key to getting a real SNAP-in-then-EASE-out flash
// instead of a slow symmetric pulse:
//   - fading: false  → the instant the value changes, for exactly one
//     render/frame. A call site should render its "flash color" here with
//     NO css transition, so the color change is instant/jarring on
//     purpose — that instant snap is what makes it read as "something
//     just happened" rather than a gentle fade in.
//   - fading: true    → set one animation frame later. A call site should
//     switch its target color back to normal WITH a `transition: ...
//     ${FLASH_FADE_MS}ms` now turned on, so the browser animates smoothly
//     from the snapped flash color back down to baseline over that
//     duration, instead of also snapping off instantly.
// This is the same two-phase "instant state, then next-frame transition"
// trick BottomSheet.jsx already uses for its open/close slide animation —
// applied here to a color flash instead of a position.
export default function useFlashOnChange(value) {
  const [flash, setFlash] = useState(null);
  // Holds the previous VALUE across renders (not previous flash state) so
  // each new render can tell whether `value` actually moved since last
  // time, and which way.
  const previousRef = useRef(value);
  // Whatever needs cancelling if a second change arrives before the first
  // flash has finished playing out (e.g. the price ticks twice within one
  // 600ms fade) — without this, an old timer could null out a flash that a
  // newer change just started.
  const pendingRef = useRef([]);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = value;

    // No flash on the very first render (previous/value both starting
    // equal, or either side genuinely absent while data is still loading)
    // — there's nothing to compare a brand-new value against yet.
    if (previous == null || value == null || value === previous) return;

    const direction = value > previous ? "up" : "down";

    // Cancel anything left over from a still-in-flight previous flash so
    // it can't fire its cleanup after this newer one has already taken
    // over the same state.
    pendingRef.current.forEach((cancel) => cancel());

    setFlash({ direction, fading: false });
    const raf = requestAnimationFrame(() => setFlash({ direction, fading: true }));
    // +50ms of slack past the fade duration so the transition has
    // definitely finished painting before the state is cleared out from
    // under it.
    const timer = setTimeout(() => setFlash(null), FLASH_FADE_MS + 50);

    pendingRef.current = [() => cancelAnimationFrame(raf), () => clearTimeout(timer)];
  }, [value]);

  // Unmount safety net — stops an in-flight timer/rAF from calling
  // setState on a component that's no longer on screen.
  useEffect(() => () => pendingRef.current.forEach((cancel) => cancel()), []);

  return flash;
}
