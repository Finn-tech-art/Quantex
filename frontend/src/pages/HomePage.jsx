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
import { useEffect, useId, useRef, useState } from "react";
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

// Wraps the Active Bots list and the new Ads carousel behind a 2-pill
// segmented toggle, in place of the section's old plain text title.
// `view` is local-only UI state (never sent anywhere) — "bots" is the
// default so the Active Bots list is what a user sees first, matching
// the previous behaviour before the Ads pill existed. Switch the
// default by changing the useState initial value below.
function BotsAndAdsSection({ bots, loading, t }) {
  const [view, setView] = useState("bots");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SegmentedToggle
          options={[
            { value: "bots", label: t("home.activeBots.title") },
            { value: "ads", label: t("home.adsSection.toggleLabel") },
          ]}
          selected={view}
          onSelect={setView}
        />
        {/* "See all" only makes sense for the bots list — the ads
            carousel has no equivalent destination, so it's hidden
            rather than left pointing somewhere irrelevant. */}
        {view === "bots" && (
          <Link to="/bots" style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--teal-base)", textDecoration: "none" }}>
            {t("home.activeBots.seeAll")}
          </Link>
        )}
      </div>

      {view === "bots" ? (
        loading ? (
          <AnimatedPsi mode="working" size={22} color="var(--teal-base)" />
        ) : bots.length === 0 ? (
          <EmptyBotsCard t={t} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
            {bots.map((bot) => (
              <BotCard key={bot.id} bot={bot} />
            ))}
          </div>
        )
      ) : (
        <AdsCarousel t={t} />
      )}
    </div>
  );
}

// Two-pill segmented control — same filled-pill-on-selected look as
// RangeTabs above, but sized for a section header (12px label vs
// RangeTabs' 11px) and using the light-surface --cream/--teal tokens
// instead of RangeTabs' on-dark hero-card tokens, since this sits
// directly on the page background rather than inside --teal-deep.
function SegmentedToggle({ options, selected, onSelect }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "2px",
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-md)",
        padding: "2px",
      }}
    >
      {options.map((opt) => {
        const active = opt.value === selected;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "12.5px",
              color: active ? "var(--on-accent)" : "var(--ink-soft)",
              background: active ? "var(--teal-base)" : "none",
              border: "none",
              borderRadius: "var(--radius-sm)",
              padding: "6px 12px",
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

// Sample ad slides for the Ads carousel — fake promo content (no real ad
// system exists yet), each pairing a real photo with made-up copy from
// i18n.js's home.adsSection block. Photos are hotlinked from Unsplash's
// image CDN (images.unsplash.com — Unsplash's license allows this, no
// API key needed for a plain <img>/background-image request); swap any
// `image` value here for a different photo's `photo-<id>` URL to change
// what a slide shows. Add or remove rows here (and a matching
// slideN key in i18n.js) to change how many slides the carousel has.
const AD_SLIDES = [
  { image: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&q=80&auto=format&fit=crop", tagKey: "slide1Tag", titleKey: "slide1Title", bodyKey: "slide1Body" },
  { image: "https://images.unsplash.com/photo-1605792657660-596af9009e82?w=800&q=80&auto=format&fit=crop", tagKey: "slide2Tag", titleKey: "slide2Title", bodyKey: "slide2Body" },
  { image: "https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=800&q=80&auto=format&fit=crop", tagKey: "slide3Tag", titleKey: "slide3Title", bodyKey: "slide3Body" },
  { image: "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=800&q=80&auto=format&fit=crop", tagKey: "slide4Tag", titleKey: "slide4Title", bodyKey: "slide4Body" },
  { image: "https://images.unsplash.com/photo-1672911640671-65d5dfa97d26?w=800&q=80&auto=format&fit=crop", tagKey: "slide5Tag", titleKey: "slide5Title", bodyKey: "slide5Body" },
];

// Bybit-style sliding ad banner carousel. Built on native CSS scroll-snap
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
      scrollToIndex((index + 1) % AD_SLIDES.length);
    }, AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [index]);

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
      setIndex(Math.max(0, Math.min(AD_SLIDES.length - 1, nearest)));
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
        {AD_SLIDES.map((slide, i) => (
          <AdSlide key={i} slide={slide} t={t} />
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: "var(--space-3)" }}>
        {AD_SLIDES.map((_, i) => (
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
