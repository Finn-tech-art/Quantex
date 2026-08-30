// Layout wrapper for the app's tab-root screens — mounted once as a nested
// layout route in App.jsx around all 5 bottom-nav destinations (Home,
// Markets, Bots, Wallet, Menu — see App.jsx's AppShell route group).
// Renders whichever page is active via <Outlet/>, with the fixed TabBar
// pinned below it.
//
// Deliberately does NOT render a fake mobile status bar (a clock, carrier
// bars, etc.) even though the HTML mockups this project was designed from
// each open with one — that "status-bar" element only makes sense on a
// static image built to LOOK LIKE a phone screenshot inside a phone-frame
// mockup. This is a real, running web app viewed in a real browser (which
// already has its own real clock, and is frequently not even phone-width),
// so faking device chrome here would just be visual noise, not fidelity to
// the design. What the mockups' "status-bar" conceptually protects against
// — content sitting flush against the very top edge — is instead handled
// by each page's own top padding, same as every page already does today.
//
// bottomInset reserves exactly the tab bar's own height (74px, matching
// TabBar.jsx / the design spec's Bottom Tab Bar) as scroll-content padding,
// so the last item on a page can never end up hidden behind the fixed bar.
import { Outlet } from "react-router-dom";
import TabBar from "./TabBar";

const TAB_BAR_HEIGHT = 74;

export default function AppShell() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--cream-base)" }}>
      <div style={{ paddingBottom: TAB_BAR_HEIGHT }}>
        <Outlet />
      </div>
      <TabBar />
    </div>
  );
}
