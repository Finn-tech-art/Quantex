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
//   - getMarkets()           -> the Hots/Spots tabs inside the News widget
//                              (see backend/app/routers/market.py) — same
//                              feed MarketsPage.jsx's full list uses
// Leaderboard has no real data source yet (no trader-ranking system) —
// per the design discussion for this screen, it renders clearly
// PREVIEW-tagged sample content rather than being cut, so the full screen
// composition is visible now and can be wired to a real source later
// without a layout change. The News tab (inside the News/Hots/Spots widget
// below Leaderboard) is the same situation — no news feed exists yet — but
// Hots and Spots, its two sibling tabs, are both real live data.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AnimatedPsi from "../components/AnimatedPsi";
import CoinLogo from "../components/CoinLogo";
import DeltaChip from "../components/DeltaChip";
import Icon from "../components/Icon";
import NotificationBell from "../components/NotificationBell";
import VerifyEmailPrompt from "../components/VerifyEmailPrompt";
import { getBalances, getMarkets, getPortfolioHistory, listBots } from "../lib/api";

export default function HomePage() {
  const { t } = useTranslation();
  const { user, accessToken } = useAuth();

  const [totalUsd, setTotalUsd] = useState(null); // null = still loading
  const [history, setHistory] = useState(null); // null = still loading, [] = loaded but empty
  const [bots, setBots] = useState(null);
  // Feeds the Hots/Spots tabs inside NewsSection below — same
  // GET /market/tickers snapshot MarketsPage.jsx polls, already sorted by
  // the backend most-traded-first (see market.py). Fetched once here
  // alongside balances/bots rather than on a MarketsPage-style 15s poll
  // interval: this is a small decorative widget, not the main Markets
  // screen, so a fresh-on-load snapshot is enough — it doesn't need to
  // visibly tick while the user is looking at the rest of Home.
  const [markets, setMarkets] = useState(null);
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
    // Swallows a failed fetch by just leaving `markets` at null forever
    // (NewsSection's Hots/Spots tabs then show their loading spinner
    // indefinitely) rather than throwing — losing this decorative widget's
    // data shouldn't be treated as fatal to the rest of Home the way a
    // failed getBalances/listBots would be.
    getMarkets(accessToken)
      .then((res) => setMarkets(res.tickers))
      .catch(() => {});
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

        <AdsCarousel t={t} />

        <ActiveBotsSection bots={activeBots} loading={bots === null} t={t} />

        <LeaderboardSection t={t} />

        <NewsSection markets={markets} t={t} />
      </div>
    </div>
  );
}

function TopRow({ greeting }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "18px", color: "var(--ink-base)" }}>{greeting}</span>
      {/* Used to be a plain decorative div with a bell glyph and nothing
          else — NotificationBell.jsx owns the icon, the unread badge, and
          the dropdown itself now; see that file's module comment for the
          full design. */}
      <NotificationBell />
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

// Full pool the Ads carousel draws from — 30 rows, each pairing a real
// photo (hotlinked from Unsplash's image CDN — its license allows this,
// no API key needed for a plain background-image request) with made-up
// promo copy from the matching adN entry in i18n.js's home.adsSection
// block. AdsCarousel below only ever shows 5 of these at a time, picked
// fresh once per calendar day — see pickDailyAds. Add or remove a row
// here (with its matching adN block in i18n.js) to resize the pool.
const AD_POOL = [
  { image: "https://images.unsplash.com/photo-1665597704311-d7304eaf70ac?w=800&q=80&auto=format&fit=crop", tagKey: "ad1Tag", titleKey: "ad1Title", bodyKey: "ad1Body" },
  { image: "https://images.unsplash.com/photo-1666816943145-bac390ca866c?w=800&q=80&auto=format&fit=crop", tagKey: "ad2Tag", titleKey: "ad2Title", bodyKey: "ad2Body" },
  { image: "https://images.unsplash.com/photo-1667422380246-3bed910ffae1?w=800&q=80&auto=format&fit=crop", tagKey: "ad3Tag", titleKey: "ad3Title", bodyKey: "ad3Body" },
  { image: "https://images.unsplash.com/photo-1672911640671-65d5dfa97d26?w=800&q=80&auto=format&fit=crop", tagKey: "ad4Tag", titleKey: "ad4Title", bodyKey: "ad4Body" },
  { image: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&q=80&auto=format&fit=crop", tagKey: "ad5Tag", titleKey: "ad5Title", bodyKey: "ad5Body" },
  { image: "https://images.unsplash.com/photo-1634704784915-aacf363b021f?w=800&q=80&auto=format&fit=crop", tagKey: "ad6Tag", titleKey: "ad6Title", bodyKey: "ad6Body" },
  { image: "https://images.unsplash.com/photo-1605792657660-596af9009e82?w=800&q=80&auto=format&fit=crop", tagKey: "ad7Tag", titleKey: "ad7Title", bodyKey: "ad7Body" },
  { image: "https://images.unsplash.com/photo-1629339942248-45d4b10c8c2f?w=800&q=80&auto=format&fit=crop", tagKey: "ad8Tag", titleKey: "ad8Title", bodyKey: "ad8Body" },
  { image: "https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=800&q=80&auto=format&fit=crop", tagKey: "ad9Tag", titleKey: "ad9Title", bodyKey: "ad9Body" },
  { image: "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=800&q=80&auto=format&fit=crop", tagKey: "ad10Tag", titleKey: "ad10Title", bodyKey: "ad10Body" },
  { image: "https://images.unsplash.com/photo-1639322537228-f710d846310a?w=800&q=80&auto=format&fit=crop", tagKey: "ad11Tag", titleKey: "ad11Title", bodyKey: "ad11Body" },
  { image: "https://images.unsplash.com/photo-1644088379091-d574269d422f?w=800&q=80&auto=format&fit=crop", tagKey: "ad12Tag", titleKey: "ad12Title", bodyKey: "ad12Body" },
  { image: "https://images.unsplash.com/photo-1640161704729-cbe966a08476?w=800&q=80&auto=format&fit=crop", tagKey: "ad13Tag", titleKey: "ad13Title", bodyKey: "ad13Body" },
  { image: "https://images.unsplash.com/photo-1639322537504-6427a16b0a28?w=800&q=80&auto=format&fit=crop", tagKey: "ad14Tag", titleKey: "ad14Title", bodyKey: "ad14Body" },
  { image: "https://images.unsplash.com/photo-1623227413711-25ee4388dae3?w=800&q=80&auto=format&fit=crop", tagKey: "ad15Tag", titleKey: "ad15Title", bodyKey: "ad15Body" },
  { image: "https://images.unsplash.com/photo-1622630998477-20aa696ecb05?w=800&q=80&auto=format&fit=crop", tagKey: "ad16Tag", titleKey: "ad16Title", bodyKey: "ad16Body" },
  { image: "https://images.unsplash.com/photo-1523961131990-5ea7c61b2107?w=800&q=80&auto=format&fit=crop", tagKey: "ad17Tag", titleKey: "ad17Title", bodyKey: "ad17Body" },
  { image: "https://images.unsplash.com/photo-1664526937033-fe2c11f1be25?w=800&q=80&auto=format&fit=crop", tagKey: "ad18Tag", titleKey: "ad18Title", bodyKey: "ad18Body" },
  { image: "https://images.unsplash.com/photo-1694219782948-afcab5c095d3?w=800&q=80&auto=format&fit=crop", tagKey: "ad19Tag", titleKey: "ad19Title", bodyKey: "ad19Body" },
  { image: "https://images.unsplash.com/photo-1676911809759-77bb68b691c9?w=800&q=80&auto=format&fit=crop", tagKey: "ad20Tag", titleKey: "ad20Title", bodyKey: "ad20Body" },
  { image: "https://images.unsplash.com/photo-1667984510054-d4562f93621d?w=800&q=80&auto=format&fit=crop", tagKey: "ad21Tag", titleKey: "ad21Title", bodyKey: "ad21Body" },
  { image: "https://images.unsplash.com/photo-1639825988283-39e5408b75e8?w=800&q=80&auto=format&fit=crop", tagKey: "ad22Tag", titleKey: "ad22Title", bodyKey: "ad22Body" },
  { image: "https://images.unsplash.com/photo-1639389016105-2fb11199fb6b?w=800&q=80&auto=format&fit=crop", tagKey: "ad23Tag", titleKey: "ad23Title", bodyKey: "ad23Body" },
  { image: "https://images.unsplash.com/photo-1640592409070-e35e28aedf14?w=800&q=80&auto=format&fit=crop", tagKey: "ad24Tag", titleKey: "ad24Title", bodyKey: "ad24Body" },
  { image: "https://images.unsplash.com/photo-1646495859894-2717409cd306?w=800&q=80&auto=format&fit=crop", tagKey: "ad25Tag", titleKey: "ad25Title", bodyKey: "ad25Body" },
  { image: "https://images.unsplash.com/photo-1666816943035-15c29931e975?w=800&q=80&auto=format&fit=crop", tagKey: "ad26Tag", titleKey: "ad26Title", bodyKey: "ad26Body" },
  { image: "https://images.unsplash.com/photo-1639322537138-5e513100b36e?w=800&q=80&auto=format&fit=crop", tagKey: "ad27Tag", titleKey: "ad27Title", bodyKey: "ad27Body" },
  { image: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&q=80&auto=format&fit=crop", tagKey: "ad28Tag", titleKey: "ad28Title", bodyKey: "ad28Body" },
  { image: "https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=800&q=80&auto=format&fit=crop", tagKey: "ad29Tag", titleKey: "ad29Title", bodyKey: "ad29Body" },
  { image: "https://images.unsplash.com/photo-1676911809746-85d90edbbe4a?w=800&q=80&auto=format&fit=crop", tagKey: "ad30Tag", titleKey: "ad30Title", bodyKey: "ad30Body" },
];

// How many of AD_POOL's 30 rows actually show up in a given day's
// carousel. Change this to show more or fewer slides per day.
const ADS_PER_DAY = 5;

// A tiny seedable PRNG (mulberry32) — plain Math.random() can't be given
// a seed, so there'd be no way to make "today's" 5 slides come out the
// same on every page load/refresh but different again tomorrow. Feeding
// it the same seed always reproduces the same sequence of "random"
// numbers, which is exactly the property a deterministic daily pick
// needs.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Turns today's date into a 32-bit integer seed for mulberry32 above.
// Plain string→number hashing (multiply-and-add per character, forced
// back into 32-bit range with `| 0` each step) — nothing fancy needed
// here, it just has to turn "2026-08-31" into a number deterministically.
function hashStringToSeed(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// Picks ADS_PER_DAY rows out of AD_POOL, reseeded by the device's local
// calendar date so every visit on the same day gets the same slides in
// the same order, and the set changes again the next day. (Using local
// date components rather than an ISO/UTC date specifically so "today"
// matches what the viewer's own clock says, not UTC's.) A Fisher-Yates
// shuffle driven by the seeded RNG, keeping only the first ADS_PER_DAY
// entries, is a standard unbiased way to pick a random subset without
// repeats. NOTE: if the app is left open across midnight, this won't
// re-pick mid-session — it's only recomputed on mount (see the useMemo
// in AdsCarousel below) — which is fine for a decorative banner.
function pickDailyAds() {
  const now = new Date();
  const dateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const random = mulberry32(hashStringToSeed(dateKey));

  const shuffled = [...AD_POOL];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, ADS_PER_DAY);
}

// Untitled Bybit-style sliding ad banner carousel, sitting directly above
// Active Bots with no section header of its own. Built on native CSS
// scroll-snap
// rather than a JS drag library: the slide track is a horizontally
// scrollable flex row with scroll-snap-type: x mandatory and each slide
// set to scroll-snap-align: start, which gives free touch/trackpad swipe
// support with no extra code. A setInterval autoplay advances the index
// every AUTOPLAY_MS and scrolls the track there with scrollTo({behavior:
// "smooth"}); manual scrolling (a user swiping) is picked up by the
// onScroll handler below, which recomputes the nearest slide index after
// scrolling settles so the dots stay in sync either way.
function AdsCarousel({ t }) {
  const AUTOPLAY_MS = 4000; // change this to speed up/slow down autoplay
  // Computed once per mount (empty dependency array) rather than on every
  // render — pickDailyAds does a bit of shuffling work that only needs
  // to happen once, and re-running it on every render would risk
  // reshuffling mid-session if any of its inputs ever became reactive.
  const slides = useMemo(() => pickDailyAds(), []);
  const trackRef = useRef(null);
  const [index, setIndex] = useState(0);
  // Guards against the onScroll handler fighting a code-driven scroll
  // (autoplay tick or dot click) — set true right before calling
  // track.scrollTo, then cleared by a timeout below once the smooth-
  // scroll animation has had time to finish. A fixed timeout (rather
  // than only clearing on touchend/mouseup) matters here: a trackpad or
  // mouse-wheel scroll fires neither of those events, so relying on them
  // alone would leave this flag stuck "true" forever after the very
  // first autoplay tick and silently break manual-swipe dot syncing —
  // 500ms comfortably outlasts the smooth-scroll distance this carousel
  // ever covers (one card width).
  const scrollingProgrammatically = useRef(false);
  const scrollSettleTimer = useRef(null);
  const programmaticClearTimer = useRef(null);

  const scrollToIndex = (i) => {
    const track = trackRef.current;
    if (!track) return;
    scrollingProgrammatically.current = true;
    if (programmaticClearTimer.current) clearTimeout(programmaticClearTimer.current);
    programmaticClearTimer.current = setTimeout(() => {
      scrollingProgrammatically.current = false;
    }, 500);
    track.scrollTo({ left: i * track.clientWidth, behavior: "smooth" });
    setIndex(i);
  };

  // Autoplay — advances one slide every AUTOPLAY_MS, wrapping back to
  // the first slide after the last. Resets whenever `index` changes
  // (including manual swipes or dot clicks) so a manual interaction
  // gives the viewer the full interval on the slide they chose rather
  // than jumping immediately.
  useEffect(() => {
    const id = setInterval(() => {
      scrollToIndex((index + 1) % slides.length);
    }, AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [index, slides.length]);

  // Keeps the dots in sync when the viewer swipes/scrolls the track
  // manually instead of using autoplay or the dots. Debounced on
  // scroll-end (150ms of no further scroll events) rather than firing on
  // every scroll tick, both for performance and because slide position
  // is only meaningful once the scroll has actually settled.
  const handleScroll = () => {
    if (scrollingProgrammatically.current) return;
    if (scrollSettleTimer.current) clearTimeout(scrollSettleTimer.current);
    scrollSettleTimer.current = setTimeout(() => {
      const track = trackRef.current;
      if (!track) return;
      const nearest = Math.round(track.scrollLeft / track.clientWidth);
      setIndex(Math.max(0, Math.min(slides.length - 1, nearest)));
    }, 150);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div
        ref={trackRef}
        className="qx-hide-scrollbar"
        onScroll={handleScroll}
        style={{
          display: "flex",
          overflowX: "auto",
          scrollSnapType: "x mandatory",
          borderRadius: "var(--radius-2xl)",
          // Hides the native scrollbar so this reads as a carousel
          // rather than a scrollable list, while touch/trackpad swipe
          // still works exactly the same underneath.
          scrollbarWidth: "none",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {slides.map((slide, i) => (
          <AdSlide key={i} slide={slide} t={t} />
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: "var(--space-3)" }}>
        {slides.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Slide ${i + 1}`}
            onClick={() => scrollToIndex(i)}
            style={{
              width: i === index ? 16 : 6,
              height: 6,
              borderRadius: "var(--radius-full)",
              background: i === index ? "var(--teal-base)" : "var(--cream-line)",
              border: "none",
              padding: 0,
              cursor: "pointer",
              transition: "width 0.2s ease, background 0.2s ease",
            }}
          />
        ))}
      </div>
    </div>
  );
}

// One slide: a real photo as the background with a dark scrim gradient
// (so light-on-dark text stays legible over any part of any photo)
// and fake ad copy overlaid at the bottom-left, exactly like a Bybit
// promo banner. flex: "0 0 100%" + scroll-snap-align makes each slide
// occupy the full track width and snap flush when scrolled to.
function AdSlide({ slide, t }) {
  return (
    <div
      style={{
        flex: "0 0 100%",
        scrollSnapAlign: "start",
        position: "relative",
        aspectRatio: "1.9",
        backgroundImage: `url(${slide.image})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(0deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "var(--space-8)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        <span
          style={{
            alignSelf: "flex-start",
            fontFamily: "var(--font-data)",
            fontWeight: 700,
            fontSize: "9px",
            letterSpacing: "0.06em",
            color: "var(--teal-deep)",
            background: "var(--on-accent)",
            padding: "3px 8px",
            borderRadius: "var(--radius-xs)",
          }}
        >
          {t(`home.adsSection.${slide.tagKey}`)}
        </span>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "15px", color: "var(--on-accent)" }}>
          {t(`home.adsSection.${slide.titleKey}`)}
        </span>
        <span style={{ fontFamily: "var(--font-body)", fontSize: "11.5px", color: "rgba(255,255,255,0.85)" }}>
          {t(`home.adsSection.${slide.bodyKey}`)}
        </span>
      </div>
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

// How many coins show up in the Hots / Spots tabs below — a small,
// decorative-widget-sized slice of the full markets feed (which has 300+
// rows on MarketsPage), matching Bybit's home-screen markets widget rather
// than the full Markets tab's scrollable list. Raise this for a longer
// widget, lower it for a more compact one.
const MARKET_FEED_ROWS = 5;

// The News/Hots/Spots widget just under Leaderboard. Bybit's home screen
// has this same three-tab shape: tapping a tab swaps the list below it
// rather than showing three separate stacked sections. News still has no
// real data source (no news feed exists yet), so it alone keeps the
// PREVIEW tag and its old sample content; Hots and Spots are both real,
// live slices of the same GET /market/tickers snapshot MarketsPage.jsx
// uses (passed down as `markets` from HomePage's own fetch) — Hots is
// simply the top MARKET_FEED_ROWS of that array (the backend already
// returns it sorted by 24h USDT volume, most-traded first — see
// market.py), Spots is the same data re-sorted client-side by 24h %
// change to surface the biggest movers instead.
function NewsSection({ markets, t }) {
  const [feedTab, setFeedTab] = useState("news"); // one of "news" | "hots" | "spots"

  const sampleItems = [
    { tag: "MARKET", title: "BTC holds above key support after weekend volatility", meta: "2h ago" },
    { tag: "PRODUCT", title: "Grid bots now support tighter range configurations", meta: "1d ago" },
    { tag: "MARKET", title: "ETH network activity climbs into the new week", meta: "2d ago" },
  ];

  // Hots: no re-sort needed, `markets` already arrives most-traded-first.
  // Spots: a fresh sorted copy (spread before .sort — .sort mutates in
  // place, and mutating the `markets` array HomePage passed down would
  // silently reorder it for the Hots tab too on the next render).
  const hotsList = (markets || []).slice(0, MARKET_FEED_ROWS);
  const spotsList = [...(markets || [])]
    .sort((a, b) => Number(b.change_percent) - Number(a.change_percent))
    .slice(0, MARKET_FEED_ROWS);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <FeedTabs selected={feedTab} onSelect={setFeedTab} t={t} />
        {feedTab === "news" && <PreviewTag t={t} />}
      </div>

      {feedTab === "news" && (
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
      )}

      {(feedTab === "hots" || feedTab === "spots") && (
        markets === null ? (
          <AnimatedPsi mode="working" size={22} color="var(--teal-base)" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
            {(feedTab === "hots" ? hotsList : spotsList).map((ticker) => (
              <MarketFeedRow key={ticker.symbol} ticker={ticker} />
            ))}
          </div>
        )
      )}
    </div>
  );
}

// The News/Hots/Spots tab row itself — same filled-pill-on-selection
// treatment as RangeTabs under the hero chart, but sized and colored for
// sitting on the plain cream page background (not the dark hero card), so
// it reuses SectionHeader's title styling for the text itself rather than
// RangeTabs' --on-accent/--teal-sage dark-card tokens.
function FeedTabs({ selected, onSelect, t }) {
  const tabs = [
    { value: "news", label: t("home.news.title") },
    { value: "hots", label: t("home.news.hotsTab") },
    { value: "spots", label: t("home.news.spotsTab") },
  ];
  return (
    <div style={{ display: "flex", gap: "var(--space-8)" }}>
      {tabs.map((tab) => {
        const active = tab.value === selected;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onSelect(tab.value)}
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "14px",
              color: active ? "var(--ink-base)" : "var(--ink-soft)",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

// One row inside the Hots/Spots widget — a compact version of MarketsPage's
// CoinRow (same CoinLogo + price + %-change shape) sized to sit comfortably
// inside this widget's list alongside the News tab's cards, rather than the
// slightly larger row MarketsPage uses for its own full-height list.
function MarketFeedRow({ ticker }) {
  const changePercent = Number(ticker.change_percent);
  const price = Number(ticker.price);
  // Same reasoning as MarketsPage's CoinRow: coins under $1 need more than
  // 2 decimals or they'd all round to "$0.00". Change the `1` threshold or
  // the `6` decimal count here for different precision.
  const priceDecimals = price >= 1 ? 2 : 6;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "10px 14px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
        <CoinLogo base={ticker.base} size={30} />
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "13px", color: "var(--ink-base)" }}>
          {ticker.base}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
        <span style={{ fontFamily: "var(--font-data)", fontSize: "13px", color: "var(--ink-base)" }}>
          ${price.toLocaleString(undefined, { minimumFractionDigits: priceDecimals, maximumFractionDigits: priceDecimals })}
        </span>
        <DeltaChip tone={changePercent >= 0 ? "up" : "down"} fontSize="11px">
          {changePercent >= 0 ? "+" : ""}
          {changePercent.toFixed(2)}%
        </DeltaChip>
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
