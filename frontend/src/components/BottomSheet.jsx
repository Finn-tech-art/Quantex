// Generic bottom-sheet primitive — a dim full-screen overlay behind a
// panel that slides up from the bottom edge of the screen, per
// quantex-component-composition.md's "7b. Pause/Stop Confirmation" pattern
// (full-screen dim overlay -> bottom sheet -> drag handle -> content).
// This file only knows how to show/hide/animate that shell; it has no idea
// what's inside it — ConfirmSheet.jsx builds the title/body/actions layout
// used for Stop (and, soon, Trade) confirmation ON TOP of this component.
//
// NOTE on the drag handle: it's the decorative bar the composition doc
// calls for, matching Bybit's visual convention — this does NOT implement
// an actual drag-to-dismiss swipe gesture. Dismissing happens by tapping
// the dimmed backdrop, pressing Escape, or a Cancel/close button inside
// the sheet's own content.
import { useEffect, useState } from "react";

// How long the slide/fade transition takes, one way. Must match the
// transition duration used below on both the overlay's opacity and the
// sheet's transform — if this drifts out of sync with those, the sheet
// will either pop away mid-animation or sit invisible-but-still-mounted
// for a moment before actually unmounting.
const ANIMATION_MS = 220;

// Module-level (shared across EVERY BottomSheet instance on the page, not
// per-instance state) reference count for the body-scroll lock below.
// This exists because more than one sheet can be mounted and animating at
// the same time — e.g. ProfileDetailsSheet closing itself while opening
// AvatarPicker in the same tap, both of which briefly stay "mounted"
// during their own ANIMATION_MS exit/enter transition. A naive "save
// whatever document.body.style.overflow was when I mounted, restore that
// exact value when I unmount" (what this used to do, per-instance) breaks
// under that overlap: the second sheet to mount captures "hidden" (the
// FIRST sheet's own lock) as its "original" value instead of the page's
// real original value, and restores scroll to "hidden" — permanently —
// when it later closes, even though every sheet is gone. Reference
// counting fixes this the standard way multiple stacked modals share one
// resource: only the FIRST lock in a stack saves the real original value,
// and only the LAST unlock (count back to 0) restores it, regardless of
// which order any sheets in between happened to open/close in.
let scrollLockCount = 0;
let savedBodyOverflow = null;

function lockBodyScroll() {
  if (scrollLockCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLockCount += 1;
}

function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = savedBodyOverflow;
    savedBodyOverflow = null;
  }
}

export default function BottomSheet({ open, onClose, children }) {
  // Splits "should this be in the DOM at all" (mounted) from "should it be
  // showing its OPEN visual state right now" (entered) so closing can play
  // the exit transition before actually unmounting, the same two-phase
  // pattern Toast.jsx uses for its leaving toasts.
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Mounting with `entered` already true would skip straight to the
      // open state with no visible transition — waiting a frame lets the
      // browser paint the closed (off-screen) position first, so the very
      // next style change is what actually animates.
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
    if (mounted) {
      setEntered(false);
      const timer = setTimeout(() => setMounted(false), ANIMATION_MS);
      return () => clearTimeout(timer);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Standard modal behavior: while a sheet is open, the page behind it
  // shouldn't scroll. See the module-level lockBodyScroll/unlockBodyScroll
  // pair's own comment above for why this is reference-counted rather than
  // each instance saving/restoring the ambient value itself — that naive
  // version broke as soon as two sheets were ever mounted at once.
  useEffect(() => {
    if (!mounted) return;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [mounted]);

  // Lets Escape close the sheet from the keyboard, same as tapping the
  // backdrop.
  useEffect(() => {
    if (!mounted) return;
    function handleKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mounted, onClose]);

  if (!mounted) return null;

  return (
    <div
      // Backdrop tap dismisses; a click that starts inside the sheet and
      // ends on the backdrop (e.g. text selection dragged out) would also
      // match this if it landed on the backdrop element itself, but not
      // on the sheet's own onClick stopPropagation below.
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.5)",
        opacity: entered ? 1 : 0,
        transition: `opacity ${ANIMATION_MS}ms ease`,
        zIndex: 100,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
      }}
    >
      <div
        // Stops a click inside the sheet from bubbling up to the backdrop
        // and closing it — otherwise tapping anywhere on the sheet's own
        // content (including the Cancel/Confirm buttons before their own
        // handlers run) would double as a backdrop dismiss.
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 384,
          background: "var(--cream-base)",
          borderTop: "1px solid var(--cream-line)",
          borderTopLeftRadius: "var(--radius-xl)",
          borderTopRightRadius: "var(--radius-xl)",
          padding: "var(--space-8)",
          paddingBottom: "calc(var(--space-8) + env(safe-area-inset-bottom, 0px))",
          transform: entered ? "translateY(0)" : "translateY(100%)",
          transition: `transform ${ANIMATION_MS}ms ease`,
        }}
      >
        {/* Decorative drag handle — see the module comment above for why
            this doesn't actually respond to drag gestures. */}
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: "var(--radius-full)",
            background: "var(--cream-line)",
            margin: "0 auto var(--space-8)",
          }}
        />
        {children}
      </div>
    </div>
  );
}
