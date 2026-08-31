import { useEffect, useRef, useState } from "react";

// Animates a displayed number smoothly from its previous value up (or
// down) to a new `target` over `durationMs`, using requestAnimationFrame
// with an ease-out curve — used by HomePage's hero balance so the figure
// visibly counts up into place on load instead of just popping into
// existence, matching Bybit's own balance reveal.
//
// While `target` is still null (HomePage's totalUsd hasn't loaded yet),
// this returns 0 rather than null — the call site is expected to already
// be showing a loading spinner instead of this number during that time
// (see HeroCard's own `loading` check), so what this returns during that
// window is never actually rendered. The reason it's 0 and not null is
// subtle but matters: it's what makes the count-up start from exactly 0
// the INSTANT the real value arrives, rather than the real value briefly
// flashing on screen for one render before the animation kicks in a frame
// later.
export default function useCountUp(target, durationMs = 700) {
  const [display, setDisplay] = useState(target ?? 0);
  // The value to animate FROM — starts at 0 (mount always happens before
  // `target` resolves) and is updated to the just-reached target once an
  // animation finishes, so a later change animates from the last real
  // value rather than always restarting from 0.
  const fromRef = useRef(target ?? 0);
  const rafRef = useRef(null);

  useEffect(() => {
    // Nothing to animate toward yet — leave `display` at whatever it
    // already is (0, on first mount).
    if (target == null) return;

    const from = fromRef.current;
    // Guards against restarting a fresh animation when this effect re-runs
    // for a reason other than the number actually changing (e.g. a parent
    // re-render passing the identical target again).
    if (from === target) {
      setDisplay(target);
      return;
    }

    const start = performance.now();
    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / durationMs, 1);
      // Ease-out cubic — climbs quickly at first, then settles gently
      // into the final number instead of a constant linear climb, which
      // reads as more "alive" for a monetary figure.
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (target - from) * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [target, durationMs]);

  return display;
}
