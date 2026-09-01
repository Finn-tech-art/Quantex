// The admin landing dashboard — "how's the platform doing right now."
// Backed entirely by GET /admin/overview (admin_overview_service.py on the
// backend), which returns today's signup/deposit snapshot plus a full
// day-by-day history from the very first signup or deposit through today.
// This page never re-fetches on interaction below — the whole `daily`
// array comes down in one call and every view (the day-picker calendar,
// the combined chart) just re-derives from that same array client-side,
// since a personal project's whole history is tiny by web-app standards.
//
// Second version of this page — the first had a GitHub-contributions-style
// heatmap (removed: it didn't answer "what happened on day X" nearly as
// directly as just picking day X on a real calendar and reading the
// numbers) and two separate single-axis charts (merged into one combined
// bar+line chart below). The combined chart is a deliberate, informed
// exception to the general "never dual-axis" charting rule: signup COUNTS
// and deposit DOLLAR amounts are different units on different scales, so
// this uses two independent axes, each tick-labeled and colored to match
// its own series (teal for signups, green for deposits) specifically so
// the two scales never read as directly comparable — that labeling is
// what keeps a dual-axis chart from being misleading, which is the actual
// reason it's normally avoided.
//
// Every chart/calendar on this page is hand-rolled inline SVG/HTML rather
// than a charting library (lightweight-charts, already a dependency, is
// built for candlesticks specifically — see LiveChart.jsx). Plain SVG/HTML
// can read this app's CSS custom properties directly via `fill`/`stroke`/
// `style` (a <canvas>-based chart can't, which is why LiveChart.jsx has to
// keep a literal hex mirror of index.css) — so every color below is a
// `var(--...)` token, never a hardcoded hex, per this project's own
// design-system rule.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "../context/AdminAuthContext";
import AdminNav from "../components/AdminNav";
import AnimatedPsi from "../components/AnimatedPsi";
import Icon from "../components/Icon";
import { useEffect, useRef } from "react";
import { getAdminOverview } from "../lib/api";

// The pills under the combined chart — "all" always shows the FULL `daily`
// array (whatever that spans), the other three take the last N calendar
// days off the end of it. Add a row here (e.g. "365d") to offer another
// fixed window; nothing else on this page needs to change.
const RANGE_OPTIONS = [
  { value: "30d", label: "30D", days: 30 },
  { value: "90d", label: "90D", days: 90 },
  { value: "180d", label: "180D", days: 180 },
  { value: "all", label: "ALL", days: null },
];

// Single-letter Sun..Sat column headers for the day-picker grid — plain
// hardcoded strings rather than routed through i18n, same precedent
// RANGE_OPTIONS' "30D"/"90D" labels above already set (this app is
// English-only for now — see CLAUDE.md).
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

const ZERO_DAY = { signups: 0, deposits_count: 0, deposits_amount: "0.00" };

function formatDateLabel(dateStr) {
  // dateStr is "YYYY-MM-DD" (a UTC calendar day, no time component) — the
  // "T00:00:00Z" suffix forces Date to parse it as UTC midnight rather than
  // the browser's local timezone, which would otherwise shift the displayed
  // day backward for anyone west of UTC.
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatFullDateLabel(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatCount(n) {
  return n.toLocaleString();
}

function formatUsd(amountStr) {
  const n = Number(amountStr);
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export default function AdminOverviewPage() {
  const { t } = useTranslation();
  const { admin, adminToken, logout } = useAdminAuth();

  const [overview, setOverview] = useState(null); // null = still loading
  const [range, setRange] = useState("30d");

  useEffect(() => {
    if (!adminToken) return;
    getAdminOverview(adminToken).then(setOverview);
  }, [adminToken]);

  if (overview === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <AnimatedPsi mode="working" size={30} color="var(--teal-base)" />
      </div>
    );
  }

  // Slice the one full `daily` array down to whatever window the range
  // pills selected — see RANGE_OPTIONS' comment above for why this never
  // triggers a second network call. The day-picker calendar below always
  // gets the FULL array regardless of this — "browse any day ever" is a
  // separate concern from "how wide a window the chart plots."
  const activeRange = RANGE_OPTIONS.find((r) => r.value === range) ?? RANGE_OPTIONS[0];
  const windowedDaily = activeRange.days == null ? overview.daily : overview.daily.slice(-activeRange.days);

  return (
    <div className="flex min-h-screen justify-center px-5 py-8">
      <div className="w-full max-w-sm" style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "17px", color: "var(--ink-base)" }}>
            {t("admin.overview.title")}
          </span>
          <button
            type="button"
            onClick={logout}
            style={{ background: "none", border: "none", fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)", cursor: "pointer" }}
          >
            {t("admin.overview.logout")}
          </button>
        </div>

        {admin && (
          <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", color: "var(--ink-soft)" }}>{admin.email}</span>
        )}

        <AdminNav />

        <StatCardsRow overview={overview} t={t} />

        <DayPickerCalendar daily={overview.daily} t={t} />

        <RangePills selected={range} onSelect={setRange} />

        <CombinedChart
          data={windowedDaily.map((d) => ({
            date: d.date,
            signups: d.signups,
            depositsAmount: Number(d.deposits_amount),
          }))}
          t={t}
        />
      </div>
    </div>
  );
}

// ── Stat cards ─────────────────────────────────────────────────────────────
function StatCardsRow({ overview, t }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <StatCard
        label={t("admin.overview.statSignupsToday")}
        value={formatCount(overview.signups_today)}
      />
      <div style={{ display: "flex", gap: "var(--space-5)" }}>
        <StatCard
          label={t("admin.overview.statDepositsCountToday")}
          value={formatCount(overview.deposits_today_count)}
          flex
        />
        <StatCard
          label={t("admin.overview.statDepositsAmountToday")}
          value={formatUsd(overview.deposits_today_amount)}
          flex
        />
      </div>
    </div>
  );
}

function StatCard({ label, value, flex }) {
  return (
    <div
      style={{
        flex: flex ? 1 : undefined,
        background: "var(--teal-deep)",
        borderRadius: "var(--radius-2xl)",
        padding: "var(--space-8)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      <span style={{ fontFamily: "var(--font-data)", fontSize: "9px", letterSpacing: "0.08em", color: "var(--teal-sage)" }}>
        {label.toUpperCase()}
      </span>
      <span className="qx-num" style={{ fontFamily: "var(--font-data)", fontWeight: 600, fontSize: "22px", color: "var(--on-accent)" }}>
        {value}
      </span>
    </div>
  );
}

// ── Range pills — same "filled pill for the active option" language as
// HomePage.jsx's RangeTabs, just recolored for a light --cream-deep card
// instead of that component's dark --teal-deep hero card. ───────────────────
function RangePills({ selected, onSelect }) {
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
              color: active ? "var(--on-accent)" : "var(--ink-soft)",
              background: active ? "var(--teal-base)" : "var(--cream-deep)",
              border: `1px solid ${active ? "var(--teal-base)" : "var(--cream-line)"}`,
              borderRadius: "var(--radius-sm)",
              padding: "5px 10px",
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

// ── Floating tooltip shared by the combined chart below — plain absolute
// positioning against whichever container passes a leftPercent (never
// attached to the mouse itself, which would fight with pointer-events on
// the SVG underneath it). pointerEvents: "none" is what lets mouse events
// pass straight through to the chart underneath. ───────────────────────────
function FloatingTooltip({ leftPercent, dateLabel, lines }) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${clamp(leftPercent, 8, 92)}%`,
        top: 0,
        transform: "translate(-50%, -100%)",
        background: "var(--ink-base)",
        color: "var(--cream-base)",
        fontFamily: "var(--font-data)",
        fontSize: "10px",
        lineHeight: 1.5,
        padding: "6px 9px",
        borderRadius: "var(--radius-sm)",
        pointerEvents: "none",
        whiteSpace: "nowrap",
        zIndex: 2,
      }}
    >
      <div style={{ opacity: 0.75 }}>{dateLabel}</div>
      {lines.map((line) => (
        <div key={line.text} style={{ fontWeight: 600, color: line.color || "var(--cream-base)" }}>
          {line.text}
        </div>
      ))}
    </div>
  );
}

// ── Day-picker calendar — a real month-grid calendar (prev/next month
// navigation, Sun..Sat columns, one cell per day) rather than the
// GitHub-style heatmap this replaced. Tapping any day shows that day's
// exact signups/deposits below the grid via SelectedDayDetail — this is
// the direct "pick a day, see its numbers" interaction that was asked for,
// which a heatmap's hover-only tooltip never gave a mouse-less/tap
// audience (or anyone) an explicit, sticky answer for. ─────────────────────
function DayPickerCalendar({ daily, t }) {
  // `daily` always has at least one row (today, per
  // admin_overview_service.get_overview's own guarantee — see that
  // function's docstring) — this guard is defensive only, not a state this
  // page actually expects to hit.
  const latestDateStr = daily.length > 0 ? daily[daily.length - 1].date : null;
  const [latestYear, latestMonth] = latestDateStr
    ? latestDateStr.split("-").slice(0, 2).map((s) => parseInt(s, 10))
    : [null, null];
  // latestMonth from the date string is 1-indexed ("09" for September);
  // JS Date months are 0-indexed — converting once here, right at the
  // source, means every other calculation below can stay in the 0-indexed
  // convention Date.UTC/getUTCMonth already use, with no repeated +/-1s to
  // keep straight.
  const latestMonth0 = latestMonth !== null ? latestMonth - 1 : null;

  const [viewYear, setViewYear] = useState(latestYear);
  const [viewMonth, setViewMonth] = useState(latestMonth0); // 0-11
  const [selectedDate, setSelectedDate] = useState(latestDateStr);

  if (daily.length === 0 || viewYear === null) {
    return null;
  }

  const byDate = new Map(daily.map((d) => [d.date, d]));
  const isAtLatestMonth = viewYear === latestYear && viewMonth === latestMonth0;

  function goToPrevMonth() {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }

  function goToNextMonth() {
    // Belt-and-suspenders — the button itself is also disabled at this
    // point (see below), this just guarantees a stray Enter-key submit or
    // similar can't sneak the view past the latest real month either.
    if (isAtLatestMonth) return;
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  const monthLabel = new Date(Date.UTC(viewYear, viewMonth, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  // Standard month-grid build: `startWeekday` leading blanks so day 1 lands
  // in its real Sun..Sat column, then one cell per real day of the month,
  // then trailing blanks padded out to a multiple of 7 so every row is a
  // full week (keeps the grid rectangular instead of a ragged last row).
  const startWeekday = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = new Date(Date.UTC(viewYear, viewMonth, day)).toISOString().slice(0, 10);
    cells.push({ day, dateStr, entry: byDate.get(dateStr) || null });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedEntry = selectedDate ? byDate.get(selectedDate) || ZERO_DAY : null;

  return (
    <div
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-8)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", color: "var(--ink-base)" }}>
          {t("admin.overview.dayPickerTitle")}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
          <MonthNavButton direction="prev" onClick={goToPrevMonth} label={monthLabel} />
          <span style={{ fontFamily: "var(--font-data)", fontSize: "11px", color: "var(--ink-base)", minWidth: 92, textAlign: "center" }}>
            {monthLabel}
          </span>
          <MonthNavButton direction="next" onClick={goToNextMonth} disabled={isAtLatestMonth} label={monthLabel} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {WEEKDAY_LABELS.map((label, i) => (
          <span
            key={i}
            style={{
              textAlign: "center",
              fontFamily: "var(--font-data)",
              fontSize: "9px",
              color: "var(--ink-soft)",
              paddingBottom: 4,
            }}
          >
            {label}
          </span>
        ))}

        {cells.map((cell, i) => {
          if (cell === null) return <div key={`blank-${i}`} />;
          const isSelected = cell.dateStr === selectedDate;
          const hasActivity = cell.entry && cell.entry.signups + cell.entry.deposits_count > 0;
          return (
            <button
              key={cell.dateStr}
              type="button"
              onClick={() => setSelectedDate(cell.dateStr)}
              style={{
                position: "relative",
                aspectRatio: "1 / 1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: isSelected ? "var(--teal-base)" : "transparent",
                color: isSelected ? "var(--on-accent)" : "var(--ink-base)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                fontFamily: "var(--font-data)",
                fontSize: "11px",
                fontWeight: isSelected ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {cell.day}
              {hasActivity && !isSelected && (
                <span
                  style={{
                    position: "absolute",
                    bottom: 3,
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    background: "var(--teal-base)",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {selectedEntry && <SelectedDayDetail date={selectedDate} entry={selectedEntry} t={t} />}
    </div>
  );
}

function MonthNavButton({ direction, onClick, disabled, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "prev" ? `Previous month, before ${label}` : `Next month, after ${label}`}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        background: "var(--cream-base)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-sm)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Icon name={direction === "prev" ? "chevronLeft" : "chevronRight"} size={13} color="var(--ink-base)" />
    </button>
  );
}

function SelectedDayDetail({ date, entry, t }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "11.5px", color: "var(--ink-base)" }}>
        {formatFullDateLabel(date)}
      </span>
      <div style={{ display: "flex", gap: "var(--space-4)" }}>
        <DayStatTile label={t("admin.overview.statSignupsToday")} value={formatCount(entry.signups)} />
        <DayStatTile label={t("admin.overview.statDepositsCountToday")} value={formatCount(entry.deposits_count)} />
        <DayStatTile label={t("admin.overview.dayAmountLabel")} value={formatUsd(entry.deposits_amount)} />
      </div>
    </div>
  );
}

function DayStatTile({ label, value }) {
  return (
    <div
      style={{
        flex: 1,
        background: "var(--cream-base)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-5)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        minWidth: 0,
      }}
    >
      <span style={{ fontFamily: "var(--font-body)", fontSize: "8.5px", color: "var(--ink-soft)", letterSpacing: "0.03em" }}>
        {label.toUpperCase()}
      </span>
      <span
        className="qx-num"
        style={{ fontFamily: "var(--font-data)", fontWeight: 600, fontSize: "12.5px", color: "var(--ink-base)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {value}
      </span>
    </div>
  );
}

// ── Combined chart — signups (bars, left axis, --teal-base) and deposit $
// (line, right axis, --gain) sharing one time axis. See this file's module
// comment for why a dual-axis chart is the deliberate exception here
// rather than the usual "one axis" rule, and why both axes are tick-
// labeled and colored to match their series specifically to prevent the
// two differently-scaled lines from reading as directly comparable. ───────
const COMBO_VIEW_WIDTH = 320;
const COMBO_VIEW_HEIGHT = 170;
const COMBO_PADDING = { top: 16, right: 34, bottom: 20, left: 30 };
const COMBO_PLOT_W = COMBO_VIEW_WIDTH - COMBO_PADDING.left - COMBO_PADDING.right;
const COMBO_PLOT_H = COMBO_VIEW_HEIGHT - COMBO_PADDING.top - COMBO_PADDING.bottom;

function CombinedChart({ data, t }) {
  const containerRef = useRef(null);
  const [hoverIndex, setHoverIndex] = useState(null);

  const empty = data.length === 0;
  const maxSignups = Math.max(1, ...data.map((d) => d.signups));
  const maxDeposits = Math.max(1, ...data.map((d) => d.depositsAmount));

  const slotWidth = data.length > 0 ? COMBO_PLOT_W / data.length : 0;
  const barGap = data.length > 40 ? 1 : 2; // denser windows (90D/ALL) need a thinner gap to stay legible
  const barWidth = Math.max(1, slotWidth - barGap);

  function xCenter(i) {
    return COMBO_PADDING.left + i * slotWidth + slotWidth / 2;
  }
  function ySignups(v) {
    return COMBO_PADDING.top + COMBO_PLOT_H - (v / maxSignups) * COMBO_PLOT_H;
  }
  function yDeposits(v) {
    return COMBO_PADDING.top + COMBO_PLOT_H - (v / maxDeposits) * COMBO_PLOT_H;
  }

  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xCenter(i).toFixed(1)} ${yDeposits(d.depositsAmount).toFixed(1)}`)
    .join(" ");

  function handleMove(e) {
    if (!containerRef.current || data.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    setHoverIndex(clamp(Math.floor(relX * data.length), 0, data.length - 1));
  }

  const hovered = hoverIndex !== null ? data[hoverIndex] : null;

  return (
    <div
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-8)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-5)",
      }}
    >
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", color: "var(--ink-base)" }}>
        {t("admin.overview.combinedChartTitle")}
      </span>

      {/* Legend — required whenever a chart has 2+ series (see this app's
          dataviz conventions) so identity is never color-alone: a filled
          square for the bars, a short line stroke for the line series,
          each labeled and colored to match its axis. */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
        <LegendItem shape="square" color="var(--teal-base)" label={t("admin.overview.legendSignups")} />
        <LegendItem shape="line" color="var(--gain)" label={t("admin.overview.legendDeposits")} />
      </div>

      {empty ? (
        <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)" }}>
          {t("admin.overview.noData")}
        </span>
      ) : (
        <div ref={containerRef} style={{ position: "relative" }} onMouseMove={handleMove} onMouseLeave={() => setHoverIndex(null)}>
          <svg
            viewBox={`0 0 ${COMBO_VIEW_WIDTH} ${COMBO_VIEW_HEIGHT}`}
            style={{ width: "100%", height: COMBO_VIEW_HEIGHT, display: "block" }}
            preserveAspectRatio="none"
          >
            {/* Recessive baseline + top gridline only — a busier grid would
                compete with two overlaid series more than it would help. */}
            <line
              x1={COMBO_PADDING.left}
              x2={COMBO_VIEW_WIDTH - COMBO_PADDING.right}
              y1={COMBO_PADDING.top + COMBO_PLOT_H}
              y2={COMBO_PADDING.top + COMBO_PLOT_H}
              stroke="var(--cream-line)"
              strokeWidth={1}
            />

            {/* Left axis (signups, teal) — 0 and max only, not a dense
                scale, since the hover tooltip gives the exact number. */}
            <text x={COMBO_PADDING.left - 4} y={COMBO_PADDING.top + COMBO_PLOT_H + 3} fontSize={8} fontFamily="var(--font-data)" fill="var(--teal-base)" textAnchor="end">
              0
            </text>
            <text x={COMBO_PADDING.left - 4} y={COMBO_PADDING.top + 6} fontSize={8} fontFamily="var(--font-data)" fill="var(--teal-base)" textAnchor="end">
              {formatCount(maxSignups)}
            </text>

            {/* Right axis (deposits $, green) */}
            <text x={COMBO_VIEW_WIDTH - COMBO_PADDING.right + 4} y={COMBO_PADDING.top + COMBO_PLOT_H + 3} fontSize={8} fontFamily="var(--font-data)" fill="var(--gain)" textAnchor="start">
              $0
            </text>
            <text x={COMBO_VIEW_WIDTH - COMBO_PADDING.right + 4} y={COMBO_PADDING.top + 6} fontSize={8} fontFamily="var(--font-data)" fill="var(--gain)" textAnchor="start">
              {formatUsd(maxDeposits)}
            </text>

            {data.map((d, i) => {
              const barHeight = maxSignups > 0 ? (d.signups / maxSignups) * COMBO_PLOT_H : 0;
              const x = xCenter(i) - barWidth / 2;
              const y = COMBO_PADDING.top + COMBO_PLOT_H - barHeight;
              return (
                <rect
                  key={d.date}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(barHeight, 1)}
                  rx={Math.min(2, barWidth / 2)}
                  fill={hoverIndex === i ? "var(--teal-deep)" : "var(--teal-base)"}
                />
              );
            })}

            <path d={linePath} fill="none" stroke="var(--gain)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

            {hovered && (
              <>
                <line
                  x1={xCenter(hoverIndex)}
                  x2={xCenter(hoverIndex)}
                  y1={COMBO_PADDING.top}
                  y2={COMBO_PADDING.top + COMBO_PLOT_H}
                  stroke="var(--ink-soft)"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />
                <circle cx={xCenter(hoverIndex)} cy={yDeposits(hovered.depositsAmount)} r={4} fill="var(--gain)" stroke="var(--cream-deep)" strokeWidth={2} />
              </>
            )}

            {[0, Math.floor((data.length - 1) / 2), data.length - 1].map((i, idx) => (
              <text
                key={idx}
                x={xCenter(i)}
                y={COMBO_VIEW_HEIGHT - 4}
                fontSize={8}
                fontFamily="var(--font-data)"
                fill="var(--ink-soft)"
                textAnchor={idx === 0 ? "start" : idx === 2 ? "end" : "middle"}
              >
                {formatDateLabel(data[i].date)}
              </text>
            ))}
          </svg>

          {hovered && (
            <FloatingTooltip
              leftPercent={((hoverIndex + 0.5) / data.length) * 100}
              dateLabel={formatDateLabel(hovered.date)}
              lines={[
                { text: t("admin.overview.tooltipSignupsOnly", { count: hovered.signups }), color: "var(--teal-sage)" },
                { text: formatUsd(hovered.depositsAmount), color: "var(--gain-on-dark)" },
              ]}
            />
          )}
        </div>
      )}
    </div>
  );
}

function LegendItem({ shape, color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
      {shape === "square" ? (
        <span style={{ width: 9, height: 9, borderRadius: 2, background: color }} />
      ) : (
        <span style={{ width: 12, height: 2, borderRadius: 1, background: color }} />
      )}
      <span style={{ fontFamily: "var(--font-body)", fontSize: "10.5px", color: "var(--ink-soft)" }}>{label}</span>
    </div>
  );
}
