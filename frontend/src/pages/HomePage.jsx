// The screen the user lands on right after logging in — rebuilt against
// quantex-component-composition.md's "3a. Home" structure (dash-top ->
// hero card -> quick actions -> Active bots -> Leaderboard -> News) and
// quantex-design-system-spec_2.md Section 10's Home layout spec, following
// the "Bybit structure, Quantex colours" direction decided for this
// project: Bybit's density/shape language (hero card, duotone quick-action
// tiles, dense list rows) rendered in Quantex's own cream/teal palette.
//
// Real data sources:
//   - getBalances()         -> the hero card's total balance figure
//   - getPortfolioHistory() -> the hero card's sparkline + %-change delta
//                              (see backend/app/services/
//                              portfolio_history_service.py — derived live
//                              from the ledger, no snapshot table)
//   - listBots()             -> the Active bots section
// Leaderboard and News have no real data source yet (no trader-ranking
// system, no news feed) — per the design discussion for this screen, both
// render clearly PREVIEW-tagged sample content rather than being cut, so
// the full screen composition is visible now and can be wired to a real
// source later without a layout change.
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AnimatedPsi from "../components/AnimatedPsi";
import DeltaChip from "../components/DeltaChip";
import Icon from "../components/Icon";
import VerifyEmailPrompt from "../components/VerifyEmailPrompt";
import { getBalances, getPortfolioHistory, listBots } from "../lib/api";

export default function HomePage() {
  const { t } = useTranslation();
  const { user, accessToken } = useAuth();

  const [totalUsd, setTotalUsd] = useState(null); // null = still loading
  const [history, setHistory] = useState(null); // null = still loading, [] = loaded but empty
  const [bots, setBots] = useState(null);
  // Which RangeTabs pill is selected — one of RANGE_OPTIONS' `value`s
  // below. Lives here (not inside HeroCard) because changing it has to
  // trigger the getPortfolioHistory refetch in the effect right below.
  const [range, setRange] = useState("7d");
  // Local-only UI toggle for the eye icon next to "Total Assets" — never
  // sent to the backend, doesn't affect what data is fetched, just
  // whether the dollar figure renders as digits or as dot placeholders.
  const [balanceHidden, setBalanceHidden] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    getBalances(accessToken).then((res) =>
      setTotalUsd(res.balances.reduce((sum, b) => sum + Number(b.amount), 0))
    );
    listBots(accessToken).then((res) => setBots(res.bots));
  }, [accessToken]);

  // Separate effect (rather than folded into the one above) so that
  // switching RangeTabs pills only ever re-triggers this fetch, not a
  // redundant getBalances/listBots round-trip too.
  useEffect(() => {
    if (!accessToken) return;
    // Reset to null first so the hero card shows its loading spinner
    // during the refetch instead of briefly flashing the old range's
    // chart under the new range's %. 12 buckets matches the design
    // spec's "12 candles" hero chart — change the `buckets` value here
    // for a denser/sparser chart; the backend has no opinion on it
    // beyond a 500-bucket sanity cap.
    setHistory(null);
    getPortfolioHistory(accessToken, { range, buckets: 12 }).then((res) => setHistory(res.points));
  }, [accessToken, range]);

  if (!user) return null;

  const activeBots = (bots || []).filter((b) => b.status === "ACTIVE");
  // First name only, derived from the email's local part — there's no
  // separate "display name" field anywhere in the schema (see UserProfile
  // in models/auth.py), so this is the closest thing to a name available.
  const firstName = (user.email || "").split("@")[0];

  return (
    <div style={{ paddingTop: "var(--space-11)" }}>
      <div style={{ maxWidth: 384, margin: "0 auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: "var(--space-16)" }}>
        <TopRow greeting={t("home.greeting", { name: firstName })} />

        {!user.email_verified && <VerifyEmailPrompt />}

        <HeroCard
          totalUsd={totalUsd}
          history={history}
          range={range}
          onRangeChange={setRange}
          balanceHidden={balanceHidden}
          onToggleBalanceHidden={() => setBalanceHidden((v) => !v)}
          t={t}
        />

        <QuickActions t={t} />

        <BotsAndAdsSection bots={activeBots} loading={bots === null} t={t} />

        <LeaderboardSection t={t} />

        <NewsSection t={t} />
      </div>
    </div>
  );
}

function TopRow({ greeting }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "18px", color: "var(--ink-base)" }}>{greeting}</span>
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: "var(--radius-full)",
          background: "var(--cream-deep)",
          border: "1px solid var(--cream-line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="bell" size={17} color="var(--ink-soft)" />
      </div>
    </div>
  );
}

// The 4 pills RangeTabs renders, in display order. `value` is exactly
// what getPortfolioHistory sends as the `range` query param (must match
// a key backend/app/routers/wallet.py's _SUPPORTED_RANGES allows, and
// portfolio_history_service.py's _RANGE_TO_TIMEDELTA has an entry for) —
// to add a 5th tab (e.g. "24h" or "all", both already backend-supported),
// add a row here and nowhere else on the frontend.
const RANGE_OPTIONS = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "180d", label: "180D" },
];

function HeroCard({ totalUsd, history, range, onRangeChange, balanceHidden, onToggleBalanceHidden, t }) {
  const loading = totalUsd === null || history === null;
  const firstClose = history && history.length > 0 ? Number(history[0].close) : null;
  const lastClose = history && history.length > 0 ? Number(history[history.length - 1].close) : null;
  const pctChange = firstClose && firstClose !== 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;
  const isUp = pctChange >= 0;
  const deltaColor = isUp ? "var(--gain-on-dark)" : "var(--loss)";
  const rangeLabel = RANGE_OPTIONS.find((o) => o.value === range)?.label ?? range;

  return (
    <div
      style={{
        background: "var(--teal-deep)",
        borderRadius: "var(--radius-2xl)",
        padding: "var(--space-11)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
        <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", letterSpacing: "0.08em", color: "var(--teal-sage)" }}>
          {t("home.hero.label")}
        </span>
        {/* Local-only visibility toggle — doesn't touch totalUsd itself,
            just swaps what's rendered below between digits and dots, so
            no re-fetch or state reset happens on click. */}
        <button
          type="button"
          onClick={onToggleBalanceHidden}
          aria-label={balanceHidden ? "Show balance" : "Hide balance"}
          style={{ display: "flex", alignItems: "center", background: "none", border: "none", padding: 0, cursor: "pointer" }}
        >
          <Icon name={balanceHidden ? "eyeOff" : "eye"} size={14} color="var(--teal-sage)" />
        </button>
      </div>

      {loading ? (
        <AnimatedPsi mode="working" size={26} color="var(--on-accent)" />
      ) : (
        <>
          <span className="qx-num" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "32px", color: "var(--on-accent)" }}>
            {balanceHidden
              ? "••••••"
              : `$${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </span>

          {history.length > 1 && <Sparkline points={history} color={isUp ? "var(--gain-on-dark)" : "var(--loss)"} />}

          <span style={{ fontFamily: "var(--font-data)", fontSize: "12px", color: deltaColor }}>
            {isUp ? "+" : ""}
            {pctChange.toFixed(2)}%{t("home.hero.deltaSuffix", { range: rangeLabel })}
          </span>

          <RangeTabs selected={range} onSelect={onRangeChange} />
        </>
      )}
    </div>
  );
}

// Bybit-style range-tab row under the hero chart — a flat row of text
// pills, the selected one picked out with a filled background rather
// than an underline. Sits on the dark --teal-deep hero card, so it uses
// the same --on-accent / --teal-sage fixed-on-dark tokens the rest of
// the card uses (see index.css's note on --on-accent for why those two
// never flip with the light/dark theme toggle).
function RangeTabs({ selected, onSelect }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-3)" }}>
      {RANGE_OPTIONS.map((opt) => {
        const active = opt.value === selected;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            style={{
              fontFamily: "var(--font-data)",
              fontSize: "11px",
              fontWeight: active ? 600 : 400,
              color: active ? "var(--on-accent)" : "var(--teal-sage)",
              // Derived from --on-accent itself (never a hardcoded hex) so
              // this pill's fill stays correct if that token's value ever
              // changes — color-mix blends it down to a subtle wash rather
              // than a solid block.
              background: active ? "color-mix(in srgb, var(--on-accent) 14%, transparent)" : "none",
              border: "none",
              borderRadius: "var(--radius-sm)",
              padding: "4px 10px",
              cursor: "pointer",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// A minimal hand-rolled area+line sparkline — deliberately not the
// lightweight-charts-based LiveChart.jsx component (which draws a full
// interactive chart with a time axis, UTC label, and BUY/SELL markers for
// a bot's activity page): this is a ~64px decorative trend line inside the
// hero card, so pulling in the same heavier charting library a second
// time for a much smaller job isn't worth it. Coordinates are normalized
// against this data's own min/max close, then laid out evenly across a
// fixed viewBox that scales to 100% width via preserveAspectRatio="none".
//
// preserveAspectRatio="none" stretches the viewBox's X and Y independently
// to fill the container — great for the line's shape, but it means a
// plain strokeWidth (defined in viewBox units) gets dragged along with
// whichever axis a given segment's stroke happens to point into, so a
// near-vertical swing renders visibly thicker on screen than a near-flat
// stretch, even though the path itself always used the same stroke-width
// number. `vectorEffect="non-scaling-stroke"` is the standard SVG fix —
// it locks the stroke to a constant width in real screen pixels regardless
// of any transform/non-uniform-scale applied to the path's geometry, so
// every segment reads the same thickness no matter its angle.
//
// The glow is the classic "blur a copy, then draw the crisp line on top"
// SVG filter technique: feGaussianBlur softens a duplicate of the stroke,
// feMerge layers the original SourceGraphic back on top of that blur so
// the line itself stays sharp with just a soft halo around it. Tuned
// deliberately subtle (stdDeviation 1.6, blurred copy at partial opacity)
// per "a little bit" — raise stdDeviation for a bigger halo, or the blur
// layer's strokeOpacity for a stronger one.
function Sparkline({ points, height = 56, color }) {
  const width = 300;
  const glowId = useId();
  const closes = points.map((p) => Number(p.close));
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1; // avoid divide-by-zero on a perfectly flat line
  const stepX = width / (closes.length - 1);

  const coords = closes.map((c, i) => [i * stepX, height - ((c - min) / range) * height]);
  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      <defs>
        <filter id={glowId} x="-30%" y="-60%" width="160%" height="220%">
          <feGaussianBlur stdDeviation="1.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path d={areaPath} fill={color} fillOpacity="0.16" stroke="none" />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        filter={`url(#${glowId})`}
      />
    </svg>
  );
}

function QuickActions({ t }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-6)" }}>
      <QuickTile to="/deposit" icon="deposit" label={t("home.quickActions.deposit")} />
      <QuickTile to="/withdraw" icon="withdraw" label={t("home.quickActions.withdraw")} />
      <QuickTile to="/bots/create" icon="newBot" label={t("home.quickActions.newBot")} />
    </div>
  );
}

// Duotone tile — rounded square, soft tinted background behind a solid
// coloured glyph — this is the Bybit-derived quick-action shape (replacing
// the earlier flat pill buttons) called out specifically in the frontend
// direction discussion for this project.
function QuickTile({ to, icon, label }) {
  return (
    <Link
      to={to}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-4)",
        textDecoration: "none",
      }}
    >
      <div
        style={{
          width: "100%",
          aspectRatio: "1.4",
          borderRadius: "var(--radius-lg)",
          background: "var(--teal-pale)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={22} color="var(--teal-base)" />
      </div>
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "11.5px", color: "var(--ink-base)" }}>{label}</span>
    </Link>
  );
}

function SectionHeader({ title, action }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "14px", color: "var(--ink-base)" }}>{title}</span>
      {action}
    </div>
  );
}

function ActiveBotsSection({ bots, loading, t }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <SectionHeader
        title={t("home.activeBots.title")}
        action={
          <Link to="/bots" style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--teal-base)", textDecoration: "none" }}>
            {t("home.activeBots.seeAll")}
          </Link>
        }
      />

      {loading ? (
        <AnimatedPsi mode="working" size={22} color="var(--teal-base)" />
      ) : bots.length === 0 ? (
        <EmptyBotsCard t={t} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          {bots.map((bot) => (
            <BotCard key={bot.id} bot={bot} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyBotsCard({ t }) {
  return (
    <Link
      to="/bots/create"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-4)",
        background: "var(--cream-deep)",
        border: "1px dashed var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-8)",
        textDecoration: "none",
      }}
    >
      <Icon name="newBot" size={18} color="var(--teal-base)" />
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "12.5px", color: "var(--teal-base)" }}>
        {t("home.activeBots.cta")}
      </span>
    </Link>
  );
}

function BotCard({ bot }) {
  const pnl = Number(bot.total_pnl);
  const pnlTone = pnl > 0 ? "up" : pnl < 0 ? "down" : "neutral";
  return (
    <Link
      to={`/bots/${bot.id}`}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "12px 14px",
        textDecoration: "none",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "13px", color: "var(--ink-base)" }}>{bot.pair}</span>
        <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", letterSpacing: "0.03em", color: "var(--ink-soft)" }}>
          {bot.strategy_type}
        </span>
      </div>
      <DeltaChip tone={pnlTone} fontSize="13px">
        {pnl > 0 ? "+" : ""}
        {pnl.toFixed(2)}
      </DeltaChip>
    </Link>
  );
}

// Sample content only — see the module comment at the top of this file for
// why (no trader-ranking system exists yet). The PREVIEW tag keeps this
// honest at a glance rather than reading as a real, working feature.
function LeaderboardSection({ t }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <SectionHeader title={t("home.leaderboard.title")} action={<PreviewTag t={t} />} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--cream-deep)",
          border: "1px solid var(--cream-line)",
          borderRadius: "var(--radius-lg)",
          padding: "12px 14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: "var(--radius-full)",
              background: "var(--teal-pale)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "13px",
              color: "var(--teal-deep)",
            }}
          >
            Q
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "13px", color: "var(--ink-base)" }}>
              {t("home.leaderboard.traderName")}
            </span>
            <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", color: "var(--ink-soft)" }}>
              {t("home.leaderboard.traderSub")}
            </span>
          </div>
        </div>
        <span style={{ fontFamily: "var(--font-data)", fontSize: "13px", color: "var(--gain)" }}>+18.4%</span>
      </div>
    </div>
  );
}

// Sample content only — no news source exists yet. Same PREVIEW-tag
// treatment as LeaderboardSection above.
function NewsSection({ t }) {
  const sampleItems = [
    { tag: "MARKET", title: "BTC holds above key support after weekend volatility", meta: "2h ago" },
    { tag: "PRODUCT", title: "Grid bots now support tighter range configurations", meta: "1d ago" },
    { tag: "MARKET", title: "ETH network activity climbs into the new week", meta: "2d ago" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <SectionHeader title={t("home.news.title")} action={<PreviewTag t={t} />} />
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        {sampleItems.map((item, i) => (
          <div
            key={i}
            style={{
              background: "var(--cream-deep)",
              border: "1px solid var(--cream-line)",
              borderRadius: "var(--radius-lg)",
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
            }}
          >
            <span style={{ fontFamily: "var(--font-data)", fontSize: "9px", letterSpacing: "0.05em", color: "var(--teal-base)" }}>
              {item.tag}
            </span>
            <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "12.5px", color: "var(--ink-base)" }}>{item.title}</span>
            <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", color: "var(--ink-soft)" }}>{item.meta}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewTag({ t }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-data)",
        fontSize: "9px",
        letterSpacing: "0.05em",
        color: "var(--warning-text)",
        background: "var(--warning-bg)",
        padding: "2px 6px",
        borderRadius: "var(--radius-xs)",
      }}
    >
      {t("home.leaderboard.preview")}
    </span>
  );
}
