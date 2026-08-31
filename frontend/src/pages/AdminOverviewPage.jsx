// The admin landing dashboard — "how's the platform doing right now."
// Backed entirely by GET /admin/overview (admin_overview_service.py on the
// backend), which returns today's signup/deposit snapshot plus a full
// day-by-day history from the very first signup or deposit through today.
// This page never re-fetches per range change below — the whole `daily`
// array comes down in one call and every view (calendar, bar chart, line
// chart) just slices or re-buckets that same array client-side, since a
// personal-project's whole history is tiny by web-app standards.
//
// Every chart on this page is hand-rolled inline SVG rather than a charting
// library (lightweight-charts, already a dependency, is built for
// candlesticks specifically — see LiveChart.jsx). Plain SVG can read this
// app's CSS custom properties directly via `fill`/`stroke` attributes (a
// <canvas>-based chart can't, which is why LiveChart.jsx has to keep a
// literal hex mirror of index.css) — so every color below is a `var(--...)`
// token, never a hardcoded hex, per this project's own design-system rule.
// Two single-series charts (bars = signups/day, line = deposits $/day) were
// chosen deliberately over one combined chart: signup counts and deposit
// dollar amounts live on completely different scales, and a dual-axis chart
// is exactly the mistake to avoid (see the dataviz skill's "one axis" rule)
// — two separate, single-axis charts is the correct read here, and happens
// to be literally "a line and a bar graph," which is what was asked for.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "../context/AdminAuthContext";
import AdminNav from "../components/AdminNav";
import AnimatedPsi from "../components/AnimatedPsi";
import { getAdminOverview } from "../lib/api";

// The 4 pills under the two charts — "all" always shows the FULL `daily`
// array (whatever that spans), the other three take the last N calendar
// days off the end of it. Add a row here (e.g. "180d") to offer another
// fixed window; nothing else on this page needs to change.
const RANGE_OPTIONS = [
  { value: "30d", label: "30D", days: 30 },
  { value: "90d", label: "90D", days: 90 },
  { value: "180d", label: "180D", days: 180 },
  { value: "all", label: "ALL", days: null },
];

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
  // triggers a second network call.
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

        <ActivityCalendar daily={overview.daily} t={t} />

        <RangePills selected={range} onSelect={setRange} />

        <DailyBarChart
          data={windowedDaily.map((d) => ({ date: d.date, value: d.signups }))}
          color="var(--teal-base)"
          activeColor="var(--teal-deep)"
          title={t("admin.overview.signupsChartTitle")}
          t={t}
        />

        <DailyLineChart
          data={windowedDaily.map((d) => ({ date: d.date, value: Number(d.deposits_amount) }))}
          color="var(--gain)"
          title={t("admin.overview.depositsChartTitle")}
          formatValue={formatUsd}
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

// ── Floating tooltip shared by the calendar and both charts below — plain
// absolute positioning against whichever container passes a leftPercent /
// topPx, never attached to the mouse itself (that would fight with
// pointer-events on the SVG underneath it). pointerEvents: "none" is what
// lets mouse events pass straight through to the chart/cell underneath. ────
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
        <div key={line} style={{ fontWeight: 600 }}>{line}</div>
      ))}
    </div>
  );
}

// ── Activity calendar — a GitHub-contributions-style heatmap covering every
// day in `daily` (i.e. the platform's entire history), one cell per UTC
// calendar day, columns = weeks, rows = Sun..Sat. Color intensity is a
// SEQUENTIAL encoding (one hue, light -> dark = low -> high activity) built
// from this app's existing 4 teal tokens via color-mix rather than any new
// hex value — see index.css's own --focus-ring for the same "derive a tint
// from an existing token with color-mix" technique already used elsewhere
// in this codebase. ──────────────────────────────────────────────────────
const CELL_SIZE = 12;
const CELL_GAP = 3;

// Level 0 is always "no activity that day" (a flat cream tint, not part of
// the teal ramp at all — activity vs none needs to read as a hue change,
// not just "very light teal" vs "slightly less light teal"). Levels 1-4 are
// an activity day's intensity relative to the busiest day in the whole
// history (see ActivityCalendar's maxActivity below) — a color-mix wash of
// --teal-base over --cream-deep at increasing strength, so this never needs
// updating if the teal brand color itself ever changes.
const LEVEL_COLORS = [
  "var(--cream-deep)",
  "color-mix(in srgb, var(--teal-base) 25%, var(--cream-deep))",
  "color-mix(in srgb, var(--teal-base) 50%, var(--cream-deep))",
  "color-mix(in srgb, var(--teal-base) 75%, var(--cream-deep))",
  "var(--teal-base)",
];

function ActivityCalendar({ daily, t }) {
  const [hovered, setHovered] = useState(null); // { col, row, entry } | null

  if (daily.length === 0) {
    return null;
  }

  // Build a lookup so cells outside `daily`'s actual span (the padding days
  // used to align the grid to full weeks, see below) resolve to a flat
  // zero-activity entry rather than needing a special-cased render path —
  // "no data yet" and "zero activity that day" are visually identical here,
  // which is correct: both mean nothing happened.
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const zero = { signups: 0, deposits_count: 0, deposits_amount: "0.00" };

  const earliest = new Date(`${daily[0].date}T00:00:00Z`);
  const latest = new Date(`${daily[daily.length - 1].date}T00:00:00Z`);
  // Widen to the Sunday on/before `earliest` and the Saturday on/after
  // `latest`, so the grid always renders complete weeks (7 rows) — a
  // partial first/last column would misalign every day-of-week row label.
  const gridStart = new Date(earliest);
  gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay());
  const gridEnd = new Date(latest);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - gridEnd.getUTCDay()));

  const totalDays = Math.round((gridEnd - gridStart) / (24 * 60 * 60 * 1000)) + 1;
  const columnCount = Math.ceil(totalDays / 7);

  // activity = signups + deposits_count for a day — a single combined
  // magnitude so ONE color ramp can represent "how busy was this day"
  // rather than needing two overlapping heatmaps. The exact split (how
  // many were signups vs deposits) is what the hover tooltip is for.
  const maxActivity = Math.max(1, ...daily.map((d) => d.signups + d.deposits_count));

  function levelFor(activity) {
    if (activity === 0) return 0;
    return clamp(Math.ceil((activity / maxActivity) * 4), 1, 4);
  }

  // Cells laid out column-major (week by week) to match the grid's visual
  // reading order — each column is 7 cells (Sun..Sat) stacked top to
  // bottom, columns proceeding left to right through time.
  const cells = [];
  for (let col = 0; col < columnCount; col++) {
    for (let row = 0; row < 7; row++) {
      const cellDate = new Date(gridStart);
      cellDate.setUTCDate(cellDate.getUTCDate() + col * 7 + row);
      const dateStr = cellDate.toISOString().slice(0, 10);
      const entry = byDate.get(dateStr) || zero;
      cells.push({ col, row, dateStr, entry });
    }
  }

  const width = columnCount * (CELL_SIZE + CELL_GAP) - CELL_GAP;
  const height = 7 * (CELL_SIZE + CELL_GAP) - CELL_GAP;

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
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", color: "var(--ink-base)" }}>
        {t("admin.overview.calendarTitle")}
      </span>

      {/* overflow-x: auto rather than shrinking cells to fit — a long
          history should scroll horizontally, same responsive rule applied
          to every wide table/chart elsewhere in this codebase, rather than
          squeezing cells down to illegibility. */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ position: "relative", width, height }}>
          {cells.map(({ col, row, dateStr, entry }) => {
            const activity = entry.signups + entry.deposits_count;
            const level = levelFor(activity);
            const isHovered = hovered?.col === col && hovered?.row === row;
            return (
              <div
                key={dateStr}
                onMouseEnter={() => setHovered({ col, row, dateStr, entry })}
                onMouseLeave={() => setHovered(null)}
                style={{
                  position: "absolute",
                  left: col * (CELL_SIZE + CELL_GAP),
                  top: row * (CELL_SIZE + CELL_GAP),
                  width: CELL_SIZE,
                  height: CELL_SIZE,
                  borderRadius: 3,
                  background: LEVEL_COLORS[level],
                  outline: isHovered ? "1.5px solid var(--teal-deep)" : "none",
                  outlineOffset: 1,
                  cursor: "default",
                }}
              />
            );
          })}

          {hovered && (
            <div
              style={{
                position: "absolute",
                left: hovered.col * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2,
                top: hovered.row * (CELL_SIZE + CELL_GAP),
              }}
            >
              <FloatingTooltip
                leftPercent={50}
                dateLabel={formatDateLabel(hovered.dateStr)}
                lines={[
                  t("admin.overview.tooltipSignups", { count: hovered.entry.signups }),
                  t("admin.overview.tooltipDeposits", {
                    count: hovered.entry.deposits_count,
                    amount: formatUsd(hovered.entry.deposits_amount),
                  }),
                ]}
              />
            </div>
          )}
        </div>
      </div>

      {/* Legend — "Less" -> "More" over the same 5 swatches used above, the
          standard GitHub-contributions-graph convention, so the color scale
          is explained without needing a hover on every cell to understand
          it. */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", alignSelf: "flex-end" }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: "9.5px", color: "var(--ink-soft)" }}>
          {t("admin.overview.calendarLess")}
        </span>
        {LEVEL_COLORS.map((color, i) => (
          <div key={i} style={{ width: CELL_SIZE - 2, height: CELL_SIZE - 2, borderRadius: 3, background: color }} />
        ))}
        <span style={{ fontFamily: "var(--font-body)", fontSize: "9.5px", color: "var(--ink-soft)" }}>
          {t("admin.overview.calendarMore")}
        </span>
      </div>
    </div>
  );
}

// ── Shared chart chrome (title card + empty state) — both chart types
// below render into this same wrapper so their card styling never drifts
// out of sync with each other. ──────────────────────────────────────────
function ChartCard({ title, empty, t, children }) {
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
        {title}
      </span>
      {empty ? (
        <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)" }}>
          {t("admin.overview.noData")}
        </span>
      ) : (
        children
      )}
    </div>
  );
}

// Fixed viewBox close to this page's actual rendered card width (max-w-sm
// minus the card's own padding) so SVG units scale roughly 1:1 to real
// pixels — keeps the hover marker/stroke sizes below reading as the
// intended size instead of shrinking away under a much wider viewBox.
const CHART_VIEW_WIDTH = 320;
const CHART_VIEW_HEIGHT = 140;
const CHART_PADDING = { top: 8, right: 4, bottom: 18, left: 4 };
const CHART_PLOT_W = CHART_VIEW_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
const CHART_PLOT_H = CHART_VIEW_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

// Recessive horizontal gridlines at 25/50/75/100% of the plot height —
// present but never competing with the actual data marks, per the dataviz
// skill's "recessive grid/axes" rule.
function ChartGridlines() {
  return (
    <>
      {[0.25, 0.5, 0.75, 1].map((frac) => {
        const y = CHART_PADDING.top + CHART_PLOT_H * (1 - frac);
        return (
          <line
            key={frac}
            x1={CHART_PADDING.left}
            x2={CHART_VIEW_WIDTH - CHART_PADDING.right}
            y1={y}
            y2={y}
            stroke="var(--cream-line)"
            strokeWidth={1}
          />
        );
      })}
    </>
  );
}

// Three x-axis date labels (start / middle / end) rather than one per bar —
// with up to 180 bars in view, a label per bar would be unreadable overlap;
// three anchor points is enough to orient the eye to the time window.
function ChartXAxisLabels({ data }) {
  if (data.length === 0) return null;
  const indices = data.length === 1 ? [0] : [0, Math.floor((data.length - 1) / 2), data.length - 1];
  return (
    <>
      {indices.map((i) => {
        const frac = data.length === 1 ? 0.5 : i / (data.length - 1);
        const x = CHART_PADDING.left + frac * CHART_PLOT_W;
        const anchor = i === 0 ? "start" : i === data.length - 1 ? "end" : "middle";
        return (
          <text
            key={i}
            x={x}
            y={CHART_VIEW_HEIGHT - 4}
            fontSize={8}
            fontFamily="var(--font-data)"
            fill="var(--ink-soft)"
            textAnchor={anchor}
          >
            {formatDateLabel(data[i].date)}
          </text>
        );
      })}
    </>
  );
}

// ── Bar chart — daily signups. Single series, one hue (--teal-base), the
// hovered bar picked out in --teal-deep — per the dataviz skill, a single
// series needs no legend (the card title already names it). Bar tops get a
// small border-radius and there's a fixed gap between bars, per the skill's
// mark spec for bars (rounded data-ends, a surface gap between adjacent
// marks). ────────────────────────────────────────────────────────────────
function DailyBarChart({ data, color, activeColor, title, t }) {
  const containerRef = useRef(null);
  const [hoverIndex, setHoverIndex] = useState(null);

  const maxVal = Math.max(1, ...data.map((d) => d.value));
  const barGap = data.length > 40 ? 1 : 2; // denser windows (90D/ALL) need a thinner gap to stay legible
  const slotWidth = data.length > 0 ? CHART_PLOT_W / data.length : 0;
  const barWidth = Math.max(1, slotWidth - barGap);

  function handleMove(e) {
    if (!containerRef.current || data.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    setHoverIndex(clamp(Math.floor(relX * data.length), 0, data.length - 1));
  }

  return (
    <ChartCard title={title} empty={data.length === 0} t={t}>
      <div ref={containerRef} style={{ position: "relative" }} onMouseMove={handleMove} onMouseLeave={() => setHoverIndex(null)}>
        <svg
          viewBox={`0 0 ${CHART_VIEW_WIDTH} ${CHART_VIEW_HEIGHT}`}
          style={{ width: "100%", height: CHART_VIEW_HEIGHT, display: "block" }}
          preserveAspectRatio="none"
        >
          <ChartGridlines />
          {data.map((d, i) => {
            const barHeight = maxVal > 0 ? (d.value / maxVal) * CHART_PLOT_H : 0;
            const x = CHART_PADDING.left + i * slotWidth + barGap / 2;
            const y = CHART_PADDING.top + CHART_PLOT_H - barHeight;
            return (
              <rect
                key={d.date}
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, 1)}
                rx={Math.min(2, barWidth / 2)}
                fill={hoverIndex === i ? activeColor : color}
              />
            );
          })}
          <ChartXAxisLabels data={data} />
        </svg>
        {hoverIndex !== null && data[hoverIndex] && (
          <FloatingTooltip
            leftPercent={((hoverIndex + 0.5) / data.length) * 100}
            dateLabel={formatDateLabel(data[hoverIndex].date)}
            lines={[t("admin.overview.tooltipSignupsOnly", { count: data[hoverIndex].value })]}
          />
        )}
      </div>
    </ChartCard>
  );
}

// ── Line chart — daily deposit $ amount. Single series (--gain, this
// codebase's existing "money moving in a positive direction" token — see
// STATUS_COLOR in WithdrawPage.jsx / AdminWithdrawalsQueuePage.jsx for the
// same color already meaning exactly this elsewhere in the app), 2px
// stroke, a crosshair + single dot on hover rather than a marker on every
// point (which would be visual noise at 90-180 points). ─────────────────
function DailyLineChart({ data, color, title, formatValue, t }) {
  const containerRef = useRef(null);
  const [hoverIndex, setHoverIndex] = useState(null);

  const values = data.map((d) => d.value);
  const maxVal = Math.max(1, ...values);
  const minVal = Math.min(0, ...values);
  const range = maxVal - minVal || 1;

  function xAt(i) {
    return CHART_PADDING.left + (data.length > 1 ? (i / (data.length - 1)) * CHART_PLOT_W : CHART_PLOT_W / 2);
  }
  function yAt(v) {
    return CHART_PADDING.top + CHART_PLOT_H - ((v - minVal) / range) * CHART_PLOT_H;
  }

  const pathD = data.map((d, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(d.value).toFixed(1)}`).join(" ");

  function handleMove(e) {
    if (!containerRef.current || data.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const idx = data.length > 1 ? Math.round(relX * (data.length - 1)) : 0;
    setHoverIndex(clamp(idx, 0, data.length - 1));
  }

  return (
    <ChartCard title={title} empty={data.length === 0} t={t}>
      <div ref={containerRef} style={{ position: "relative" }} onMouseMove={handleMove} onMouseLeave={() => setHoverIndex(null)}>
        <svg
          viewBox={`0 0 ${CHART_VIEW_WIDTH} ${CHART_VIEW_HEIGHT}`}
          style={{ width: "100%", height: CHART_VIEW_HEIGHT, display: "block" }}
          preserveAspectRatio="none"
        >
          <ChartGridlines />
          <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hoverIndex !== null && data[hoverIndex] && (
            <>
              <line
                x1={xAt(hoverIndex)}
                x2={xAt(hoverIndex)}
                y1={CHART_PADDING.top}
                y2={CHART_PADDING.top + CHART_PLOT_H}
                stroke="var(--ink-soft)"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
              <circle cx={xAt(hoverIndex)} cy={yAt(data[hoverIndex].value)} r={4} fill={color} stroke="var(--cream-deep)" strokeWidth={2} />
            </>
          )}
          <ChartXAxisLabels data={data} />
        </svg>
        {hoverIndex !== null && data[hoverIndex] && (
          <FloatingTooltip
            leftPercent={(xAt(hoverIndex) / CHART_VIEW_WIDTH) * 100}
            dateLabel={formatDateLabel(data[hoverIndex].date)}
            lines={[formatValue(data[hoverIndex].value)]}
          />
        )}
      </div>
    </ChartCard>
  );
}
