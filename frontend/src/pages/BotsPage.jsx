// Lists every bot the logged-in user has, plus a "Create bot" entry point
// (module 4 — always creates a simulated/scripted bot; there's still no
// self-serve real-Grid creation, that's module 3.7).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AnimatedPsi from "../components/AnimatedPsi";
import { listBots } from "../lib/api";

export default function BotsPage() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  // null means "still loading" — distinct from an empty array, which means
  // "loaded, and there really are zero bots" — so the UI can tell those two
  // states apart instead of flashing "no bots" for a moment before the
  // real list arrives.
  const [bots, setBots] = useState(null);

  useEffect(() => {
    if (!accessToken) return;
    listBots(accessToken).then((res) => setBots(res.bots));
  }, [accessToken]);

  return (
    <div style={{ paddingTop: "var(--space-11)" }}>
      <div style={{ maxWidth: 384, margin: "0 auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "18px", color: "var(--ink-base)" }}>
          {t("bots.title")}
        </span>

        <CreateBotCard t={t} />

        {bots === null ? (
          <AnimatedPsi mode="working" size={26} color="var(--teal-base)" />
        ) : bots.length === 0 ? (
          <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)" }}>
            {t("bots.none")}
          </span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
            {bots.map((bot) => (
              <BotRow key={bot.id} bot={bot} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CreateBotCard({ t }) {
  return (
    <Link
      to="/bots/create"
      style={{
        border: "1.5px dashed var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "12px 14px",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: "var(--space-4)",
        textDecoration: "none",
      }}
    >
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", color: "var(--teal-base)" }}>
        + {t("bots.create.title")}
      </span>
    </Link>
  );
}

function BotRow({ bot }) {
  const { t } = useTranslation();
  // Positive/zero P&L reads as a gain color, negative as a loss color —
  // exactly the semantic-color rule from the design system (never mix these
  // up with the teal brand colors, which is why they're their own CSS vars).
  const pnlValue = Number(bot.total_pnl);
  const pnlColor = pnlValue >= 0 ? "var(--gain)" : "var(--loss)";

  return (
    <Link
      to={`/bots/${bot.id}`}
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "12px 14px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        textDecoration: "none",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", color: "var(--ink-base)" }}>
          {bot.pair} · {bot.strategy_type}
          {bot.is_paper ? ` · ${t("bots.paper")}` : ""}
        </span>
        <span style={{ fontFamily: "var(--font-data)", fontSize: "9.5px", color: "var(--ink-soft)" }}>
          {bot.status}
        </span>
      </div>
      <span style={{ fontFamily: "var(--font-data)", fontSize: "12.5px", color: pnlColor }}>
        {pnlValue >= 0 ? "+" : ""}
        {pnlValue.toFixed(2)}
      </span>
    </Link>
  );
}
