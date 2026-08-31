// Small tab-style nav shared by every admin screen (AdminWinRatePage.jsx,
// AdminKycQueuePage.jsx, and any future one) — without this, each admin
// page is only reachable by typing its URL directly, since none of them
// link to each other. Add a new { to, labelKey } entry here and it shows
// up on every admin page automatically; nothing else needs to change.

import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

const LINKS = [
  { to: "/admin/overview", labelKey: "admin.nav.overview" },
  { to: "/admin/win-rate", labelKey: "admin.nav.winRate" },
  { to: "/admin/kyc", labelKey: "admin.nav.kyc" },
  { to: "/admin/withdrawals", labelKey: "admin.nav.withdrawals" },
  { to: "/admin/withdrawal-fee", labelKey: "admin.nav.withdrawalFee" },
  { to: "/admin/withdrawal-unlock-fees", labelKey: "admin.nav.unlockFees" },
  { to: "/admin/consolidation-addresses", labelKey: "admin.nav.consolidation" },
  { to: "/admin/sweeps", labelKey: "admin.nav.sweeps" },
];

export default function AdminNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  return (
    <div style={{ display: "flex", gap: "var(--space-4)" }}>
      {LINKS.map((link) => {
        const active = pathname === link.to;
        return (
          <Link
            key={link.to}
            to={link.to}
            style={{
              fontFamily: "var(--font-body)",
              fontWeight: 600,
              fontSize: "11px",
              padding: "7px 12px",
              borderRadius: "var(--radius-md)",
              textDecoration: "none",
              color: active ? "var(--on-accent)" : "var(--ink-soft)",
              background: active ? "var(--teal-base)" : "var(--cream-deep)",
              border: `1px solid ${active ? "var(--teal-base)" : "var(--cream-line)"}`,
            }}
          >
            {t(link.labelKey)}
          </Link>
        );
      })}
    </div>
  );
}
