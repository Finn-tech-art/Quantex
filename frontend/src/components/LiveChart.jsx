// Shared candlestick chart with BUY/SELL markers and an optional volume
// pane — used by both FakeSessionPage.jsx (the 10-minute streaming demo)
// and BotDetailPage.jsx (a persistent real/simulated bot's activity page).
//
// Originally lived only inside FakeSessionPage.jsx, keyed off
// simulated_offset_seconds (a demo-only concept: seconds since the fake
// session started). Extracted here and re-keyed off each candle/fill's real
// epoch `time` / `created_at` instead — both the demo's candles and a real
// bot's candles/fills already carry genuine epoch timestamps (see
// fake_trading_service.py and bot_chart_service.py, which share one candle
// shape), so this needed no demo-only fields to begin with.
//
// `revealUpToTime` (Unix seconds, optional) is what makes the demo's
// streaming playback work: pass a value that increases over time (e.g.
// candles[0].time + simTime) and only candles/fills at or before it are
// drawn, so the chart fills in left-to-right. Omit it (BotDetailPage's use)
// to just show everything available — there's no "playback" for a
// persistent bot, only "here's the real history so far".
//
// Volume: a candle's `volume` field is only ever present when it came from
// bot_chart_service.py (a real bot's actual Binance kline data) — the
// demo's synthetic candles (fake_trading_service.py) have no real volume
// concept behind their scripted price path and never include the field.
// This component checks the FIRST candle once to decide whether to draw
// the volume pane at all, rather than defaulting a missing value to 0 (which
// would draw a flat, meaningless empty bar for the demo instead of just
// not drawing one).
//
// Colors: lightweight-charts renders to a <canvas>, which can't read CSS
// custom properties — every color it needs has to be a literal string
// handed to it in JS. CHART_COLORS below is that literal mirror of
// index.css's light/dark token values (kept in sync by hand — there's no
// way to derive one from the other across the CSS/canvas boundary). Which
// half applies is read from ThemeContext and pushed into the already-built
// chart via a dedicated effect below, separate from the chart's initial
// creation, so toggling dark mode re-colors the chart in place rather than
// tearing it down and losing the viewer's current zoom/pan.

import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, HistogramSeries, createSeriesMarkers } from "lightweight-charts";
import { useTheme } from "../context/ThemeContext";

const CHART_COLORS = {
  light: {
    text: "#6B6357", // var(--ink-soft)
    grid: "#F0E9D8", // faint tint of var(--cream-line)
    up: "#1FA968", // var(--gain)
    down: "#AE5A3E", // var(--loss)
    volumeUp: "rgba(31, 169, 104, 0.5)",
    volumeDown: "rgba(174, 90, 62, 0.5)",
  },
  dark: {
    text: "#A69C89", // var(--ink-soft), dark
    grid: "#332E22", // var(--cream-line), dark
    up: "#1FA968", // var(--gain) — deliberately unchanged in dark mode, see index.css's dark block
    down: "#D97B5C", // var(--loss), dark — brightened there for contrast on a dark surface, same value here
    volumeUp: "rgba(31, 169, 104, 0.5)",
    volumeDown: "rgba(217, 123, 92, 0.5)",
  },
};

function fillEpochSeconds(fill) {
  return Math.floor(new Date(fill.created_at).getTime() / 1000);
}

export default function LiveChart({ allCandles, fills, revealUpToTime, chartId, height = 220 }) {
  const { theme } = useTheme();
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const markersPluginRef = useRef(null);
  // Whether THIS candle set carries real volume — decided once per data
  // load (see the module comment above), not per-candle.
  const hasVolumeRef = useRef(false);

  // Initialize chart once per `chartId` (BotDetailPage passes its botId;
  // FakeSessionPage passes its sessionDetail.id) rather than once per
  // `allCandles` — allCandles is a NEW array reference on every poll/fill
  // refresh (BotDetailPage rebuilds it via toChartCandles() on every
  // render), so keying this on allCandles itself was tearing the whole
  // chart down and calling fitContent() below on every single data
  // refresh, which is what was resetting a viewer's zoom/pan every ~15s.
  // Keying on chartId instead means this only reruns when you're actually
  // looking at a different bot/session; the effect further down (which
  // depends on allCandles) already handles in-place data updates via
  // setData() without touching zoom at all.
  useEffect(() => {
    if (!chartContainerRef.current || !allCandles || allCandles.length === 0) return;

    const colors = CHART_COLORS[theme] || CHART_COLORS.light;
    hasVolumeRef.current = allCandles[0]?.volume != null;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: "solid", color: "transparent" },
        textColor: colors.text,
        fontSize: 10,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: colors.grid } },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderVisible: false,
        tickMarkMaxCharacterLength: 5,
      },
      localization: {
        timeFormatter: (time) =>
          new Date(time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" }) + " UTC",
      },
      rightPriceScale: { borderVisible: false },
    });

    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: colors.up,
      downColor: colors.down,
      borderVisible: false,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    seriesRef.current = series;

    if (hasVolumeRef.current) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
        lastValueVisible: false,
        priceLineVisible: false,
      });
      // Confines the volume series to its own scale, squeezed into the
      // bottom ~18% of the pane — the standard lightweight-charts technique
      // for an overlay volume strip under the main price series, rather
      // than a second full-height chart. Raise `top` to shrink the strip
      // further, lower it for a taller one.
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volumeSeriesRef.current = volumeSeries;
    } else {
      volumeSeriesRef.current = null;
    }

    markersPluginRef.current = createSeriesMarkers(series, []);

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
    // theme intentionally excluded — the dedicated effect below re-colors
    // an already-built chart in place instead of re-running this one.
    // allCandles is ALSO intentionally excluded now — see this effect's
    // module comment above for why keying on chartId instead is the fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartId]);

  // Re-colors the chart in place when the theme toggles, without rebuilding
  // it (which would discard the viewer's current zoom/pan position).
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return;
    const colors = CHART_COLORS[theme] || CHART_COLORS.light;

    chartRef.current.applyOptions({
      layout: { textColor: colors.text },
      grid: { horzLines: { color: colors.grid } },
    });
    seriesRef.current.applyOptions({
      upColor: colors.up,
      downColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
    });
    // Volume bar colors are per-candle (win/loss tinted) and get
    // recomputed from allCandles by the data effect below on every
    // dependency change — theme isn't one of those dependencies, so
    // volume bars only pick up a theme change on the NEXT data update.
    // Acceptable: the two dark-mode volume tints are close enough in hue
    // to the light ones that a stale color for one tick isn't jarring, and
    // this avoids re-deriving the full visible-candle set here just to
    // repaint bars that are about to repaint anyway on the next tick.
  }, [theme]);

  // Update visible data + markers whenever the reveal point or fills change.
  useEffect(() => {
    if (!seriesRef.current || !allCandles) return;
    const colors = CHART_COLORS[theme] || CHART_COLORS.light;

    const visibleCandles =
      revealUpToTime == null ? allCandles : allCandles.filter((c) => c.time <= revealUpToTime);
    if (visibleCandles.length === 0) return;

    seriesRef.current.setData(
      visibleCandles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }))
    );

    if (volumeSeriesRef.current && hasVolumeRef.current) {
      volumeSeriesRef.current.setData(
        visibleCandles.map((c) => ({
          time: c.time,
          value: Number(c.volume),
          color: c.close >= c.open ? colors.volumeUp : colors.volumeDown,
        }))
      );
    }

    const visibleFills = (fills || []).filter(
      (f) => (f.side === "BUY" || f.side === "SELL") && (revealUpToTime == null || fillEpochSeconds(f) <= revealUpToTime)
    );

    // Lightweight Charts requires unique marker times — multiple fills can
    // land in the same 1-minute candle, so dedupe by candle time exactly
    // like the original demo implementation did.
    const markerMap = new Map();
    visibleFills.forEach((f) => {
      const fillTime = fillEpochSeconds(f);
      const c = visibleCandles.slice().reverse().find((c) => c.time <= fillTime);
      if (c) {
        markerMap.set(c.time, {
          time: c.time,
          position: f.side === "BUY" ? "belowBar" : "aboveBar",
          color: f.side === "BUY" ? colors.up : colors.down,
          shape: f.side === "BUY" ? "arrowUp" : "arrowDown",
          text: f.side,
          size: 0.5,
        });
      }
    });

    const markers = Array.from(markerMap.values());
    markers.sort((a, b) => a.time - b.time);

    if (markersPluginRef.current) {
      try {
        markersPluginRef.current.setMarkers(markers);
      } catch (err) {
        console.error("Failed to set markers:", err);
      }
    }
    // theme read here only for volume-bar coloring on a real data update —
    // not a reason to re-run this effect on its own (see the effect above,
    // which already handles a pure theme toggle).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealUpToTime, fills, allCandles]);

  return (
    <div
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-4)",
        height,
        position: "relative",
      }}
    >
      <div ref={chartContainerRef} style={{ width: "100%", height: "100%" }} />
      <span
        style={{
          position: "absolute",
          top: 8,
          right: 12,
          fontFamily: "var(--font-data)",
          fontSize: "8.5px",
          letterSpacing: "0.05em",
          color: "var(--ink-soft)",
          background: "var(--cream-deep)",
          padding: "1px 5px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--cream-line)",
        }}
      >
        UTC
      </span>
    </div>
  );
}
