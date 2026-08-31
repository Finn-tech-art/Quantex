// The persistent bottom navigation bar — Bybit's structural pattern
// (evenly-spaced tabs, active tab shown as a FILLED icon in the accent
// color while every inactive tab stays outline in --ink-soft) rendered in
// Quantex's own cream/teal palette rather than Bybit's dark/yellow one —
// see the "Bybit structure, Quantex colours" decision this project is
// following for the frontend rework.
//
// 6 tabs, not Bybit's 5 — Trade sits where Bybit's own bottom bar puts it
// (Home / Markets / Trade / ...), added alongside Bots/Wallet/Menu rather
// than replacing any of them, per the explicit call to keep this a real
// persistent tab rather than a quick-action button.
//
// Only rendered inside AppShell.jsx, which mounts on all tab-root routes
// (see App.jsx's AppShell route group). Sizing/spec values (74px total
// height, 12px top / 22px bottom padding for the iOS safe area,
// --cream-deep background) come straight from
// quantex-design-system-spec_2.md Section 9's "Bottom Tab Bar" spec — the
// `flex: 1` layout below scales to any tab count with no changes needed,
// so a 7th tab is just another TABS entry away.

import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Icon from "./Icon";

// One row per tab, in display order. `match` decides which routes count as
// "this tab is active" — Home only matches the exact root path (so it
// doesn't light up on every other screen), while the rest match their
// whole sub-tree (e.g. /trade/history, if that ever becomes a real sub-
// route, would still highlight the Trade tab).
const TABS = [
  { key: "home", icon: "home", to: "/", match: (path) => path === "/" },
  { key: "markets", icon: "markets", to: "/markets", match: (path) => path.startsWith("/markets") },
  { key: "trade", icon: "trade", to: "/trade", match: (path) => path.startsWith("/trade") },
  { key: "bots", icon: "bots", to: "/bots", match: (path) => path.startsWith("/bots") },
  { key: "wallet", icon: "wallet", to: "/wallet", match: (path) => path.startsWith("/wallet") },
  { key: "menu", icon: "menu", to: "/menu", match: (path) => path.startsWith("/menu") },
];

export default function TabBar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  return (
    <nav
      style={{
        position: "fixed",
        bottom: 0,
        // Centers the tab strip in the same max-w-sm column every screen
        // uses, so the bar lines up with page content on wide viewports
        // instead of stretching edge-to-edge.
        left: "50%",
        transform: "translateX(-50%)",
        width: "100%",
        maxWidth: 384,
        height: 74,
        background: "var(--cream-deep)",
        borderTop: "1px solid var(--cream-line)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "12px 8px 22px",
        zIndex: 20,
      }}
    >
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        const color = active ? "var(--teal-base)" : "var(--ink-soft)";
        return (
          <Link
            key={tab.key}
            to={tab.to}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              textDecoration: "none",
            }}
          >
            {/* `key` deliberately changes exactly when this tab's active
                state flips, forcing React to remount the <Icon> (rather
                than just re-render it with new props) at that moment —
                which is what restarts the "qx-tab-pop" CSS animation (see
                index.css) fresh each time. Without a changing key here,
                the animation class would still be attached correctly, but
                the browser would only ever play it once per page load
                (a re-render with an already-applied animation class
                doesn't retrigger the animation). Only the newly-ACTIVE
                icon gets the class; switching away plays no animation. */}
            <Icon
              key={active ? "active" : "inactive"}
              name={tab.icon}
              variant={active ? "filled" : "outline"}
              size={22}
              color={color}
              className={active ? "qx-tab-pop" : undefined}
            />
            <span
              style={{
                fontFamily: "var(--font-data)",
                fontSize: "8.5px",
                letterSpacing: "0.03em",
                color,
              }}
            >
              {t(`nav.${tab.key}`)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
