// The Menu tab — composition doc's "3b. Menu" screen: a header (avatar +
// name + member-since) followed by grouped rows, matching
// quantex-component-composition.md's 6-group structure (Trading / Manage
// assets / Rewards / Earn[Phase 2] / Account / More).
//
// Every row here links to a route that actually exists EXCEPT where
// explicitly marked `disabled` below — those are real, named product
// concepts (Referrals is backed by the `referral_credit_statuses` table
// already in the schema; Language reflects the i18n scaffolding that's
// there from day one per this project's stack) that just don't have a
// screen built yet, rendered dim/inert in --ink-soft per the design
// spec's "disabled/Phase-2 icons render in --ink-soft" rule (Section 7)
// rather than linking somewhere broken. Nothing on this screen is an
// invented feature name — see the module's git history / conversation
// for why that line was drawn deliberately.
//
// The composition doc's Rewards group uses a 2x2 "quad" grid rather than
// a vertical list — that's skipped here in favor of a normal row, because
// filling a 2x2 grid honestly would need 4 distinct real reward concepts
// and only one (Referrals) currently exists anywhere in the schema.
// Revisit as a quad once there's real content for the other 3 slots.

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import Icon from "../components/Icon";
import Switch from "../components/Switch";

export default function MenuPage() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  if (!user) return null;

  const memberSince = new Date(user.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
  });
  const initial = (user.email || "?").charAt(0).toUpperCase();

  return (
    <div style={{ paddingTop: "var(--space-11)", paddingBottom: "var(--space-16)" }}>
      <div style={{ maxWidth: 384, margin: "0 auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: "var(--space-16)" }}>
        {/* menu-header */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "var(--radius-full)",
              background: "var(--teal-deep)",
              color: "var(--on-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "22px",
              flexShrink: 0,
            }}
          >
            {initial}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: "16px",
                color: "var(--ink-base)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {user.email}
            </span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)" }}>
              {t("menu.memberSince", { date: memberSince })}
            </span>
          </div>
        </div>

        <MenuGroup label={t("menu.groups.trading")}>
          <MenuItem icon="bots" to="/bots" text={t("menu.items.bots")} />
          <MenuItem icon="newBot" to="/bots/create" text={t("menu.items.createBot")} />
        </MenuGroup>

        <MenuGroup label={t("menu.groups.manageAssets")}>
          <MenuItem icon="deposit" to="/deposit" text={t("menu.items.deposit")} />
          <MenuItem icon="withdraw" to="/withdraw" text={t("menu.items.withdraw")} />
          <MenuItem icon="wallet" to="/wallet" text={t("menu.items.wallet")} />
        </MenuGroup>

        <MenuGroup label={t("menu.groups.rewards")}>
          <MenuItem icon="gift" text={t("menu.items.referrals")} disabled disabledNote={t("menu.items.comingSoon")} />
        </MenuGroup>

        <MenuGroup label={t("menu.groups.earn")}>
          <MenuItem icon="markets" text={t("menu.groups.earn")} disabled disabledNote={t("menu.items.comingSoon")} />
        </MenuGroup>

        <MenuGroup label={t("menu.groups.account")}>
          <MenuItem
            icon="moon"
            text={t("menu.items.darkMode")}
            trailing={<Switch checked={theme === "dark"} onChange={toggleTheme} label={t("menu.items.darkMode")} />}
          />
          <MenuItem icon="shield" to="/kyc" text={t("menu.items.kyc")} />
          <MenuItem icon="globe" text={t("menu.items.language")} disabled disabledNote="English" />
          <MenuItem icon="settings" text={t("menu.items.settings")} disabled disabledNote={t("menu.items.comingSoon")} />
        </MenuGroup>

        <MenuGroup label={t("menu.groups.more")}>
          <MenuItem icon="logout" text={t("menu.items.logout")} onClick={logout} />
        </MenuGroup>
      </div>
    </div>
  );
}

function MenuGroup({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <span
        style={{
          fontFamily: "var(--font-data)",
          fontSize: "10px",
          letterSpacing: "0.06em",
          color: "var(--ink-soft)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <div
        style={{
          background: "var(--cream-deep)",
          border: "1px solid var(--cream-line)",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// A single row. Pass `to` for a real navigable destination, or `onClick`
// for an action (e.g. logout) — exactly one of the two is expected for an
// enabled row. Pass `disabled` (with an optional `disabledNote`, shown in
// place of the chevron, e.g. "Coming soon" or the current fixed language
// name) to render the row inert: dimmed to --ink-soft, no Link, no click
// handler, per the design spec's disabled/Phase-2 icon color rule. Pass
// `trailing` (e.g. the dark mode row's <Switch>) to replace the default
// chevron with a control that owns its own click handling — the row
// itself renders as an inert div in that case (no Link/button wrapper, no
// row-wide onClick) so a tap anywhere outside the control itself does
// nothing, rather than fighting the control for who handles the click.
function MenuItem({ icon, to, text, onClick, disabled, disabledNote, trailing }) {
  const color = disabled ? "var(--ink-soft)" : "var(--ink-base)";
  const content = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
        <Icon name={icon} size={20} color={disabled ? "var(--ink-soft)" : "var(--teal-base)"} />
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "13.5px", color }}>{text}</span>
      </div>
      {trailing ? (
        trailing
      ) : disabled ? (
        <span style={{ fontFamily: "var(--font-body)", fontSize: "11.5px", color: "var(--ink-soft)" }}>{disabledNote}</span>
      ) : (
        <Icon name="chevronRight" size={18} color="var(--ink-soft)" />
      )}
    </>
  );

  const rowStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "13px 14px",
    borderBottom: "1px solid var(--cream-line)",
    textDecoration: "none",
    cursor: disabled || trailing ? "default" : "pointer",
    background: "none",
    border: "none",
    width: "100%",
    textAlign: "left",
  };

  if (trailing || disabled) {
    return <div style={rowStyle}>{content}</div>;
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} style={rowStyle}>
        {content}
      </button>
    );
  }
  return (
    <Link to={to} style={rowStyle}>
      {content}
    </Link>
  );
}
