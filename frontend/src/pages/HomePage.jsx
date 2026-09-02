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
// Leaderboard has no real data source yet (no trader-ranking system) — it
// renders a simulated "top traders this week" pool instead of being cut,
// so the full screen composition is visible now and can be wired to a
// real source later without a layout change; see pickWeeklyLeaderboard's
// comment for how that simulation works. The News tab (inside the
// News/Hots/Spots widget below Leaderboard) is the same situation — no
// news feed exists yet — but Hots and Spots, its two sibling tabs, are
// both real live data.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AnimatedPsi from "../components/AnimatedPsi";
import Avatar from "../components/Avatar";
import CoinLogo from "../components/CoinLogo";
import CurrencyPicker from "../components/CurrencyPicker";
import DeltaChip from "../components/DeltaChip";
import Icon from "../components/Icon";
import NotificationBell from "../components/NotificationBell";
import ProfileDetailsSheet from "../components/ProfileDetailsSheet";
import VerifyEmailPrompt from "../components/VerifyEmailPrompt";
import useAssetPrices from "../hooks/useAssetPrices";
import useCountUp from "../hooks/useCountUp";
import useDisplayCurrency from "../hooks/useDisplayCurrency";
import { convertUsdTo, totalUsdValue } from "../lib/currency";
import { getBalances, getMarkets, getPortfolioHistory, listBots } from "../lib/api";

export default function HomePage() {
  const { t } = useTranslation();
  const { user, accessToken, refreshUser } = useAuth();
  // Drives ProfileDetailsSheet — opened by tapping the avatar in TopRow
  // (see that component below), which replaced the old "Hi, {name}" text
  // greeting entirely.
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);

  // Raw balances (asset + quantity, e.g. { asset: "BTC", amount: "0.002" })
  // rather than a pre-summed dollar figure — see lib/currency.js's module
  // comment for why: turning this into an actual USD total needs each
  // non-stablecoin asset's LIVE price, which totalUsdValue() below handles.
  const [balances, setBalances] = useState(null); // null = still loading
  const [history, setHistory] = useState(null); // null = still loading, [] = loaded but empty
  const [bots, setBots] = useState(null);
  // Live USD price per asset (from the same feed MarketsPage uses) — see
  // useAssetPrices.js. Needed to turn `balances` into a real dollar total,
  // and to convert that total into a coin-equivalent when `currency` below
  // isn't "USD".
  const prices = useAssetPrices(accessToken);
  // Which currency the balance below is shown in ("USD", "BTC", "ETH", or
  // "SOL") — a single preference shared with WalletPage's identical picker
  // (see useDisplayCurrency.js for why this lives in localStorage rather
  // than component state).
  const [currency, setCurrency] = useDisplayCurrency();
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
    getBalances(accessToken).then((res) => setBalances(res.balances));
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

  // null until balances have loaded AND every held asset has a live price
  // (see totalUsdValue()'s own doc comment) — never a partial/undercounted
  // number.
  const totalUsd = balances ? totalUsdValue(balances, prices) : null;
  // The figure actually shown — totalUsd itself when currency is "USD",
  // or that same total divided by the chosen coin's live price otherwise.
  // Still null (not a wrong number) if the target currency's own price
  // isn't loaded yet.
  const displayValue = convertUsdTo(totalUsd, currency, prices);

  const activeBots = (bots || []).filter((b) => b.status === "ACTIVE");

  return (
    <div style={{ paddingTop: "var(--space-11)", paddingBottom: "var(--space-16)" }}>
      <div style={{ maxWidth: 384, margin: "0 auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: "var(--space-16)" }}>
        <TopRow user={user} onAvatarClick={() => setProfileSheetOpen(true)} />

        <ProfileDetailsSheet
          open={profileSheetOpen}
          onClose={() => setProfileSheetOpen(false)}
          user={user}
          accessToken={accessToken}
          refreshUser={refreshUser}
        />

        {!user.email_verified && <VerifyEmailPrompt />}

        <HeroCard
          displayValue={displayValue}
          currency={currency}
          onCurrencyChange={setCurrency}
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

        <DiscoverSection t={t} />
      </div>
    </div>
  );
}

// Used to show a plain "Hi, {name}" text greeting derived from the email's
// local part — replaced with the user's own avatar, tapping which opens
// ProfileDetailsSheet (username/name/email at a glance, plus a way into
// AvatarPicker) instead of just sitting there as inert text.
function TopRow({ user, onAvatarClick }) {
  const initial = (user.email || "?").charAt(0).toUpperCase();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <button
        type="button"
        onClick={onAvatarClick}
        aria-label="View profile"
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex" }}
      >
        <Avatar avatarUrl={user.avatar_url} avatarId={user.avatar_id} initial={initial} size={38} />
      </button>
      {/* NotificationBell.jsx owns the icon, the unread badge, and the
          dropdown itself — see that file's module comment for the full
          design. */}
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

function HeroCard({ displayValue, currency, onCurrencyChange, history, range, onRangeChange, balanceHidden, onToggleBalanceHidden, t }) {
  const loading = displayValue === null || history === null;
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
          <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", letterSpacing: "0.08em", color: "var(--teal-sage)" }}>
            {t("home.hero.label")}
          </span>
          {/* Local-only visibility toggle — doesn't touch the underlying
              total, just swaps what's rendered below between digits and
              dots, so no re-fetch or state reset happens on click. */}
          <button
            type="button"
            onClick={onToggleBalanceHidden}
            aria-label={balanceHidden ? "Show balance" : "Hide balance"}
            style={{ display: "flex", alignItems: "center", background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            <Icon name={balanceHidden ? "eyeOff" : "eye"} size={14} color="var(--teal-sage)" />
          </button>
        </div>
        <CurrencyPicker currency={currency} onChange={onCurrencyChange} />
      </div>

      {loading ? (
        <AnimatedPsi mode="working" size={26} color="var(--on-accent)" />
      ) : (
        <>
          <BalanceFigure key={currency} value={displayValue} currency={currency} hidden={balanceHidden} />

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

// The count-up animated balance figure itself, pulled out of HeroCard so
// HeroCard can mount a FRESH one (via the `key={currency}` at its call
// site) every time the display currency changes. Without that remount,
// useCountUp would try to animate directly from a USD-scale number (e.g.
// 42318.50) to a wildly different BTC-scale one (e.g. 0.62134), which
// reads as a broken glitch, not a balance update — a currency switch
// isn't "the balance changed", it's "the same balance, shown in a
// different unit", so it should just show the new unit's number straight
// away. Remounting resets useCountUp's internal state, so switching
// currency instead plays the SAME "count up from 0" reveal a normal page
// load gets — deliberate, not a compromise.
function BalanceFigure({ value, currency, hidden }) {
  // See useCountUp's own doc comment: this returns a plain 0 (never null)
  // while `value` hasn't resolved yet, which is fine since HeroCard's own
  // `loading` check already renders a spinner instead of this component
  // during that window.
  const displayed = useCountUp(value);
  // Coin-equivalent amounts need more decimal places than a dollar figure
  // to be meaningfully readable (e.g. "0.001846 BTC", not "0.00 BTC") —
  // same precision MarketsPage.jsx uses for sub-$1 prices. Raise this if
  // a future coin's typical portfolio-share amount still rounds to
  // 0.000000 too often.
  const decimals = currency === "USD" ? 2 : 6;
  const formatted = displayed.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  return (
    <span className="qx-num" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "32px", color: "var(--on-accent)" }}>
      {hidden ? "••••••" : currency === "USD" ? `$${formatted}` : `${formatted} ${currency}`}
    </span>
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
  // Separate id for the area fill's fade gradient (useId again, same as
  // glowId above) — SVG def ids must be unique per <svg> on the page, and
  // HomePage can render more than one Sparkline (e.g. currency switches
  // remounting it), so each instance needs its own id rather than a
  // hardcoded string.
  const fadeId = useId();
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
        {/*
          Vertical fade for the area fill, top (near the line) to bottom
          (the chart's floor). y1/y2 go 0 -> 1 in the default objectBoundingBox
          units, i.e. top of the SVG to bottom, regardless of the actual
          height prop. Three stops rather than two so the fade eases out
          gradually instead of reading as a single straight ramp: it opens
          at 0.32 opacity right under the line, is already down to 0.14 by
          the halfway point, and tapers the rest of the way to fully
          transparent (0) at the bottom — that trailing-off curve is what
          replaces the old hard-edged flat-opacity fill. To make the fade
          start stronger or weaker, raise/lower the first stop's opacity;
          to make it fade out faster or slower, move the middle stop's
          offset earlier or later.
        */}
        <linearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="45%" stopColor={color} stopOpacity="0.14" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${fadeId})`} stroke="none" />
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
      <QuickTile to="/convert" icon="convert" label={t("home.quickActions.convert")} />
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

// Local (device-clock) calendar date, as "YYYY-M-D" — deliberately local
// components rather than an ISO/UTC date so "today" matches what the
// viewer's own clock says, not UTC's.
function getLocalDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
}

// Local calendar week, as "YYYY-Www" (ISO-8601 week numbering). Same
// local-clock reasoning as getLocalDateKey above, just bucketed by week
// instead of by day — used by the Leaderboard's "top traders THIS WEEK"
// framing, which should hold steady for the whole week rather than
// reshuffling daily like the ads carousel and news feed do.
function getLocalWeekKey() {
  const now = new Date();
  // Copy at UTC midnight for this local date so the ISO week math below
  // (which operates on UTC internally) isn't thrown off by the local
  // timezone offset shifting the date near midnight.
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  // ISO weeks start on Monday; getUTCDay() is 0=Sunday..6=Saturday, so
  // this maps Monday->0 .. Sunday->6 before shifting to the Thursday of
  // the same week — the ISO standard says a week "belongs to" whichever
  // year contains that week's Thursday, which is what makes the
  // week-number math below correct at year boundaries.
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const weekNum = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${weekNum}`;
}

// Picks `count` rows out of `pool`, reseeded by `periodKey` (a day key
// from getLocalDateKey, or a week key from getLocalWeekKey) so every
// visit within the same period gets the same picks in the same order,
// and the set changes again once the period rolls over. A Fisher-Yates
// shuffle driven by the seeded RNG, keeping only the first `count`
// entries, is a standard unbiased way to pick a random subset without
// repeats. `salt` is mixed into the seed so different pools picked for
// the same period (the ads carousel, the news feed, and the leaderboard
// all use this) don't end up shuffled in lockstep with each other. NOTE:
// if the app is left open across a day/week rollover, this won't
// re-pick mid-session — it's only recomputed on mount by each caller's
// own useMemo — which is fine for decorative content like this.
function pickFromPool(pool, count, salt, periodKey) {
  const random = mulberry32(hashStringToSeed(`${salt}-${periodKey}`));

  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

// Convenience wrapper over pickFromPool for the day-cadence callers
// (AdsCarousel, NewsSection).
function pickDaily(pool, count, salt) {
  return pickFromPool(pool, count, salt, getLocalDateKey());
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
  const slides = useMemo(() => pickDaily(AD_POOL, ADS_PER_DAY, "ads"), []);
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
// 20-name pool the Leaderboard's "top traders this week" are drawn from
// — see pickWeeklyLeaderboard below for how 3 of these get chosen, along
// with a simulated balance and strategy tag for each, refreshed on a
// weekly cadence (matching the "this week" framing) rather than daily
// like the ads carousel/news feed. Add, remove, or rename entries here
// to change who can show up.
const LEADERBOARD_NAMES = [
  "quantex_trader", "cryptoking99", "satoshi_stacker", "moon_hodler99", "grid_master_fx",
  "dca_daniel", "alpha_seeker", "blockchain_bee", "north_star_fx", "vertex_trades",
  "lumen_capital", "zen_trader88", "apex_growth_hq", "solstice_fund", "northwind_trades",
  "kite_runner_fx", "ember_stacks", "tidal_trades_io", "granite_grid", "echo_trader_x",
];

// Strategy tag randomly assigned to each of this week's 3 top traders —
// purely decorative flavor text, not tied to any bot a trader actually
// ran.
const LEADERBOARD_STRATEGIES = ["Grid", "DCA", "Momentum"];

// Simulated balance range (USDT) for this week's top traders — the ask
// was specifically "above ten of thousands", so the floor is fixed at
// $10,000; raise the max for a higher ceiling on the biggest balance
// that can appear.
const LEADERBOARD_BALANCE_MIN = 10000;
const LEADERBOARD_BALANCE_MAX = 120000;

// Picks 3 names out of LEADERBOARD_NAMES for this week's leaderboard,
// each given a stable simulated balance (always above
// LEADERBOARD_BALANCE_MIN) and a strategy tag. Everything here is seeded
// off the current ISO week (see getLocalWeekKey/pickFromPool above), so
// every visitor sees the same 3 traders with the same balances all week,
// and a different 3 get picked automatically once the week rolls over —
// there's no cron job or backend involved, it's purely a function of
// "what week is it right now" computed fresh on each page load. Sorted
// balance-descending so the biggest balance always renders first, the
// way an actual "top trader" ranking would.
function pickWeeklyLeaderboard() {
  const weekKey = getLocalWeekKey();
  const names = pickFromPool(LEADERBOARD_NAMES, 3, "leaderboard", weekKey);

  return names
    .map((name) => {
      // A second, per-name seeded RNG (rather than reusing the shuffle's
      // own random()) so adding/reordering LEADERBOARD_NAMES later can't
      // accidentally change an already-picked trader's balance — each
      // trader's numbers are fully determined by their own name and the
      // current week, independent of everyone else's.
      const random = mulberry32(hashStringToSeed(`leaderboard-detail-${name}-${weekKey}`));
      const balance = LEADERBOARD_BALANCE_MIN + random() * (LEADERBOARD_BALANCE_MAX - LEADERBOARD_BALANCE_MIN);
      const strategy = LEADERBOARD_STRATEGIES[Math.floor(random() * LEADERBOARD_STRATEGIES.length)];
      return { name, balance, strategy };
    })
    .sort((a, b) => b.balance - a.balance);
}

function LeaderboardSection({ t }) {
  const topTraders = useMemo(() => pickWeeklyLeaderboard(), []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <SectionHeader title={t("home.leaderboard.title")} />
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        {topTraders.map((trader, i) => (
          <LeaderboardRow key={trader.name} rank={i + 1} trader={trader} />
        ))}
      </div>
    </div>
  );
}

// One row — rank number takes the place of BotCard/Leaderboard's old
// single initial-letter avatar (a plain "Q"), so the ranking itself is
// legible at a glance rather than needing a separate badge alongside a
// name-initial avatar.
function LeaderboardRow({ rank, trader }) {
  return (
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
          {rank}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "13px", color: "var(--ink-base)" }}>
            {trader.name}
          </span>
          <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", color: "var(--ink-soft)" }}>
            {trader.strategy} • Top trader this week
          </span>
        </div>
      </div>
      <span className="qx-num" style={{ fontFamily: "var(--font-data)", fontSize: "13px", color: "var(--gain)" }}>
        ${trader.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
  );
}

// Thumbnail pool for the News tab's cards below — real photos (same
// Unsplash-CDN hotlinking approach as AD_POOL above) covering
// finance/crypto/fintech themes broadly rather than one photo per
// headline. 45 images cycled across NEWS_POOL's 60 articles (via `i %
// NEWS_IMAGES.length` where NEWS_POOL is built below) — some photos
// repeat across articles, which is normal for how real news apps assign
// generic category thumbnails, not a bug. Swap or add URLs here to
// change what's available; the assignment below adapts automatically.
const NEWS_IMAGES = [
  "https://images.unsplash.com/photo-1665597704311-d7304eaf70ac?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1666816943145-bac390ca866c?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1667422380246-3bed910ffae1?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1672911640671-65d5dfa97d26?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1634704784915-aacf363b021f?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1605792657660-596af9009e82?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1629339942248-45d4b10c8c2f?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1639322537228-f710d846310a?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1644088379091-d574269d422f?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1640161704729-cbe966a08476?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1639322537504-6427a16b0a28?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1623227413711-25ee4388dae3?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1622630998477-20aa696ecb05?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1523961131990-5ea7c61b2107?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1664526937033-fe2c11f1be25?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1694219782948-afcab5c095d3?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1676911809759-77bb68b691c9?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1667984510054-d4562f93621d?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1639825988283-39e5408b75e8?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1639389016105-2fb11199fb6b?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1640592409070-e35e28aedf14?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1646495859894-2717409cd306?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1666816943035-15c29931e975?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1639322537138-5e513100b36e?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1676911809746-85d90edbbe4a?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1645226880663-81561dcab0ae?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1591696205602-2f950c417cb9?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1560221328-12fe60f83ab8?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1745509267699-1b1db256601e?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1559526324-593bc073d938?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1509017174183-0b7e0278f1ec?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1561525155-40a650192479?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1651341050677-24dba59ce0fd?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1651340981821-b519ad14da7c?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1612178991541-b48cc8e92a4d?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1651340927948-26826aaef4b0?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1672617195387-1a890be98e28?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1672870153636-32a5e5218792?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1516245834210-c4c142787335?w=500&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1644952354935-0bc0d25a9996?w=500&q=80&auto=format&fit=crop",
];

// The full 60-article pool the News tab draws from. Kept as plain inline
// strings here rather than routed through i18n.js — the same call this
// file's original sampleItems array already made for this exact kind of
// fake/decorative filler content (see NewsSection below), just at 20x the
// volume; adding ~180 more i18n keys for text nobody will ever actually
// translate isn't worth the bloat. Each body is ~150 words, matching what
// was asked for — NewsCard below shows a one-line excerpt by default and
// reveals the full body on tap. NEWS_PER_DAY of these 60 are shown on any
// given day; see pickDaily above for how "today's" set is chosen, and
// NewsSection for where it's called.
const NEWS_ARTICLES = [
  {
    tag: "MARKET",
    title: "BTC holds above key support after weekend volatility",
    body: "Bitcoin spent the weekend testing a support zone that has held on three separate occasions over the past month, and buyers stepped in again each time price approached it. Spot volume picked up modestly during the defense, while perpetual funding rates cooled from their recent highs, suggesting some of the excess leverage that built up during the prior rally has been flushed out. Options markets show a cluster of open interest at strikes just above the current price, which traders are watching as a potential magnet if momentum turns higher. On-chain data shows large wallets adding to positions during the dip rather than distributing, a pattern that has historically preceded periods of consolidation rather than a deeper breakdown. Analysts note that the next meaningful test is the resistance band where the last rally stalled; a clean move through it on rising volume would be the clearer signal traders are waiting for before adding risk back.",
  },
  {
    tag: "MARKET",
    title: "ETH grinds higher as staking supply keeps tightening",
    body: "Ether has posted a slow, steady climb over the past two weeks, a move traders are attributing partly to a shrinking liquid supply rather than any single catalyst. The validator queue has lengthened again, meaning more ETH is being locked into staking faster than it is being unstaked, which mechanically reduces the amount available to trade on exchanges. At the same time, activity on layer-2 networks has continued absorbing transaction demand that used to hit the mainnet directly, keeping gas fees low even as usage climbs. Some traders see this combination — tightening float plus healthy underlying usage — as a more sustainable setup than a purely speculative rally. Derivatives data shows funding rates rising only gradually alongside spot price, rather than spiking, which suggests the move so far has been driven more by spot accumulation than by leveraged long positions chasing the trend. The next few sessions will show whether that steady character holds.",
  },
  {
    tag: "MARKET",
    title: "SOL network activity climbs as new dApps launch",
    body: "Solana's on-chain activity has picked up noticeably over the past few weeks, with daily active addresses and total transaction count both climbing to levels not seen since earlier in the cycle. Several new decentralized applications have launched on the network recently, ranging from trading tools to consumer-facing apps, and a handful have drawn enough usage to meaningfully move the network's aggregate numbers. Decentralized exchange volume on Solana has grown alongside this activity, with a few venues now regularly processing volume that rivals established players on other chains. The network has handled the increased load without the kind of sustained congestion that drew criticism in past cycles, though brief slowdowns during periods of extremely high demand still occur. Developers building on the network point to lower transaction costs and fast confirmation times as the main draw for new projects choosing to launch there rather than on more established but pricier alternatives.",
  },
  {
    tag: "MARKET",
    title: "Altcoins outperform majors in a quiet trading week",
    body: "With Bitcoin trading in a tight range for much of the week, capital has rotated noticeably into mid-cap altcoins, several of which have posted double-digit gains while the two largest assets by market cap moved only a few percent either way. Traders describe the pattern as fairly typical for a low-volatility stretch: when the majors stop moving, speculative flow tends to look for opportunity further down the market-cap curve. Bitcoin's dominance metric has drifted lower over the same period, consistent with that rotation. Thin weekend liquidity likely amplified some of the moves, with a few tokens posting sharp intraday swings on relatively modest volume. Analysts caution that these rotations can reverse quickly once Bitcoin resumes a clear directional move, since altcoin liquidity tends to evaporate faster than it appears during quiet periods. For now, traders are treating the move as a liquidity-driven rotation rather than a fundamental shift in relative strength.",
  },
  {
    tag: "MARKET",
    title: "XRP volatility spikes around a legal-case update",
    body: "XRP saw a sharp increase in trading volume and price volatility this week following a procedural update in a long-running legal matter closely watched by the market. The token moved several percent in both directions within hours as traders reacted to headlines before full details were available, a pattern that has repeated several times over the course of the case. A number of exchanges reported temporarily elevated order book activity during the move, and open interest in XRP derivatives climbed alongside spot volume. Some traders used the volatility to take short-term directional positions, while others stayed on the sidelines, noting that headline-driven moves in this asset have historically reversed a meaningful portion of their initial swing within a day or two. Market participants broadly agree that a fully resolved outcome, whenever it arrives, would likely have a larger and more lasting effect on sentiment than any single interim update has produced so far.",
  },
  {
    tag: "DEFI",
    title: "Total value locked in DeFi ticks back toward yearly highs",
    body: "The total value locked across decentralized finance protocols has climbed steadily over the past month, approaching levels last seen near the start of the year. Lending markets account for a large share of the increase, with utilization rates rising as more borrowers tap into on-chain credit for leveraged positions and working capital. Liquid staking derivatives have also grown their share of the total, reflecting continued demand for yield-bearing collateral that can be redeployed elsewhere in the ecosystem. A handful of newer protocols focused on real-world asset collateral have contributed a smaller but fast-growing slice of the total as well. Security researchers note that the average age and audit coverage of protocols holding significant deposits has improved compared to prior cycles, a shift some attribute to users increasingly favoring established, well-reviewed platforms over newer, unaudited ones chasing short-term yield. Whether the trend continues likely depends on broader market conditions holding steady.",
  },
  {
    tag: "DEFI",
    title: "A major DEX rolls out a cross-chain swap upgrade",
    body: "One of the more widely used decentralized exchanges has shipped an upgrade aimed at making cross-chain swaps faster and cheaper, combining a new liquidity-routing engine with tighter integration to several bridging protocols. Early users report noticeably lower slippage on mid-sized trades that previously had to route through multiple hops to reach the best price. The update also introduces a unified interface for quoting prices across chains before a trade is confirmed, reducing the guesswork that previously came with cross-chain swaps priced separately on each side. Liquidity providers on the platform have seen fee revenue tick up modestly since the change, attributed to higher overall trade volume rather than a change in fee structure. Competing platforms are reportedly working on similar routing improvements, suggesting cross-chain liquidity aggregation is becoming a competitive front in its own right rather than a secondary feature bolted onto existing single-chain exchanges.",
  },
  {
    tag: "DEFI",
    title: "Liquid restaking protocols see fresh inflows",
    body: "Liquid restaking protocols have attracted a fresh wave of deposits over the past several weeks, continuing a trend that has made this one of the fastest-growing categories within decentralized finance. The appeal is straightforward: deposited assets earn a base staking yield while simultaneously securing additional network services, layering extra potential returns on top of a familiar base. Several protocols in the space have expanded the list of services their restaked collateral can secure, broadening the potential yield sources available to depositors. Risk-focused commentators continue to flag the added complexity this introduces, since a restaked position now carries exposure not just to the underlying asset but to the security assumptions of every additional service it backs. Protocol teams have responded by publishing more detailed risk disclosures and, in some cases, capping how much total value a given service can secure at once, aiming to limit concentrated exposure to any single point of failure.",
  },
  {
    tag: "DEFI",
    title: "Stablecoin-backed lending markets expand on layer-2s",
    body: "Lending markets built around stablecoin collateral have grown quickly on several layer-2 networks over recent months, drawing borrowers who previously avoided on-chain credit due to high mainnet gas costs. With transaction fees now a small fraction of what they were before these networks matured, smaller borrowers can participate in strategies that were previously only economical at larger position sizes. Utilization rates on several of these markets have climbed steadily, pushing borrowing costs modestly higher and drawing in additional liquidity providers chasing the improved yield. Protocol teams have also introduced more granular collateral ratio tiers, letting borrowers choose between higher leverage with tighter liquidation buffers or more conservative positions with wider safety margins. The combination of lower fees and more flexible risk parameters is often cited as the main reason this segment has grown faster on layer-2s than it has on the underlying mainnet over the same period.",
  },
  {
    tag: "DEFI",
    title: "On-chain options volume hits a fresh monthly high",
    body: "Decentralized options protocols recorded their highest monthly trading volume to date, extending a growth trend that has picked up pace as more structured products launch on top of existing liquidity pools. Much of the growth is attributed to automated vaults that sell covered calls or cash-secured puts on behalf of depositors, offering a relatively simple way to earn premium income without actively managing individual options positions. Institutional-style trading desks have also increased their presence in the space, using on-chain options to hedge spot and derivatives exposure ahead of known volatility events like major protocol upgrades or macroeconomic data releases. Liquidity remains thinner than on centralized options venues for now, which continues to widen spreads on less popular strikes and expiries. Protocol teams are working on market-maker incentive programs aimed at narrowing that gap, viewing tighter pricing as the main remaining barrier to attracting larger, more price-sensitive flow.",
  },
  {
    tag: "REGULATION",
    title: "Regulators signal a clearer path for spot crypto products",
    body: "Regulatory officials in several major markets have signaled progress toward clearer rules governing spot crypto investment products, following an extended period of public comment and industry consultation. Exchanges and asset managers have been preparing compliance frameworks in anticipation, including enhanced surveillance-sharing agreements and stricter listing standards for underlying assets. Industry groups have broadly welcomed the direction of travel, arguing that clearer rules reduce the operational uncertainty that has historically slowed institutional participation. Some critics note that the proposed frameworks still leave meaningful gaps around newer asset categories, meaning further rulemaking will likely be needed as the market continues to evolve. Market participants are watching closely for the specific language that ultimately gets adopted, since the details of custody requirements and reporting obligations will determine how quickly new products can actually launch. Several firms have said they are prepared to move within weeks of final rules being published.",
  },
  {
    tag: "REGULATION",
    title: "A new framework for stablecoin reserves moves forward",
    body: "A proposed regulatory framework governing how stablecoin issuers must back their tokens has advanced through another stage of review, bringing closer scrutiny to reserve composition, redemption guarantees, and disclosure requirements. Under the draft rules, issuers would need to hold reserves predominantly in highly liquid, low-risk assets and provide regular independent attestations confirming that holdings match circulating supply. Redemption timelines would also be standardized, addressing concerns raised during past periods of market stress when some users faced delays converting tokens back to cash. Several major issuers have already begun aligning their reserve practices with the proposed standards ahead of any formal requirement, viewing early compliance as a competitive advantage. Smaller or less transparent issuers may face a harder transition, and some industry observers expect a period of consolidation as the rules take effect, with users gravitating toward issuers who can most clearly demonstrate compliance.",
  },
  {
    tag: "REGULATION",
    title: "Cross-border crypto tax reporting rules take shape",
    body: "A framework for standardized cross-border tax reporting on crypto transactions has moved into its next phase, aiming to give tax authorities in participating jurisdictions a consistent view of asset transfers that cross national lines. Under the emerging rules, exchanges and other reporting entities would need to collect and share transaction data in a common format, reducing the reporting inconsistencies that have complicated enforcement in the past. Several exchanges have already begun rolling out new reporting tools ahead of any formal deadline, giving users earlier access to consolidated transaction summaries. For active traders, the practical effect is likely to be more detailed year-end tax documents, but also less ambiguity about what needs to be reported and how. Tax professionals who work with crypto-active clients say the added structure should reduce filing errors over time, even if it means somewhat more paperwork from exchanges in the near term as systems adjust.",
  },
  {
    tag: "REGULATION",
    title: "Licensing requirements tighten for custodial platforms",
    body: "New licensing standards for platforms that hold customer crypto assets on their behalf have tightened in several jurisdictions, introducing higher capital reserve requirements and more frequent third-party audits. The changes are aimed at reducing the risk of a platform becoming insolvent while still holding customer deposits, a scenario that has played out publicly a handful of times in past cycles. Larger, well-capitalized platforms have generally welcomed the changes, viewing stricter standards as a way to differentiate themselves from smaller competitors that may struggle to meet the new bar. Smaller platforms have raised concerns about the cost of compliance, warning that some may need to scale back operations or seek additional funding to meet the new requirements. Regulators have indicated a transition period will be provided, giving existing platforms time to adjust rather than requiring immediate compliance, though the exact timeline still varies by jurisdiction.",
  },
  {
    tag: "REGULATION",
    title: "Industry groups push for clearer token classification rules",
    body: "Industry associations representing exchanges, issuers, and investors have renewed calls for clearer rules determining when a token should be treated as a security versus a commodity or other asset class. The distinction matters significantly for how a token can be listed, marketed, and traded, and the current lack of a bright-line test has left many projects operating under legal uncertainty. Proposed frameworks under discussion generally focus on the degree of decentralization a network has reached and whether purchasers reasonably expect profit from the efforts of a central team. Some legal experts argue that a purely binary classification undersells the complexity of how tokens actually function and evolve over time, and have proposed graduated frameworks instead. Whatever approach ultimately gets adopted is expected to have a significant effect on which tokens major exchanges are willing to list, making this one of the more closely watched open regulatory questions in the space.",
  },
  {
    tag: "LAYER2",
    title: "Rollup transaction fees drop after a network upgrade",
    body: "Average transaction fees on several major rollup networks have dropped noticeably following a recent upgrade focused on data availability efficiency. The change reduces the amount of data that needs to be posted to the underlying base layer for each batch of transactions, which is the primary driver of rollup fee costs. Early data shows fees for simple transfers down significantly compared to pre-upgrade levels, with more complex smart contract interactions seeing a smaller but still meaningful reduction. Developers building consumer-facing applications have welcomed the change, noting that unpredictable fee spikes have historically been one of the bigger obstacles to onboarding users unfamiliar with crypto. Several teams say the lower and more stable fee environment makes previously uneconomical use cases, like frequent small in-game transactions, viable for the first time. Network operators expect further efficiency gains as additional data availability improvements planned for later this year are rolled out.",
  },
  {
    tag: "LAYER2",
    title: "A leading L2 crosses a new daily active address milestone",
    body: "One of the more established layer-2 networks has crossed a new milestone for daily active addresses, continuing a steady growth trend over the past several months. The increase has been attributed to a combination of factors, including expanded incentive programs for both users and liquidity providers, as well as a growing number of applications choosing to deploy natively on the network rather than treating it as a secondary option. Bridge volume into the network has also climbed alongside the address growth, suggesting the increase reflects genuine new usage rather than address churn from incentive farming alone, though some analysts note it can be difficult to fully separate the two. Network fees have remained low despite the higher activity level, which developers point to as evidence the underlying infrastructure is scaling as intended. Competing networks have responded with their own incentive programs, intensifying competition for both users and the applications that serve them.",
  },
  {
    tag: "LAYER2",
    title: "Modular blockchain designs gain traction among builders",
    body: "A growing number of new blockchain projects are adopting a modular design, splitting execution, settlement, and data availability into separate specialized layers rather than handling all three within a single monolithic chain. Proponents argue this approach lets each layer be optimized independently, potentially delivering better scalability than trying to improve all functions at once within one system. Several data availability layers built specifically to serve this modular ecosystem have seen rising demand as more rollups choose to post their data there instead of directly to a general-purpose base layer. Critics of the approach point to added complexity for developers, who now need to reason about security assumptions across multiple layers rather than one, and to still-maturing tooling for debugging issues that span layers. Even so, the number of new projects choosing a modular architecture over a monolithic one has grown steadily, suggesting the approach is moving from experimental to mainstream among newer chain launches.",
  },
  {
    tag: "LAYER2",
    title: "Zero-knowledge proof generation times keep falling",
    body: "The time required to generate zero-knowledge proofs for rollup transaction batches has continued to fall, driven by a combination of algorithmic improvements and dedicated hardware acceleration. Faster proof generation directly translates into quicker finality for transactions on networks that rely on this technology, narrowing the gap between a transaction being submitted and it being fully and verifiably settled on the base layer. Several teams have introduced specialized hardware, including GPU and custom chip-based provers, that cut generation times well below what general-purpose processors can achieve. The improvements are also lowering the operational cost of running a prover, which some developers say could eventually allow smaller, community-run provers to participate alongside larger dedicated infrastructure operators. Faster and cheaper proving is widely seen as one of the key remaining bottlenecks for zero-knowledge rollups to match the user experience of centralized systems, and progress here is being closely tracked across the ecosystem.",
  },
  {
    tag: "LAYER2",
    title: "Interoperability protocols see growing cross-chain volume",
    body: "Protocols designed to move assets and messages between different blockchains have seen a steady rise in volume as more applications adopt multi-chain strategies rather than committing exclusively to a single network. Message-passing protocols, which let smart contracts on one chain trigger actions on another without directly moving assets, have grown particularly quickly as developers look for ways to unify liquidity and user experience across otherwise separate ecosystems. Security remains the central tradeoff in this space, since interoperability protocols have historically been a frequent target for exploits due to the added complexity of verifying cross-chain messages correctly. Several protocols have responded by adopting more conservative security models, including longer settlement delays for larger transfers, accepting slower speed in exchange for a reduced attack surface. Developers building cross-chain applications say the biggest practical challenge remains choosing between the many available interoperability protocols, each with different tradeoffs between speed, cost, and security guarantees.",
  },
  {
    tag: "SECURITY",
    title: "Hardware wallet adoption keeps climbing among long-term holders",
    body: "Sales data from major hardware wallet manufacturers show continued growth in adoption among long-term holders, a trend that has held steady even as overall market volatility has fluctuated. Self-custody advocates point to this as a healthy sign, arguing that holders keeping assets in cold storage rather than on exchanges reduces systemic risk in the event of a platform failure. Newer hardware wallet models have also added features aimed at reducing common user errors, including clearer transaction verification screens designed to help users catch a maliciously altered destination address before signing. Educational content around proper seed phrase storage has also proliferated, responding to the fact that lost or improperly stored recovery phrases remain one of the most common ways users permanently lose access to funds, separate from any hack or exploit. Manufacturers report that first-time buyers now make up a growing share of sales, suggesting self-custody practices are spreading beyond the earliest and most technical adopters.",
  },
  {
    tag: "SECURITY",
    title: "A widely-used wallet library patches a signing vulnerability",
    body: "Developers maintaining a widely used open-source wallet library have released a patch addressing a vulnerability in how certain transaction types were signed, following a responsible disclosure from an independent security researcher. The issue, if left unpatched, could under specific conditions have allowed a malicious application to request a signature that authorized more than the user intended. No evidence has emerged of the vulnerability being exploited before the patch was released, and the researcher was credited and compensated through the project's bug bounty program. Wallet applications and services built on top of the library are rolling out updates to affected users, and maintainers have urged anyone running an older version to update as soon as possible. The disclosure has renewed broader discussion about the importance of regular dependency audits for wallet software, given how many downstream applications can be affected by a single vulnerability in a shared, widely reused library like this one.",
  },
  {
    tag: "SECURITY",
    title: "Phishing attempts targeting crypto users rise ahead of a bull run",
    body: "Security researchers have flagged a noticeable rise in phishing attempts targeting crypto users over the past several weeks, a pattern that has historically tracked closely with periods of renewed market enthusiasm. Common tactics include fake airdrop announcements that direct users to malicious sites designed to steal wallet credentials, as well as browser extensions that closely mimic legitimate wallet software. Several reports also describe fraudulent customer support accounts on social media platforms that respond to genuine user complaints with links to fake resolution pages. Security teams recommend a few consistent habits to reduce risk: never entering a seed phrase into a website, verifying browser extension publishers carefully before installing, and treating unsolicited messages claiming to be from official support channels with skepticism. Exchanges and wallet providers have stepped up user education campaigns in response, though researchers note that attackers continue to adapt their tactics quickly enough that awareness alone is unlikely to eliminate the problem entirely.",
  },
  {
    tag: "SECURITY",
    title: "Multi-party computation custody gains ground with exchanges",
    body: "A growing number of exchanges and custodial platforms are adopting multi-party computation, or MPC, technology to secure customer funds, moving away from older models that rely on a single private key or a simple multi-signature setup. MPC splits the cryptographic signing process across multiple independent parties, so that no single party ever holds a complete private key, reducing the risk that a single point of compromise could result in a total loss of funds. Proponents argue the approach also simplifies operational recovery, since losing access to one share does not necessarily mean losing access to funds, unlike traditional single-key custody. Some critics note that MPC systems introduce their own complexity, including the coordination protocols between parties, which themselves need careful security review. Even so, adoption has continued to grow, with several major custodial platforms citing MPC as a core part of their security architecture in recent public disclosures about how customer assets are protected.",
  },
  {
    tag: "SECURITY",
    title: "Bug bounty payouts hit a record high across major protocols",
    body: "Total payouts across major crypto bug bounty programs reached a new record over the past year, according to data compiled from several of the largest platforms coordinating these programs. The increase reflects both a growing number of protocols launching formal bounty programs and larger individual payouts for critical vulnerabilities, some reaching into seven figures for the most severe findings. Security researchers point to this as a sign of growing maturity in the space, with protocol teams increasingly viewing well-funded bug bounties as a cost-effective complement to formal audits rather than a replacement for them. A number of the largest payouts this year went to researchers who identified vulnerabilities in cross-chain bridges, a category that has historically been among the most frequently exploited in the industry. Program organizers say the trend toward larger payouts should continue to attract more experienced security researchers to responsibly disclose vulnerabilities rather than exploit them, given the increasingly competitive alternative of selling exploits on illicit markets.",
  },
  {
    tag: "ADOPTION",
    title: "More payment processors add native stablecoin settlement",
    body: "Several major payment processors have added native stablecoin settlement options over the past few months, allowing merchants to receive payments that settle near-instantly rather than waiting for traditional card network processing times. Early adopters among merchants cite faster access to funds and reduced exposure to chargeback risk as the main draws, alongside meaningfully lower processing fees compared to traditional card payments in some cases. Processors report that adoption so far has skewed toward merchants already comfortable handling digital assets in some form, though several have begun offering automatic conversion to local currency for merchants who prefer not to hold crypto balances directly. Consumer-facing adoption remains an earlier-stage part of the rollout, with most current volume coming from business-to-business settlement rather than everyday retail purchases. Processors expect that to shift gradually as more point-of-sale integrations mature and consumer-facing wallets make paying with stablecoins as simple as a standard card tap.",
  },
  {
    tag: "ADOPTION",
    title: "A growing number of fintech apps add crypto balances alongside cash",
    body: "A number of mainstream fintech apps have added the ability to hold crypto balances directly alongside traditional cash accounts, continuing a trend toward blended banking experiences that treat digital assets as just another balance type rather than a separate specialized feature. The added functionality typically comes through a custody partnership with a licensed third party rather than the fintech company holding assets directly itself, letting the app focus on the user experience while relying on established infrastructure for the underlying custody and compliance work. Onboarding for these features has generally been simplified compared to standalone crypto exchanges, often requiring no additional identity verification beyond what the app already collects for its cash services. Industry observers see this as one of the more significant on-ramps for mainstream adoption, since it removes the friction of signing up for a separate, unfamiliar platform just to hold a small crypto balance alongside money someone already manages daily.",
  },
  {
    tag: "ADOPTION",
    title: "Remittance corridors increasingly route through stablecoins",
    body: "A growing share of cross-border remittance volume is being routed through stablecoins as an intermediate step, according to data from several payment infrastructure providers operating in corridors with historically high transfer fees. The typical flow converts local currency to a stablecoin, transfers it near-instantly across borders, then converts back to the recipient's local currency, often completing in minutes rather than the days traditional wire transfers can take. Fee savings compared to legacy remittance channels have been cited as the primary driver, particularly in corridors where traditional providers charge a high percentage of the transfer amount. Adoption has been strongest among providers serving corridors with less developed traditional banking infrastructure on the receiving end, where stablecoin-based rails can sometimes reach recipients that traditional services struggle to serve efficiently. Regulatory treatment of these flows still varies significantly by jurisdiction, and providers say navigating that patchwork remains one of the bigger operational challenges to scaling further.",
  },
  {
    tag: "ADOPTION",
    title: "Institutional trading desks report rising crypto derivatives volume",
    body: "Trading desks serving institutional clients report a steady rise in crypto derivatives volume over recent months, with growth concentrated in futures and options used primarily for hedging rather than outright directional speculation. Desk operators describe growing familiarity among institutional clients with crypto-specific instruments, a shift from earlier periods when most institutional interest was limited to simple spot exposure. Deeper order books and tighter spreads on regulated derivatives venues have also made larger trades easier to execute without significant price impact, removing one of the practical barriers that previously discouraged institutional participation. Some desks report that clients are increasingly using crypto derivatives as part of broader multi-asset portfolio strategies rather than treating crypto exposure as an isolated allocation, a sign some analysts read as evidence of deepening integration between crypto markets and traditional finance more broadly. Growth has not been uniform across all client segments, with the largest increases concentrated among clients who were already active in traditional derivatives markets.",
  },
  {
    tag: "ADOPTION",
    title: "A new wave of tokenized real-world assets goes live",
    body: "Several new platforms offering tokenized real-world assets have launched in recent weeks, expanding the category beyond the tokenized government debt products that dominated earlier efforts. New offerings include fractionalized real estate, tokenized commodity warehouse receipts, and structured products backed by pools of private credit. Proponents argue tokenization can improve liquidity for traditionally illiquid assets and lower the minimum investment size needed to gain exposure, potentially opening these markets to a wider range of investors. Custody and legal enforceability remain central questions for the category, since a token representing an off-chain asset is only as reliable as the legal and operational framework connecting the two; several platforms have published detailed disclosures addressing exactly how token holders' claims are enforced in the underlying jurisdiction. Analysts covering the space describe it as still early, with total value tokenized this way remaining a small fraction of the broader crypto market, but growing at a faster rate than most other categories.",
  },
  {
    tag: "MINING",
    title: "Bitcoin mining difficulty adjusts upward again",
    body: "Bitcoin's mining difficulty adjusted upward again at its most recent scheduled recalibration, reflecting continued growth in total network hashrate despite periodic swings in profitability. Newer generation mining hardware, which offers meaningfully better energy efficiency than equipment from just a few years ago, has allowed operators to remain profitable even as difficulty climbs, provided their electricity costs stay competitive. Several large mining operators have reported shifting a growing share of their energy sourcing toward renewable and otherwise underutilized power, framing it both as a cost advantage and a response to ongoing public scrutiny of the industry's energy use. Smaller, less efficient operations have reportedly struggled to keep pace with the rising difficulty, and industry watchers expect continued consolidation toward larger operators who can access cheaper power and newer hardware at scale. Network security benefits directly from the rising hashrate trend, since a higher total hashrate makes any theoretical attack on the network meaningfully more expensive to attempt.",
  },
  {
    tag: "MINING",
    title: "Renewable-powered mining sites expand in several regions",
    body: "Mining operations powered primarily by renewable energy have expanded across several regions, often located near sources of otherwise stranded or curtailed power that would go unused without a nearby buyer. Grid operators in some areas have begun partnering directly with mining companies, using their flexible, easily-interruptible power demand as a tool to help balance grid load during periods of oversupply from intermittent sources like wind and solar. Proponents argue this creates a mutually beneficial arrangement: miners access cheap power, while grid operators gain a flexible demand source that can be curtailed quickly during periods of peak demand elsewhere. Critics remain skeptical of how representative these arrangements are of the industry as a whole, noting that a meaningful share of global mining still relies on grids with a heavier fossil fuel mix. Industry groups have pushed for more standardized reporting of mining's energy sourcing to make region-by-region comparisons easier and more transparent going forward.",
  },
  {
    tag: "MINING",
    title: "Mining pool concentration draws renewed decentralization debate",
    body: "Data showing a small handful of mining pools now controlling a majority of total Bitcoin network hashrate has renewed debate over the practical state of mining decentralization. While individual miners within a pool retain their own hardware and can theoretically switch pools at any time, critics note that pool operators still have outsized influence over which transactions get prioritized and how software upgrades are signaled across the network. Pool operators have generally defended the current structure, pointing out that switching between pools is technically simple and that competitive pressure among pools already limits how far any single operator could push its influence before losing hashrate to a rival. Some developers have proposed technical changes that would give individual miners more direct control over transaction selection even while participating in a pool, aiming to reduce the practical concentration of decision-making power without requiring miners to abandon the efficiency benefits of pooling their hashrate together.",
  },
  {
    tag: "MINING",
    title: "ASIC efficiency gains slow production cost growth",
    body: "The latest generation of ASIC mining hardware has delivered another meaningful jump in energy efficiency, helping to offset rising difficulty and keep production costs from climbing as quickly as they otherwise would. Chip manufacturers have leaned on smaller process nodes and improved cooling designs to squeeze more computational output from each unit of electricity consumed, a trend that has held steady across several successive hardware generations. Mining operators who have upgraded to the newest hardware report a meaningful reduction in their all-in cost per unit of hashing power, though the high upfront cost of new equipment means the economics still favor operators with access to cheap capital and cheap power simultaneously. Older hardware, while less efficient, often remains profitable enough to keep running in regions with sufficiently low electricity costs, contributing to a wide efficiency gap across the global mining fleet that industry analysts say is unlikely to fully close any time soon.",
  },
  {
    tag: "MINING",
    title: "Post-halving margins stabilize for larger mining operators",
    body: "Profit margins for larger, more efficient mining operators have stabilized in the months following the most recent block reward halving, after an initial period of pressure as fixed revenue per block dropped sharply overnight. Operators with access to the cheapest power and newest hardware have generally weathered the transition more comfortably, while smaller or less efficient operations have faced tighter margins and, in some cases, have shut down or sold equipment to larger competitors. Transaction fee revenue has provided a partial offset during periods of high network activity, though it remains a smaller and more variable share of total miner revenue compared to the block subsidy itself. Industry analysts note that this pattern, revenue shock followed by gradual stabilization and consolidation toward efficient operators, has repeated across each of the network's prior halvings, and most operators say they planned their capital expenditure and power contracts well in advance with this expected trajectory in mind.",
  },
  {
    tag: "STABLECOIN",
    title: "Stablecoin supply climbs back toward its prior peak",
    body: "The total supply of major stablecoins has climbed steadily over recent months, approaching levels last seen near the previous market cycle's peak. Issuance has picked up across several of the largest stablecoins, generally tracking periods of renewed trading activity, since stablecoins are commonly minted to move capital onto exchanges ahead of anticipated trading opportunities. Redemption flows have remained comparatively modest, suggesting holders are choosing to keep capital in stablecoin form rather than converting back to fiat, which some analysts read as a sign of continued willingness to stay active in the market rather than exiting entirely. Reserve composition across major issuers has also shifted somewhat over the same period, with several issuers increasing the share of reserves held in short-duration government securities rather than commercial paper or other less liquid instruments, a change generally viewed favorably by risk-focused observers tracking the space.",
  },
  {
    tag: "STABLECOIN",
    title: "A new yield-bearing stablecoin design draws scrutiny",
    body: "A newly launched stablecoin that automatically distributes yield to holders has drawn both significant deposits and closer scrutiny from risk-focused observers evaluating exactly how that yield is generated and sustained. The design typically involves investing underlying reserves in yield-generating instruments, then passing a portion of that return back to token holders directly, an approach that differs meaningfully from traditional stablecoins that simply hold reserves without distributing any return. Supporters argue the model offers a more capital-efficient way to hold stable value compared to a non-yielding stablecoin sitting idle, while critics point out that any yield-generating reserve strategy introduces additional risk layers, including duration risk and counterparty exposure, that a purely cash-and-treasury-backed model avoids. Transparency around exactly which instruments back the yield, and how quickly reserves could be liquidated under stress, has emerged as the key differentiator investors are using to compare competing designs in this fast-growing subcategory.",
  },
  {
    tag: "STABLECOIN",
    title: "Cross-chain stablecoin transfers get faster settlement rails",
    body: "Several major stablecoin issuers have expanded native issuance to additional blockchain networks, reducing reliance on third-party bridges that have historically been a common point of failure for moving stablecoins between chains. Native issuance means a stablecoin exists directly on a given chain rather than being represented there as a wrapped, bridge-dependent token, which removes a layer of smart contract risk from the transfer process. Settlement times for transfers between chains that both have native issuance support have dropped significantly compared to bridge-dependent transfers, in some cases settling in the time it takes a single block to confirm on the destination chain. Developers building applications that rely on stablecoin liquidity across multiple chains have welcomed the change, noting that bridge-related security incidents have historically been one of the more costly categories of exploits in the industry, and reducing reliance on them lowers a meaningful source of systemic risk for the broader ecosystem.",
  },
  {
    tag: "STABLECOIN",
    title: "Stablecoins increasingly used for on-chain payroll",
    body: "A growing number of companies with globally distributed, contractor-heavy workforces have begun using stablecoins to handle a portion of their payroll, citing faster settlement and lower fees compared to traditional international wire transfers. Payment platforms built specifically for this use case have added features like batch payments, allowing a company to pay dozens or hundreds of contractors in a single transaction rather than processing each transfer individually. Contractors receiving payment this way report appreciating the speed, often receiving funds within minutes rather than the several business days traditional international transfers can take, particularly when the recipient's local banking infrastructure is less developed. Some companies still convert stablecoin payments to local currency automatically on the recipient's behalf through integrated off-ramp partners, letting contractors receive spendable local currency without needing to interact with crypto directly themselves, which several platforms cite as the feature most responsible for driving broader adoption among contractors less familiar with digital assets.",
  },
  {
    tag: "STABLECOIN",
    title: "Reserve transparency reports become a competitive differentiator",
    body: "Stablecoin issuers have increasingly leaned into detailed, frequent reserve transparency reporting as a way to differentiate themselves from competitors, publishing monthly or even more frequent attestations detailing exactly what backs their circulating supply. Some issuers have gone further, integrating on-chain proof-of-reserves tooling that lets anyone independently verify reported holdings in near real time rather than relying solely on periodic third-party attestations. Users and institutional partners alike have cited transparency as an increasingly important factor when choosing which stablecoin to hold or integrate, particularly following past incidents where opacity around reserve composition contributed to a loss of confidence during periods of market stress. Issuers that have historically been less forthcoming about reserve details have faced growing pressure to match the new transparency standard, with several announcing plans to expand their own reporting in response to competitive and user pressure rather than any specific new regulatory requirement forcing the change.",
  },
  {
    tag: "NFT",
    title: "NFT trading volume ticks up on select blue-chip collections",
    body: "Trading volume across a handful of long-established NFT collections has ticked up over the past several weeks, reversing a longer stretch of declining activity across the category as a whole. The renewed interest has concentrated heavily in a small number of collections widely considered among the category's most established, while volume for newer and lesser-known collections has remained comparatively muted. Marketplace platforms have responded to the shift with renewed fee competition, with several lowering trading fees or introducing loyalty-style rebate programs aimed at winning back active traders who had shifted attention elsewhere during the quieter period. Floor prices for the collections seeing renewed interest have climbed modestly alongside the volume increase, though they remain well below levels seen at the category's earlier peak. Market participants remain divided on whether the uptick represents the start of a more durable recovery or a shorter-lived pickup tied to broader improved sentiment across crypto markets generally.",
  },
  {
    tag: "NFT",
    title: "On-chain gaming assets see growing secondary market activity",
    body: "Secondary market trading of in-game assets represented as on-chain tokens has grown steadily as more games built around player-owned economies reach a critical mass of active users. Unlike traditional in-game items locked to a single title's internal economy, several newer games have designed their assets to be at least partially interoperable, letting certain items retain value or utility across more than one game within a shared ecosystem. Developers building these systems say the appeal for players is straightforward: time and money invested in acquiring in-game assets can translate into something with tradeable value outside the game itself, rather than disappearing entirely if a player stops playing. Critics of the model note that designing genuinely balanced game economies around freely tradeable assets remains a significant unsolved design challenge, since real-money trading can distort gameplay incentives in ways that purely cosmetic or account-bound systems avoid entirely.",
  },
  {
    tag: "NFT",
    title: "Digital ticketing pilots move onto public blockchains",
    body: "Several event organizers have launched pilot programs issuing tickets as NFTs on public blockchains, aiming to reduce the fraud and unauthorized resale markups that have long plagued traditional paper and PDF-based ticketing systems. Because each ticket exists as a uniquely verifiable token, organizers can enforce resale rules directly at the protocol level, including capping resale prices or automatically routing a percentage of any resale back to the original event or artist. Early pilots have reported meaningfully lower instances of counterfeit tickets being used for entry compared to prior events using traditional ticketing, since verifying a blockchain-based ticket's authenticity at the door is significantly harder to spoof than checking a printed barcode. Some attendees have expressed friction around needing a compatible wallet to receive and present their ticket, and several organizers have responded by offering simplified, custodial wallet options specifically designed for one-time event attendees unfamiliar with crypto wallets generally.",
  },
  {
    tag: "NFT",
    title: "Royalty enforcement tools gain adoption among creators",
    body: "New marketplace-level tools designed to enforce creator royalties on secondary NFT sales have gained adoption following a period where many major marketplaces made royalties optional, leading to a sharp drop in royalty payments actually collected by creators. The newer tools generally work by restricting a token's tradeable venues to marketplaces that agree to honor royalty payments, effectively making it harder to trade the token on non-compliant platforms without losing certain features or metadata. Creator response has been largely positive, with several prominent artists specifically praising the return of reliable royalty income after a period where secondary sales often generated no revenue for the original creator at all. Some collectors have pushed back, arguing that enforced royalties reduce liquidity and add friction to trading compared to fully royalty-free alternatives, reflecting an ongoing tension in the space between creator compensation and frictionless secondary market trading that shows no clear sign of fully resolving.",
  },
  {
    tag: "NFT",
    title: "Fractionalized collectible ownership platforms see new inflows",
    body: "Platforms that let multiple buyers pool funds to jointly own a single high-value digital or physical collectible have seen renewed inflows in recent months, extending a niche but persistent corner of the market. The model works by minting fungible tokens representing fractional ownership shares of a single underlying asset, held in shared custody on behalf of all fractional owners. Proponents argue the approach opens access to collectibles that would otherwise be far too expensive for most individual buyers to purchase outright, while also improving liquidity for what would normally be a highly illiquid single asset. Governance around decisions like whether to eventually sell the underlying asset, and at what price, remains one of the more complicated aspects of these platforms, typically requiring some form of on-chain voting among fractional owners. A handful of high-profile successful sales have helped validate the model, though the category overall remains a small niche relative to direct NFT ownership.",
  },
  {
    tag: "MACRO",
    title: "Crypto markets react to the latest rate decision",
    body: "Crypto markets moved in tandem with broader risk assets following the latest interest rate decision from a major central bank, extending a correlation pattern that has held fairly consistently over recent policy cycles. Bitcoin and major altcoins both saw increased volatility in the hours surrounding the announcement, with price action broadly tracking moves in equity futures and the dollar index rather than showing any distinctly crypto-specific reaction. Traders point to tightening or loosening financial conditions as a key driver of risk appetite across all speculative assets, crypto included, rather than treating digital assets as fully insulated from traditional macro forces the way some earlier market narratives suggested. Derivatives positioning data shows funding rates and open interest both shifting modestly in the direction of the broader market reaction, suggesting leveraged traders are treating crypto as part of a broader risk-on or risk-off allocation decision rather than trading it in isolation from other asset classes.",
  },
  {
    tag: "MACRO",
    title: "Inflation data nudges risk appetite across digital assets",
    body: "The latest inflation print came in close to expectations, prompting a modest but broad-based move across risk assets including crypto, which traders describe as a relief rally following weeks of positioning ahead of the data release. Equities, high-yield credit, and major crypto assets all moved in a similar direction following the release, reinforcing the increasingly tight correlation between crypto and traditional risk assets during periods of significant macro data. Some analysts note that crypto's reaction was somewhat more pronounced in percentage terms than the moves seen in traditional markets, consistent with its historically higher volatility profile amplifying moves in either direction relative to more established asset classes. Options markets had priced in a wider-than-usual range of potential outcomes ahead of the release, and implied volatility across crypto options came down noticeably once the data removed some of that uncertainty, a pattern typical of markets working through a known near-term catalyst.",
  },
  {
    tag: "MACRO",
    title: "A stronger dollar weighs on emerging-market crypto adoption metrics",
    body: "A period of broad dollar strength has coincided with softer crypto adoption metrics in several emerging markets, where local currency depreciation against the dollar has historically been a meaningful driver of stablecoin and crypto demand as a hedge. Somewhat counterintuitively, some analysts note that a stronger dollar can initially dampen local crypto activity by making dollar-pegged stablecoins comparatively more expensive to acquire in local currency terms, even though the underlying motivation to seek dollar exposure through crypto rails often increases over the same period. Payment providers operating in affected regions report mixed signals, with transaction volume for smaller, more frequent transfers softening somewhat while larger transfers aimed at longer-term capital preservation have held relatively steady. The overall picture suggests currency-driven crypto demand in these markets responds to more than just the direction of the dollar alone, with local economic conditions and capital control policy playing an equally significant role in shaping actual usage patterns.",
  },
  {
    tag: "MACRO",
    title: "Bond yield moves ripple into crypto derivatives pricing",
    body: "Recent moves in government bond yields have rippled into crypto derivatives markets, with funding rates and futures basis both adjusting in response to shifting expectations around the broader interest rate environment. Higher yields on traditional low-risk assets tend to raise the opportunity cost of holding non-yielding assets like Bitcoin, a dynamic several analysts point to when explaining periods where crypto has underperformed alongside rising rates. Conversely, periods where yields have pulled back have often coincided with improved crypto performance, consistent with the same underlying opportunity-cost logic working in reverse. Carry trade strategies that borrow in low-yielding currencies to fund positions in higher-yielding or higher-beta assets, including crypto, have also shown sensitivity to these yield moves, with several large unwinds of such trades coinciding with periods of outsized crypto volatility historically. Traders increasingly monitor bond markets as a leading indicator worth watching alongside crypto-specific data when assessing near-term directional risk.",
  },
  {
    tag: "MACRO",
    title: "Global liquidity conditions loosen, lifting risk assets broadly",
    body: "A broad loosening in global liquidity conditions, driven by a combination of central bank balance sheet trends and easing financial conditions across several major economies, has coincided with a lift in risk assets generally, crypto included. Analysts who track the relationship between global liquidity and crypto describe Bitcoin in particular as behaving like a high-beta liquidity proxy, tending to outperform during periods of expanding global liquidity and underperform during periods of contraction. The current loosening trend has been gradual rather than sharp, and crypto's reaction so far has been similarly measured compared to some past cycles where more aggressive liquidity expansion coincided with sharper crypto rallies. Market participants caution that liquidity conditions can shift quickly in response to new data or policy signals, and note that the current relatively calm environment should not be read as a guarantee that the recent gradual, steady trend will necessarily continue uninterrupted.",
  },
  {
    tag: "EXCHANGE",
    title: "Order book depth improves across major trading pairs",
    body: "Order book depth across several major trading pairs has improved noticeably over recent months, a trend market makers attribute to a combination of growing overall market participation and targeted incentive programs designed specifically to attract deeper liquidity provision. Tighter bid-ask spreads have followed the improved depth, benefiting traders executing larger orders who previously faced more significant price impact when moving size in thinner markets. Several exchanges have introduced or expanded market maker rebate programs specifically aimed at rewarding firms that consistently provide two-sided liquidity close to the best available price, rather than rewarding raw volume alone regardless of how tight the quotes are. The improved depth has been most pronounced in the most actively traded pairs, while less popular pairs continue to show comparatively thinner books, a pattern that has remained fairly consistent across market cycles regardless of overall market conditions.",
  },
  {
    tag: "EXCHANGE",
    title: "A leading exchange rolls out lower fees for high-volume traders",
    body: "One of the larger crypto exchanges has introduced a revised fee schedule offering meaningfully lower rates for high-volume traders, part of a broader competitive push among major platforms to retain active users increasingly willing to move volume to whichever venue offers the best pricing. The new tiered structure rewards traders who maintain consistent monthly volume above set thresholds with progressively lower maker and taker fees, alongside additional rebates for traders who provide passive liquidity rather than taking it. Smaller retail traders below the highest volume tiers see comparatively modest changes under the new schedule, meaning the update is primarily targeted at retaining the most active trading desks and algorithmic strategies that account for a disproportionate share of total exchange volume. Competing platforms are reportedly reviewing their own fee structures in response, a pattern that has repeated periodically as exchanges compete for the same relatively limited pool of consistently high-volume traders.",
  },
  {
    tag: "EXCHANGE",
    title: "Proof-of-reserves audits become standard practice industry-wide",
    body: "Regular proof-of-reserves audits, once a differentiating feature offered by only a handful of exchanges, have become close to standard practice across the industry following a period of heightened user scrutiny of exchange solvency. Most major platforms now publish some combination of third-party attestations and on-chain verification tools that let users independently confirm the exchange holds sufficient assets to cover customer liabilities at a given point in time. Critics of current practices note that most audits remain point-in-time snapshots rather than continuous, real-time verification, meaning a platform could theoretically appear solvent during an audit while temporarily borrowing assets specifically to pass it. Some newer verification approaches aim to address this gap using cryptographic techniques that make it harder to misrepresent holdings even briefly, though these more rigorous methods have not yet been universally adopted. Users increasingly cite the availability and quality of proof-of-reserves reporting as a factor in choosing which exchange to trust with custody of their assets.",
  },
  {
    tag: "EXCHANGE",
    title: "API trading volume grows as more bots enter the market",
    body: "Volume executed through exchange APIs rather than manual trading interfaces has grown steadily, reflecting a rising share of overall trading activity driven by automated strategies rather than individual traders manually placing orders. Exchanges have responded by upgrading API infrastructure, including higher rate limits and lower-latency order execution paths specifically aimed at serving algorithmic traders who depend on fast, reliable execution to run their strategies effectively. Retail-accessible bot platforms have also grown in popularity, letting individual traders run relatively simple automated strategies, like grid trading or dollar-cost averaging, without needing to write custom code themselves. Exchange operators note that API-driven volume tends to be more consistent across varying market conditions compared to manual retail volume, which tends to spike sharply during periods of high volatility and taper off during quieter stretches, giving automated volume an increasingly important role in maintaining consistent liquidity across all market conditions.",
  },
  {
    tag: "EXCHANGE",
    title: "Cross-exchange arbitrage spreads narrow as liquidity deepens",
    body: "Price discrepancies for the same asset across different exchanges have narrowed measurably as overall market liquidity has deepened, reducing the profit margins available to traders running classic cross-exchange arbitrage strategies. Faster settlement rails between exchanges, including improved stablecoin transfer speeds, have also played a role, shrinking the window during which meaningful price gaps can persist before arbitrageurs close them. Professional market-making and arbitrage firms report that competition within the strategy itself has intensified as more capital has entered the space chasing the same shrinking spreads, pushing some firms to look toward less crowded, more complex multi-leg strategies to maintain profitability. For everyday traders, the practical effect of narrower spreads is a more consistent, unified price across venues, reducing the odds of noticeably overpaying or underselling simply due to which specific exchange an order happens to be routed through at a given moment.",
  },
  {
    tag: "PRODUCT",
    title: "Grid bots now support tighter range configurations",
    body: "Grid bots on the platform now support noticeably tighter price-step configurations, giving traders finer control over how closely spaced each buy and sell level is within a chosen price range. The change is particularly useful in genuinely range-bound markets, where a tighter grid can capture more individual round trips within the same overall price movement compared to a wider-spaced configuration covering the same range. Backtests run against recent historical data show the tighter configurations generating a higher number of completed cycles during low-volatility stretches, though each individual cycle naturally captures a smaller amount of profit given the reduced price gap between levels. As with any grid configuration, a tighter setup also means faster exhaustion of available capital if price moves persistently in one direction outside the configured range, so the update includes updated guidance in the bot creation flow to help traders think through that tradeoff before launching a tighter grid than they might have used previously.",
  },
  {
    tag: "PRODUCT",
    title: "Bot fill feeds now update in real time",
    body: "Every bot's fill feed now updates in real time rather than requiring a manual page refresh to see the latest executed trades, giving traders a live view of exactly what their bot is doing as it happens. The change replaces the previous polling-based refresh with a persistent live connection, meaning a new fill appears in the feed within moments of actually executing rather than waiting for the next scheduled refresh interval. Traders monitoring active bots during volatile periods, when fills can happen in quick succession, should notice the most immediate benefit, since the feed now keeps pace with genuinely fast-moving activity instead of lagging noticeably behind it. The underlying fill history and all other bot data remain exactly the same as before; this update only changes how quickly new activity shows up on screen once it has already happened, not what gets recorded in the first place.",
  },
  {
    tag: "PRODUCT",
    title: "New pairs added to the available bot markets",
    body: "A number of new trading pairs have been added to the set of markets available for bot deployment, expanding coverage based on trader demand and each pair's underlying liquidity depth on the exchange the platform executes through. Each newly added pair goes through the same liquidity and volatility review as existing supported pairs before being made available, ensuring bots deployed against it have a reasonable chance of executing cleanly without excessive slippage on either side of a trade. Traders with existing bots on already-supported pairs are unaffected by the addition; the update only expands what is available when creating a brand-new bot going forward. Feedback requesting which pairs to prioritize next continues to be gathered directly from active traders, and pairs with consistently strong liquidity and steady trading interest remain the most likely candidates for the next round of additions to the available markets list.",
  },
  {
    tag: "PRODUCT",
    title: "Portfolio history charting gets smoother data buckets",
    body: "The portfolio history chart on the home screen now uses smoother, more evenly distributed data buckets across each of its four range options, improving how accurately the chart's overall shape reflects actual balance movement over the selected period. Previously, buckets could occasionally cluster unevenly depending on when specific balance-changing events happened to occur, sometimes making the chart line look choppier than the underlying balance history actually was. The updated bucketing logic evens this out, producing a cleaner line that more faithfully represents the general trend across the selected time range without smoothing away genuinely significant swings in balance. The percentage change figure shown alongside the chart is calculated the same way as before, comparing the first and last data points in the selected range; only the visual shape of the line connecting those points, and everything in between, has been refined by this update.",
  },
  {
    tag: "PRODUCT",
    title: "Dark mode refinements roll out across every screen",
    body: "A round of dark mode refinements has rolled out across every screen in the app, tightening up contrast ratios and refining focus-state styling that had been slightly inconsistent between light and dark themes in a handful of places. The update touches surface colors, border treatments, and status-indicator colors across dozens of components, aiming for a dark theme that feels genuinely designed for low-light viewing rather than a simple color inversion of the light theme. Transitions between light and dark mode, triggered either by the manual toggle in the menu or by a change in system-level preference, now animate smoothly rather than snapping instantly, matching how other theme-driven color changes already behaved elsewhere in the app. No functional behavior changes with this update; every affected screen continues to work exactly as before, with only the visual presentation refined across both supported themes.",
  },
];

// Real crypto/finance news organizations — cycled onto every article below
// by index, the same way NEWS_IMAGES cycles a photo onto each one. Chosen
// deliberately as actual, currently-publishing outlets (matching what was
// asked: attribution should read as something a real person could go look
// up), not invented placeholder names, since a byline is only meaningful
// if it names someone who could plausibly have written the piece.
const NEWS_SOURCES = [
  "CoinDesk",
  "Cointelegraph",
  "The Block",
  "Decrypt",
  "Bloomberg",
  "Reuters",
  "Blockworks",
  "CryptoSlate",
  "The Defiant",
  "DL News",
];

// Adds a photo and a "published by" source to each article above.
// image: cycles through NEWS_IMAGES — article i gets
// NEWS_IMAGES[i % NEWS_IMAGES.length], so with 45 images and 60 articles
// the last 15 articles simply reuse an earlier photo.
// source: every PRODUCT-tagged article (see NEWS_ARTICLES above) is a
// Quantex changelog entry, not third-party journalism — no real outlet
// would publish "Grid bots now support tighter range configurations", so
// those are attributed to "Quantex" itself rather than a news org. Every
// other article cycles through NEWS_SOURCES by index, same mechanism as
// the image cycling right above it.
const NEWS_POOL = NEWS_ARTICLES.map((article, i) => ({
  ...article,
  image: NEWS_IMAGES[i % NEWS_IMAGES.length],
  source: article.tag === "PRODUCT" ? "Quantex" : NEWS_SOURCES[i % NEWS_SOURCES.length],
}));

// How many of NEWS_POOL's 60 articles show up in a given day's News tab.
const NEWS_PER_DAY = 10;

// Plausible "time ago" labels applied by list position (index 0 = the
// first/newest card) rather than stored per article — see the comment
// where this is used in NewsSection for why a fixed per-article
// timestamp doesn't make sense once the visible 10 rotate daily. Matches
// NEWS_PER_DAY in length; if you change NEWS_PER_DAY, extend or trim
// this list to match.
const NEWS_TIME_LABELS = ["1h ago", "3h ago", "5h ago", "8h ago", "12h ago", "1d ago", "1d ago", "2d ago", "3d ago", "4d ago"];

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

  // Today's 10 articles out of the 60-article NEWS_POOL — see pickDaily's
  // comment above for how the daily rotation works; "news" is a distinct
  // salt from the ads carousel's "ads" salt so the two rotate
  // independently rather than picking in lockstep on the same day.
  const newsItems = useMemo(() => pickDaily(NEWS_POOL, NEWS_PER_DAY, "news"), []);

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
      </div>

      {feedTab === "news" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          {newsItems.map((item, i) => (
            // NEWS_TIME_LABELS[i] rather than a time stored per-article —
            // which 10 articles are showing changes every day, so a fixed
            // per-article timestamp would drift out of sync with reality
            // fast; generating "how long ago" from the card's position in
            // today's already-newest-first list always looks current.
            <NewsCard
              key={item.title}
              article={item}
              timeLabel={NEWS_TIME_LABELS[i] ?? NEWS_TIME_LABELS[NEWS_TIME_LABELS.length - 1]}
              t={t}
            />
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

// One row inside the News tab — Bybit's own news list uses this same
// shape: a square thumbnail next to a tag/headline/byline stack, collapsed
// by default. There's no article-reader page in this app (this is
// decorative preview content, not a real news feed), so rather than
// building out a whole new route just to show ~150 words of fake copy,
// tapping the row expands it in place to reveal the full body — same
// idea as a Bybit list row navigating to a full article, adapted to not
// need a second screen.
//
// The byline ("Published {time} · {source}") reads article.source, which
// NEWS_POOL above already resolved per-article — either a real news
// organization's name, or "Quantex" itself for the platform's own
// PRODUCT-tagged changelog entries. See NEWS_POOL's comment for exactly
// how that's decided; nothing here needs to know the difference.
function NewsCard({ article, timeLabel, t }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "12px 14px",
        textAlign: "left",
        cursor: "pointer",
        // Reset button-element defaults so this reads as a card, not a
        // native button — same pattern QuickTile/BotCard use via <Link>,
        // just on a <button> here since there's no route to navigate to.
        font: "inherit",
        color: "inherit",
      }}
    >
      <div style={{ display: "flex", gap: "var(--space-6)" }}>
        <img
          src={article.image}
          alt=""
          width={56}
          height={56}
          style={{ width: 56, height: 56, borderRadius: "var(--radius-sm)", objectFit: "cover", flexShrink: 0 }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", minWidth: 0 }}>
          <span style={{ fontFamily: "var(--font-data)", fontSize: "9px", letterSpacing: "0.05em", color: "var(--teal-base)" }}>
            {article.tag}
          </span>
          <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "12.5px", color: "var(--ink-base)" }}>
            {article.title}
          </span>
          <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", color: "var(--ink-soft)" }}>
            {t("home.news.publishedMeta", { time: timeLabel, source: article.source })}
          </span>
        </div>
      </div>

      {expanded && (
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-body)",
            fontSize: "12px",
            lineHeight: 1.6,
            color: "var(--ink-soft)",
            paddingTop: "var(--space-3)",
            borderTop: "1px solid var(--cream-line)",
          }}
        >
          {article.body}
        </p>
      )}
    </button>
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

// Bybit's home screen has a "Discover" row of educational article cards
// near the bottom of the feed — this is that, adapted to Quantex. Unlike
// Leaderboard/News (which are simulated stand-ins for a system that
// doesn't exist yet), this one is genuinely finished: there's no article/
// CMS system anywhere in this app's architecture doc, so there's nothing
// to "wire up later" here — it's a small fixed pool of real external
// articles, same treatment as AdsCarousel's photo pool below.
//
// Every article is a real, verified Binance Academy URL (checked by hand,
// not guessed) chosen to match something this specific app actually does:
// the three bot strategies Quantex offers (Grid, DCA, momentum), spot-only
// trading (no leverage, matching this platform), wallet security (relevant
// right where deposit/withdraw live), and stablecoins (everything here is
// priced in USDT). `title`/`body` below are this app's own short summary
// of each article, not copied text from Binance Academy.
//
// To add or swap an article: add a row here (or edit one) with a `url`,
// an `icon` name from Icon.jsx, a short `tag`/`title`/`body`, done — no
// other file needs to change. To resize the whole row, add/remove rows;
// there's no daily-rotation logic here the way AdsCarousel has (its 30-ad
// pool needed that to avoid repetition — a 7-card static row doesn't).
const DISCOVER_ARTICLES = [
  {
    tag: "BOTS",
    icon: "bots",
    title: "How trading bots actually work",
    body: "A quick primer on what a bot does and why traders automate their strategy instead of trading by hand.",
    url: "https://academy.binance.com/en/articles/your-guide-to-binance-trading-bots",
  },
  {
    tag: "GRID",
    icon: "bots",
    title: "Grid trading, step by step",
    body: "The strategy behind Quantex's Grid bots — buying dips and selling rallies automatically inside a price range.",
    url: "https://academy.binance.com/en/articles/step-by-step-guide-to-grid-trading-on-binance-futures",
  },
  {
    tag: "DCA",
    icon: "dollar",
    title: "What is dollar-cost averaging?",
    body: "The idea behind Quantex's DCA bots — investing a fixed amount on a schedule instead of trying to time the market.",
    url: "https://academy.binance.com/en/articles/dollar-cost-averaging-dca-explained",
  },
  {
    tag: "MOMENTUM",
    icon: "markets",
    title: "Reading market momentum",
    body: "How momentum traders spot when a move is just getting started — and when it's already running out of steam.",
    url: "https://academy.binance.com/en/glossary/market-momentum",
  },
  {
    tag: "SPOT",
    icon: "trade",
    title: "Spot trading, the basics",
    body: "No leverage, no liquidations — just buying and selling what you actually own, the way every trade on Quantex works.",
    url: "https://academy.binance.com/en/articles/what-is-a-spot-market-and-how-to-do-spot-trading",
  },
  {
    tag: "SECURITY",
    icon: "shield",
    title: "Keep your holdings secure",
    body: "Five habits that meaningfully lower your risk of losing crypto to a hack, a scam, or a leaked seed phrase.",
    url: "https://academy.binance.com/en/articles/5-tips-to-secure-your-cryptocurrency-holdings",
  },
  {
    tag: "STABLECOINS",
    icon: "dollar",
    title: "Why everything here is priced in USDT",
    body: "What a stablecoin actually is, and why it's the base currency behind almost every trade on this platform.",
    url: "https://academy.binance.com/en/articles/what-is-a-stablecoin",
  },
];

function DiscoverSection({ t }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <SectionHeader title={t("home.discover.title")} />
      <div
        className="qx-hide-scrollbar"
        style={{
          display: "flex",
          gap: "var(--space-5)",
          overflowX: "auto",
          // No scroll-snap here (unlike AdsCarousel) — these cards are
          // meant to read as a loose, keep-scrolling row of articles you
          // browse past, not a one-slide-at-a-time carousel with dots.
          WebkitOverflowScrolling: "touch",
          // Bleeds past the page's own 20px side padding so the row's
          // last partial card hints "there's more" right at the edge of
          // the screen, the same peeking-card treatment Bybit uses for
          // this exact row.
          margin: "0 -20px",
          padding: "0 20px",
        }}
      >
        {DISCOVER_ARTICLES.map((article) => (
          <DiscoverCard key={article.url} article={article} />
        ))}
      </div>
    </div>
  );
}

// One article card — external link (opens Binance Academy in a new tab so
// the user's Quantex session/scroll position isn't lost), duotone icon
// tile matching QuickTile's exact look further up this page for a
// consistent icon language across the screen.
function DiscoverCard({ article }) {
  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        flex: "0 0 156px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "14px",
        textDecoration: "none",
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: "var(--radius-md)",
          background: "var(--teal-pale)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={article.icon} size={18} color="var(--teal-base)" />
      </div>
      <span style={{ fontFamily: "var(--font-data)", fontSize: "9px", letterSpacing: "0.05em", color: "var(--teal-base)" }}>
        {article.tag}
      </span>
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", color: "var(--ink-base)", lineHeight: 1.3 }}>
        {article.title}
      </span>
      <span style={{ fontFamily: "var(--font-body)", fontSize: "10.5px", color: "var(--ink-soft)", lineHeight: 1.4 }}>
        {article.body}
      </span>
    </a>
  );
}
