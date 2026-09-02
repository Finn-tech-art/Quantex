// Navigation for every admin screen (AdminWinRatePage.jsx,
// AdminKycQueuePage.jsx, and any future one) — without this, each admin
// page is only reachable by typing its URL directly, since none of them
// link to each other. Add a new { to, labelKey } entry to LINKS below and
// it shows up automatically; nothing else needs to change.
//
// This used to render all 8 links as a single non-wrapping row of tab
// buttons. That worked fine back when there were only 2-3 admin pages, but
// at 8 entries the row is simply wider than the 384px-max mobile column
// every admin page renders inside — the tabs overflowed/got crushed
// together, which is the concrete "admin UI looks broken" bug this file
// was rewritten to fix. It's now a collapsed hamburger button (showing the
// current page's name so you always know where you are) that opens a
// full-height slide-in drawer listing every link — the same "menu"
// pattern most mobile apps use once there are too many destinations for a
// row of tabs to hold. The open/close animation timing and two-phase
// mounted/entered state below deliberately mirrors BottomSheet.jsx's
// existing pattern (see that file's comments for why it's split into two
// pieces of state) so this behaves identically to every other overlay in
// the app rather than inventing a new animation style.

import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Icon from "./Icon";

const LINKS = [
  { to: "/admin/overview", labelKey: "admin.nav.overview" },
  { to: "/admin/win-rate", labelKey: "admin.nav.winRate" },
  { to: "/admin/session-limits", labelKey: "admin.nav.sessionLimits" },
  { to: "/admin/balance", labelKey: "admin.nav.balance" },
  { to: "/admin/kyc", labelKey: "admin.nav.kyc" },
  { to: "/admin/withdrawals", labelKey: "admin.nav.withdrawals" },
  { to: "/admin/withdrawal-fee", labelKey: "admin.nav.withdrawalFee" },
  { to: "/admin/withdrawal-unlock-fees", labelKey: "admin.nav.unlockFees" },
  { to: "/admin/consolidation-addresses", labelKey: "admin.nav.consolidation" },
  { to: "/admin/sweeps", labelKey: "admin.nav.sweeps" },
];

// How long the slide/fade transition takes, one way — change this single
// number to speed up or slow down the drawer's open/close animation (it
// drives both the backdrop fade and the panel's slide-in transform below,
// so they always stay in sync with each other).
const ANIMATION_MS = 220;

// How wide the drawer gets, as a fraction of the viewport — 82% leaves a
// sliver of the previous page visible on the right so it's obvious this is
// an overlay you can dismiss, not a full new screen. `MAX_WIDTH_PX` caps
// that on wider phones/tablets so the drawer doesn't stretch edge to edge.
const WIDTH_VW = "82vw";
const MAX_WIDTH_PX = 300;

export default function AdminNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);

  // Same two-phase show/hide as BottomSheet.jsx: `mounted` keeps the
  // drawer (and its backdrop) in the DOM long enough to play the closing
  // transition, while `entered` is what actually toggles the "open"
  // styles. Without this split, closing would just yank the drawer off
  // screen instantly with no slide-out animation.
  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
    if (mounted) {
      setEntered(false);
      const timer = setTimeout(() => setMounted(false), ANIMATION_MS);
      return () => clearTimeout(timer);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Freeze background scroll while the drawer is open, same as BottomSheet
  // does — otherwise the page underneath can scroll behind the overlay,
  // which feels broken on touch devices in particular.
  useEffect(() => {
    if (!mounted) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mounted]);

  // Escape closes the drawer from a keyboard, same as every other overlay
  // in the app.
  useEffect(() => {
    if (!mounted) return;
    function handleKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mounted]);

  const current = LINKS.find((link) => link.to === pathname);

  return (
    <>
      {/* Collapsed trigger — shows which admin page you're currently on so
          this doubles as a lightweight breadcrumb, not just a button that
          says "Menu" on every single page. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          width: "100%",
          background: "var(--cream-deep)",
          border: "1px solid var(--cream-line)",
          borderRadius: "var(--radius-md)",
          padding: "11px 14px",
          fontFamily: "var(--font-body)",
          fontWeight: 600,
          fontSize: "12.5px",
          color: "var(--ink-base)",
          cursor: "pointer",
        }}
      >
        <Icon name="menu" size={18} color="var(--ink-base)" />
        {current ? t(current.labelKey) : t("admin.nav.menu")}
      </button>

      {mounted && (
        // Dimmed backdrop covering the whole screen — tapping anywhere on
        // it (i.e. anywhere outside the drawer panel itself) closes the
        // drawer, same convention as BottomSheet.jsx's backdrop.
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.5)",
            opacity: entered ? 1 : 0,
            transition: `opacity ${ANIMATION_MS}ms ease`,
            zIndex: 100,
          }}
        >
          <div
            // Stops a tap inside the drawer from bubbling up to the
            // backdrop and closing it out from under you.
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              bottom: 0,
              width: WIDTH_VW,
              maxWidth: MAX_WIDTH_PX,
              background: "var(--cream-base)",
              borderRight: "1px solid var(--cream-line)",
              padding: "var(--space-8)",
              // env(safe-area-inset-*) keeps the header and last link clear
              // of a phone's notch/home-indicator, same technique
              // AppShell.jsx/BottomSheet.jsx already use elsewhere.
              paddingTop: "calc(var(--space-8) + env(safe-area-inset-top, 0px))",
              paddingBottom: "calc(var(--space-8) + env(safe-area-inset-bottom, 0px))",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
              overflowY: "auto",
              transform: entered ? "translateX(0)" : "translateX(-100%)",
              transition: `transform ${ANIMATION_MS}ms ease`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "var(--space-6)",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  fontSize: "14px",
                  color: "var(--ink-base)",
                }}
              >
                {t("admin.nav.menu")}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("admin.nav.menu")}
                style={{ background: "none", border: "none", padding: "var(--space-2)", cursor: "pointer", display: "flex" }}
              >
                <Icon name="close" size={18} color="var(--ink-soft)" />
              </button>
            </div>

            {LINKS.map((link) => {
              const active = pathname === link.to;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  // Closing on click (rather than relying on the route
                  // change to unmount this component) means the closing
                  // slide-out animation actually gets to play instead of
                  // the whole drawer just vanishing instantly as the new
                  // page swaps in.
                  onClick={() => setOpen(false)}
                  style={{
                    fontFamily: "var(--font-body)",
                    fontWeight: 600,
                    fontSize: "12.5px",
                    padding: "12px 12px",
                    borderRadius: "var(--radius-md)",
                    textDecoration: "none",
                    color: active ? "var(--on-accent)" : "var(--ink-base)",
                    background: active ? "var(--teal-base)" : "transparent",
                  }}
                >
                  {t(link.labelKey)}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
