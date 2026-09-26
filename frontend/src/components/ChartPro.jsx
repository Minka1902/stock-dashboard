import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart, CandlestickSeries, BarSeries, HistogramSeries, LineSeries,
  AreaSeries, BaselineSeries, LineStyle, PriceScaleMode, createSeriesMarkers,
} from "lightweight-charts";
import { AnimatePresence, motion } from "motion/react";
import { getChart } from "../api";
import {
  smaSeries, emaSeries, bollingerSeries, rsiSeries, macdSeries, vwapSeries,
  heikinAshi,
} from "../lib/indicators";
import { prefersReducedMotion } from "../lib/motionConfig";
import { useDrawings } from "../lib/drawings/useDrawings";
import { useThemeColors, withAlpha } from "../lib/themeColors";
import styles from "./ChartPro.module.css";

// lightweight-charts renders to canvas and cannot parse oklch(), so the chart
// colours come from the --chart-* tokens in index.css resolved to rgb() by
// useThemeColors — and re-resolved whenever the app theme changes.
const CHART_TOKENS = {
  text: "--chart-text",
  grid: "--chart-grid",
  border: "--chart-border",
  crosshair: "--chart-crosshair",
  up: "--chart-up",           // positive
  down: "--chart-down",       // negative
  accent: "--chart-accent",
  info: "--chart-info",
  muted: "--chart-muted",
  compare: "--chart-compare", // SPY overlay / VWAP, distinct from every indicator
  labelBg: "--surface-3",     // crosshair axis-label background
};

// User drawings (lib/drawings) — same resolution, separate roles.
const DRAW_TOKENS = {
  stroke: "--draw-stroke",
  selected: "--draw-selected",
  fill: "--draw-fill",
  label: "--draw-label",
};

const TIMEFRAMES = [
  { key: "1m", label: "1m" }, { key: "5m", label: "5m" }, { key: "15m", label: "15m" },
  { key: "1h", label: "1h" }, { key: "1d", label: "D" }, { key: "1wk", label: "W" },
  { key: "1mo", label: "M" },
];
const INTRADAY = new Set(["1m", "5m", "15m", "1h"]);
const INTRADAY_REFRESH_MS = 30000;

const CHART_TYPES = [
  { key: "candles", label: "Candles" },
  { key: "hollow", label: "Hollow" },
  { key: "heikin", label: "Heikin-Ashi" },
  { key: "bars", label: "Bars" },
  { key: "line", label: "Line" },
  { key: "area", label: "Area" },
  { key: "baseline", label: "Baseline" },
];

// Compact per-type glyphs for the chart-type segmented control (18x18,
// currentColor). Filled marks use `fill`, outlines use `stroke`.
const TYPE_ICONS = {
  candles: (
    <g fill="currentColor" stroke="currentColor" strokeWidth="1.3">
      <line x1="5.5" y1="2.5" x2="5.5" y2="15.5" /><rect x="3.5" y="5" width="4" height="6.5" />
      <line x1="12.5" y1="4" x2="12.5" y2="14" /><rect x="10.5" y="7" width="4" height="5" />
    </g>
  ),
  hollow: (
    <g fill="none" stroke="currentColor" strokeWidth="1.3">
      <line x1="5.5" y1="2.5" x2="5.5" y2="15.5" /><rect x="3.5" y="5" width="4" height="6.5" />
      <line x1="12.5" y1="4" x2="12.5" y2="14" /><rect x="10.5" y="7" width="4" height="5" />
    </g>
  ),
  heikin: (
    <g stroke="currentColor" strokeWidth="1.3">
      <line x1="9" y1="2" x2="9" y2="16" fill="none" />
      <rect x="5.5" y="5.5" width="7" height="6" fill="currentColor" />
    </g>
  ),
  bars: (
    <g fill="none" stroke="currentColor" strokeWidth="1.3">
      <line x1="5.5" y1="3" x2="5.5" y2="15" /><line x1="2.5" y1="6" x2="5.5" y2="6" /><line x1="5.5" y1="11" x2="8.5" y2="11" />
      <line x1="12.5" y1="4" x2="12.5" y2="14" /><line x1="9.5" y1="9" x2="12.5" y2="9" /><line x1="12.5" y1="12" x2="15.5" y2="12" />
    </g>
  ),
  line: (
    <polyline points="2,13 6,8 9,11 16,4" fill="none" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  ),
  area: (
    <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 13 L6 8 L9 11 L16 4 L16 16 L2 16 Z" fill="currentColor" fillOpacity="0.25" stroke="none" />
      <polyline points="2,13 6,8 9,11 16,4" fill="none" />
    </g>
  ),
  baseline: (
    <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="9" x2="16" y2="9" strokeDasharray="2 2" strokeWidth="1" opacity="0.6" />
      <polyline points="2,12 6,10 9,6 16,4" fill="none" />
    </g>
  ),
};

function TypeIcon({ type }) {
  return (
    <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true">
      {TYPE_ICONS[type]}
    </svg>
  );
}

const MA_DEFS = [
  { n: 20, key: "info" }, { n: 50, key: "accent" },
  { n: 150, key: "muted" }, { n: 200, key: "down" },
];
const EMA_DEFS = [{ n: 9, key: "up" }, { n: 21, key: "compare" }];

const IND_DEFS = [
  { key: "ma", label: "SMA 20/50/150/200" },
  { key: "ema", label: "EMA 9/21" },
  { key: "bb", label: "Bollinger (20,2)" },
  { key: "vwap", label: "VWAP", intradayOnly: true },
  { key: "vol", label: "Volume" },
  { key: "rsi", label: "RSI (14)" },
  { key: "macd", label: "MACD (12,26,9)" },
];

const DEFAULT_PREFS = {
  tf: "1d",
  type: "candles",
  inds: { ma: true, ema: false, bb: false, vwap: false, vol: true, rsi: false, macd: false },
  logScale: false,
  compare: false,
  overlays: true,
  prepost: false,
};

const PREFS_KEY = "chartProPrefs";

// Drawing tools. Glyphs rather than icons so the toolbar keeps one visual
// language with the existing LOG / PLAN pills.
const DRAW_TOOLS = [
  { key: "trendline", glyph: "╱", title: "Trendline — click two points" },
  { key: "ray", glyph: "―", title: "Horizontal level — click once" },
  { key: "zone", glyph: "▭", title: "Zone — click two corners" },
  { key: "text", glyph: "T", title: "Text label — click to place" },
];

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return { ...DEFAULT_PREFS, ...raw, inds: { ...DEFAULT_PREFS.inds, ...(raw.inds || {}) } };
  } catch {
    return DEFAULT_PREFS;
  }
}

/**
 * The chart-level (not per-series) options that depend on the theme. Applied
 * with chart.applyOptions right after creation and again on every theme
 * change, so the chart — and the user's zoom/pan — survives switching themes.
 */
function chartThemeOptions(c) {
  const line = { color: c.crosshair, labelBackgroundColor: c.labelBg };
  return {
    layout: { textColor: c.text, panes: { separatorColor: c.border } },
    grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
    rightPriceScale: { borderColor: c.border },
    timeScale: { borderColor: c.border },
    crosshair: { vertLine: line, horzLine: line },
  };
}

function monoFont() {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--mono").trim();
  return v || "monospace";
}

function fmt(v, digits = 2) {
  return v == null ? "—" : Number(v).toFixed(digits);
}

function fmtVol(v) {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

// Sub-pane heights in px. Deliberately compact: the indicators are a glance
// check, not the subject — every pixel here comes out of the price pane, which
// is capped by the viewport clamp below.
const PANE_HEIGHTS = { vol: 56, rsi: 64, macd: 72 };

// IPaneApi.priceScale() throws when the id isn't present on that pane, which
// can happen transiently while series are being rebuilt. Callers just want to
// skip the pane in that case.
function rightScaleOf(pane) {
  try {
    return pane.priceScale("right");
  } catch {
    return null;
  }
}

/**
 * Pro chart workspace (TradingView lightweight-charts v5): chart types,
 * intraday-to-monthly timeframes, indicator menu with RSI/MACD sub-panes,
 * log scale, SPY comparison, crosshair OHLCV legend, and the analysis
 * overlays (S/R, entry/stop/target, pattern markers) on the daily view.
 * Preferences persist in localStorage.
 */
export default function ChartPro({ ticker, analysis = null, height = 460 }) {
  const elRef = useRef(null);
  // rgb() strings for the current theme; a new object on every theme change.
  const colors = useThemeColors(CHART_TOKENS);
  const drawColors = useThemeColors(DRAW_TOKENS);
  // Read by the series rebuild and the crosshair legend, so a theme change
  // doesn't have to re-run either of them.
  const colorsRef = useRef(colors);
  const recolorRef = useRef([]);       // (colors) => void, one per themed object
  const [prefs, setPrefs] = useState(loadPrefs);
  // Viewport-aware chart height: fill the space below the toolbar/legend down
  // to the bottom of the viewport, clamped to [280, `height`] so the chart +
  // toolbar + legend fit one screen without page scroll (Task 9).
  const [chartHeight, setChartHeight] = useState(height);
  const [bars, setBars] = useState(null);      // null = loading, [] = no data
  const [compareBars, setCompareBars] = useState(null);
  const [error, setError] = useState(null);
  const [legend, setLegend] = useState(null);
  // Brief overlay shown while a toolbar change re-renders the chart (Task 5).
  const [updating, setUpdating] = useState(false);

  // Persistent chart handles: the chart is created once (see the mount effect)
  // and only its *series* are torn down/rebuilt on data/indicator changes, so
  // the user's zoom/pan (visible logical range) survives toolbar interactions.
  const chartRef = useRef(null);
  const seriesRef = useRef([]);        // every removable series (main + overlays + panes)
  const overlayRef = useRef([]);       // {series,label,color} for the crosshair legend
  const datasetKeyRef = useRef(null);  // `${ticker}|${tf}` — only refit when this changes
  const prevBarsRef = useRef(null);    // identity check: did the bar data actually change?
  const legendMapsRef = useRef({ bars: [], byTime: new Map(), idx: new Map() });
  // The price series drawings anchor to, plus a counter that changes whenever
  // it is rebuilt so the drawing primitive can re-attach.
  const mainSeriesRef = useRef(null);
  const [seriesEpoch, setSeriesEpoch] = useState(0);

  const setPref = useCallback((patch) => {
    setUpdating(true); // show the loader for the duration of the change (Task 5)
    setPrefs((p) => {
      const next = { ...p, ...patch, inds: { ...p.inds, ...(patch.inds || {}) } };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);

  // The series rebuild is synchronous, so hold the loader a beat after a pref
  // change so the transition is perceptible rather than a jarring instant swap.
  useEffect(() => {
    if (!updating) return undefined;
    const id = setTimeout(() => setUpdating(false), 320);
    return () => clearTimeout(id);
  }, [updating]);

  const intraday = INTRADAY.has(prefs.tf);

  // ---- data: bars for the active timeframe (auto-refresh while intraday) ----
  const loadBars = useCallback(async () => {
    try {
      const data = await getChart(ticker, prefs.tf, INTRADAY.has(prefs.tf) && prefs.prepost);
      setBars(data.bars);
      setError(null);
    } catch (e) {
      setError(e.message || "chart data unavailable");
    }
  }, [ticker, prefs.tf, prefs.prepost]);

  useEffect(() => {
    // Intentional: reset to the loading state, kick off the fetch, then poll
    // intraday timeframes (same pattern as useLiveQuotes).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBars(null);
    setError(null);
    loadBars();
    if (!INTRADAY.has(prefs.tf)) return undefined;
    const id = setInterval(loadBars, INTRADAY_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadBars, prefs.tf]);

  useEffect(() => {
    // Intentional: clear the overlay synchronously when compare is switched off.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!prefs.compare) { setCompareBars(null); return; }
    let alive = true;
    getChart("SPY", prefs.tf)
      .then((d) => { if (alive) setCompareBars(d.bars); })
      .catch(() => { if (alive) setCompareBars([]); });
    return () => { alive = false; };
  }, [prefs.compare, prefs.tf]);

  const displayBars = useMemo(() => {
    if (!bars) return null;
    return prefs.type === "heikin" ? heikinAshi(bars) : bars;
  }, [bars, prefs.type]);

  // ---- chart lifecycle: create once, keep across every pref change ----
  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;

    const chart = createChart(el, {
      height: chartHeight,
      width: el.clientWidth,
      layout: {
        background: { color: "transparent" },
        fontFamily: monoFont(),
        fontSize: 11,
        attributionLogo: false,
        panes: { enableResize: false },
      },
      timeScale: { rightOffset: 4, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    // Colours are applied by the theme effect below, which runs right after
    // this one on mount and again on every theme change.
    chartRef.current = chart;

    // The crosshair handler reads live maps/overlays from refs so it never has
    // to be re-subscribed when the series are rebuilt.
    const onMove = (param) => {
      const { bars: lbars, byTime, idx } = legendMapsRef.current;
      if (!lbars.length) { setLegend(null); return; }
      let b, prev;
      if (param.time && byTime.has(param.time)) {
        const i = idx.get(param.time);
        b = lbars[i]; prev = i > 0 ? lbars[i - 1] : null;
      } else {
        b = lbars[lbars.length - 1]; prev = lbars[lbars.length - 2];
      }
      if (!b) { setLegend(null); return; }
      const changePct = prev && prev.close ? ((b.close - prev.close) / prev.close) * 100 : null;
      const overlays = [];
      for (const o of overlayRef.current) {
        const d = param.seriesData.get(o.series);
        // Stored as a palette key so the legend follows a theme change.
        if (d && d.value != null) {
          overlays.push({ label: o.label, color: colorsRef.current[o.colorKey], value: d.value });
        }
      }
      setLegend({ ...b, changePct, overlays });
    };
    chart.subscribeCrosshairMove(onMove);

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);

    // Resolve the pane under a pointer event, so axis gestures act on the pane
    // you are actually pointing at (VOL/RSI/MACD each own a price scale) rather
    // than always on the main price pane. Panes stack top-to-bottom; the
    // separators between them are a couple of px we don't bother modelling.
    const paneAt = (event) => {
      const panes = chart.panes();
      if (!panes.length) return null;
      const y = event.clientY - el.getBoundingClientRect().top;
      let acc = 0;
      for (const pane of panes) {
        acc += pane.getHeight();
        if (y <= acc) return pane;
      }
      return panes[panes.length - 1];
    };

    // True when the pointer is over the right-hand price axis rather than the
    // plot body. The axis width is shared by every pane.
    const overAxis = (event) => {
      const rect = el.getBoundingClientRect();
      const axisW = chart.priceScale("right").width() || 60; // fallback pre-measure
      return event.clientX >= rect.right - axisW;
    };

    // Wheel over a price axis scales THAT pane's price axis. The library's own
    // wheel handler always zooms the *time* scale regardless of cursor
    // position, so we intercept in the capture phase when the cursor is over an
    // axis, zoom that pane's price range via setVisibleRange, and stop the
    // event before it reaches the chart. Over the plot body we do nothing, so
    // the built-in time-zoom (and axis drag-scale) still work.
    const onAxisWheel = (event) => {
      if (!overAxis(event)) return; // not over the axis → let the chart zoom time
      const pane = paneAt(event);
      if (!pane) return;
      // Over the axis: always intercept so the built-in time-zoom never fires here.
      event.preventDefault();
      event.stopPropagation();
      const ps = rightScaleOf(pane);
      if (!ps) return;
      // Lock the scale so getVisibleRange() is populated (it's null under auto-scale).
      ps.setAutoScale(false);
      const range = ps.getVisibleRange();
      if (!range || range.to === range.from) return;
      const factor = event.deltaY < 0 ? 0.85 : 1 / 0.85; // wheel up = zoom in
      const mid = (range.from + range.to) / 2;
      const half = ((range.to - range.from) / 2) * factor;
      if (half > 0) ps.setVisibleRange({ from: mid - half, to: mid + half });
    };
    el.addEventListener("wheel", onAxisWheel, { capture: true, passive: false });

    // Double-click an axis to hand it back to auto-scale — the escape hatch
    // from a manual zoom, matching the convention in every charting package.
    const onAxisDblClick = (event) => {
      if (!overAxis(event)) return;
      const pane = paneAt(event);
      if (!pane) return;
      event.preventDefault();
      event.stopPropagation();
      rightScaleOf(pane)?.setAutoScale(true);
    };
    el.addEventListener("dblclick", onAxisDblClick, { capture: true });

    return () => {
      el.removeEventListener("wheel", onAxisWheel, { capture: true });
      el.removeEventListener("dblclick", onAxisDblClick, { capture: true });
      chart.unsubscribeCrosshairMove(onMove);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = [];
      overlayRef.current = [];
      datasetKeyRef.current = null;
      prevBarsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- theme changes: recolour everything in place ----
  // Neither the chart nor its series are recreated: chart-level colours go
  // through chart.applyOptions, and every series / price line / marker set the
  // rebuild below created registered a recolour callback in recolorRef, which
  // re-applies its colours through its own applyOptions (or setData/setMarkers
  // for per-point colours). A rebuild would also work, but it re-lays-out the
  // sub-panes, so a theme switch would visibly jump the pane heights.
  // Declared before the rebuild effect so colorsRef is current when both run.
  useEffect(() => {
    colorsRef.current = colors;
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions(chartThemeOptions(colors));
    for (const recolor of recolorRef.current) {
      try { recolor(colors); } catch { /* series already removed */ }
    }
  }, [colors]);

  // ---- height changes: just resize, never rebuild ----
  useEffect(() => { chartRef.current?.applyOptions({ height: chartHeight }); }, [chartHeight]);

  // ---- viewport-aware sizing: measure the space under the canvas and clamp ----
  const hasData = !!(bars && bars.length);
  useEffect(() => {
    const measure = () => {
      const el = elRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const reserve = 48; // legend/key footer breathing room below the canvas
      const avail = window.innerHeight - top - reserve;
      setChartHeight(Math.max(280, Math.min(height, Math.round(avail))));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [height, hasData]);

  // ---- options-only changes: price-scale mode/margins + intraday time axis ----
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const priceMode = prefs.compare
      ? PriceScaleMode.Percentage
      : prefs.logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal;
    chart.priceScale("right").applyOptions({
      mode: priceMode,
      // Volume now lives in its own pane (Task 11), so the price pane keeps a
      // symmetric margin instead of reserving the bottom for the overlay.
      scaleMargins: { top: 0.08, bottom: 0.08 },
    });
    chart.timeScale().applyOptions({ timeVisible: intraday });
  }, [prefs.compare, prefs.logScale, intraday]);

  // ---- series (re)build: tears down only series, preserves the view ----
  const { ma, ema, bb, vwap, vol, rsi, macd } = prefs.inds;
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !displayBars || displayBars.length === 0) return;

    const showOverlays = prefs.overlays && prefs.tf === "1d" && analysis && !prefs.compare;
    const datasetKey = `${ticker}|${prefs.tf}`;
    const isNewDataset = datasetKeyRef.current !== datasetKey;
    const prevBars = prevBarsRef.current;
    const dataChanged = displayBars !== prevBars;
    const prevLen = prevBars ? prevBars.length : 0;
    // Capture the user's view before we touch the series (skip on a new dataset).
    const savedRange = isNewDataset ? null : chart.timeScale().getVisibleLogicalRange();

    // tear down previous series only (chart, panes-config, view untouched)
    for (const s of seriesRef.current) { try { chart.removeSeries(s); } catch { /* already gone */ } }
    seriesRef.current = [];
    overlayRef.current = [];
    const track = (s) => { seriesRef.current.push(s); return s; };

    // Theme colours. Everything coloured below is created with `c`, and
    // registers how to recolour itself in `recolor`, which the theme effect
    // replays with the new palette — so a theme switch never rebuilds series.
    const c = colorsRef.current;
    const recolor = [];
    recolorRef.current = recolor;
    /** addSeries + track, with `colorFn(palette)` supplying the colour options. */
    const addThemed = (type, opts, colorFn, pane) => {
      const s = track(chart.addSeries(type, { ...opts, ...colorFn(c) }, pane));
      recolor.push((cc) => s.applyOptions(colorFn(cc)));
      return s;
    };
    /** createPriceLine, recoloured the same way. */
    const themedPriceLine = (s, opts, colorKey) => {
      const line = s.createPriceLine({ ...opts, color: c[colorKey] });
      recolor.push((cc) => line.applyOptions({ color: cc[colorKey] }));
    };
    /** Per-point colours live in the data, so those series re-set their data. */
    const themedData = (s, dataFn) => {
      s.setData(dataFn(c));
      recolor.push((cc) => s.setData(dataFn(cc)));
    };

    // main series by chart type
    let main;
    const upDown = (p) => ({
      upColor: p.up, downColor: p.down, wickUpColor: p.up, wickDownColor: p.down,
    });
    const ohlcData = displayBars.map((b) => ({
      time: b.time, open: b.open, high: b.high, low: b.low, close: b.close,
    }));
    const closeData = displayBars.map((b) => ({ time: b.time, value: b.close }));
    if (prefs.type === "hollow") {
      main = addThemed(CandlestickSeries, { borderVisible: true }, (p) => ({
        ...upDown(p), upColor: "transparent", borderUpColor: p.up, borderDownColor: p.down,
      }));
      main.setData(ohlcData);
    } else if (prefs.type === "bars") {
      main = addThemed(BarSeries, { thinBars: false }, (p) => ({ upColor: p.up, downColor: p.down }));
      main.setData(ohlcData);
    } else if (prefs.type === "line") {
      main = addThemed(LineSeries, { lineWidth: 2 }, (p) => ({ color: p.accent }));
      main.setData(closeData);
    } else if (prefs.type === "area") {
      main = addThemed(AreaSeries, { lineWidth: 2 }, (p) => ({
        lineColor: p.accent,
        topColor: withAlpha(p.accent, 0.28), bottomColor: withAlpha(p.accent, 0.02),
      }));
      main.setData(closeData);
    } else if (prefs.type === "baseline") {
      main = addThemed(BaselineSeries, {
        baseValue: { type: "price", price: displayBars[0].close },
      }, (p) => ({
        topLineColor: p.up, bottomLineColor: p.down,
        topFillColor1: withAlpha(p.up, 0.22), topFillColor2: withAlpha(p.up, 0.02),
        bottomFillColor1: withAlpha(p.down, 0.02), bottomFillColor2: withAlpha(p.down, 0.22),
      }));
      main.setData(closeData);
    } else {
      main = addThemed(CandlestickSeries, { borderVisible: false }, upDown);
      main.setData(ohlcData);
    }

    // The price series is what user drawings anchor to (see useDrawings).
    mainSeriesRef.current = main;

    // A tracked line series in palette colour `colorKey`; `label` (if given)
    // registers it for the crosshair legend.
    const addLine = (data, colorKey, label, width = 1, style) => {
      if (data.length < 2) return;
      const s = addThemed(LineSeries, {
        lineWidth: width, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: true,
        ...(style != null ? { lineStyle: style } : {}),
      }, (p) => ({ color: p[colorKey] }));
      s.setData(data);
      if (label) overlayRef.current.push({ series: s, label, colorKey });
    };

    // overlays computed from the *raw* bars (indicator math on real OHLC)
    if (ma) for (const def of MA_DEFS) addLine(smaSeries(bars, def.n), def.key, `SMA ${def.n}`, def.n >= 150 ? 2 : 1);
    if (ema) for (const def of EMA_DEFS) addLine(emaSeries(bars, def.n), def.key, `EMA ${def.n}`, 1, LineStyle.Dotted);
    if (bb) {
      const bands = bollingerSeries(bars);
      addLine(bands.upper, "muted", "BB upper", 1, LineStyle.Dashed);
      addLine(bands.middle, "muted", "BB mid", 1);
      addLine(bands.lower, "muted", "BB lower", 1, LineStyle.Dashed);
    }
    if (vwap && intraday) addLine(vwapSeries(bars), "compare", "VWAP", 2);

    // SPY comparison (percent scale set in the options effect)
    if (prefs.compare && compareBars && compareBars.length > 1) {
      const cmp = addThemed(LineSeries, { lineWidth: 2, priceLineVisible: false, title: "SPY" },
        (p) => ({ color: p.compare }));
      cmp.setData(compareBars.map((b) => ({ time: b.time, value: b.close })));
    }

    // sub-panes — each indicator gets its OWN pane + visible price scale, and
    // shows its current value as an axis label ("tell the data", Task 11).
    let paneIndex = 0;
    if (vol) {
      paneIndex += 1;
      const volS = track(chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" }, priceLineVisible: false,
        lastValueVisible: true, title: "Vol",
      }, paneIndex));
      themedData(volS, (p) => displayBars.map((b) => ({
        time: b.time, value: b.volume,
        color: withAlpha(b.close >= b.open ? p.up : p.down, 0.53),
      })));
      chart.panes()[paneIndex]?.setHeight?.(PANE_HEIGHTS.vol);
    }
    if (rsi) {
      paneIndex += 1;
      const rsiS = addThemed(LineSeries, {
        lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: "RSI 14",
      }, (p) => ({ color: p.info }), paneIndex);
      rsiS.setData(rsiSeries(bars));
      themedPriceLine(rsiS, { price: 70, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true }, "down");
      themedPriceLine(rsiS, { price: 30, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true }, "up");
      chart.panes()[paneIndex]?.setHeight?.(PANE_HEIGHTS.rsi);
    }
    if (macd) {
      paneIndex += 1;
      const { macd: macdData, signal, hist } = macdSeries(bars);
      const histSeries = track(chart.addSeries(HistogramSeries, {
        priceLineVisible: false, lastValueVisible: false,
      }, paneIndex));
      themedData(histSeries, (p) => hist.map((pt) => ({
        ...pt, color: withAlpha(pt.value >= 0 ? p.up : p.down, 0.53),
      })));
      const macdLine = addThemed(LineSeries, {
        lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: "MACD",
      }, (p) => ({ color: p.accent }), paneIndex);
      macdLine.setData(macdData);
      const sigLine = addThemed(LineSeries, {
        lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: "Signal",
      }, (p) => ({ color: p.info }), paneIndex);
      sigLine.setData(signal);
      chart.panes()[paneIndex]?.setHeight?.(PANE_HEIGHTS.macd);
    }

    // analysis overlays (daily view only; hidden in percent-compare mode)
    if (showOverlays) {
      // Horizontal S/R — round-number levels get a distinct dotted/muted style.
      for (const l of (analysis.support || [])) {
        const round = l.source === "round";
        themedPriceLine(main, { price: l.price, lineWidth: 1,
          lineStyle: round ? LineStyle.Dotted : LineStyle.Dashed, axisLabelVisible: true,
          title: round ? `S ⌾ ${l.price}` : `S ${l.touches}x` }, round ? "muted" : "up");
      }
      for (const l of (analysis.resistance || [])) {
        const round = l.source === "round";
        themedPriceLine(main, { price: l.price, lineWidth: 1,
          lineStyle: round ? LineStyle.Dotted : LineStyle.Dashed, axisLabelVisible: true,
          title: round ? `R ⌾ ${l.price}` : `R ${l.touches}x` }, round ? "muted" : "down");
      }
      // Diagonal trendlines as two-point line series (dashed when broken).
      const lastBar = displayBars[displayBars.length - 1];
      for (const tl of (analysis.trendlines || [])) {
        const pts = (tl.pivots || []).map((pv) => ({ time: pv.date, value: pv.price }));
        if (pts.length && lastBar && lastBar.time > pts[pts.length - 1].time) {
          pts.push({ time: lastBar.time, value: tl.current_value });
        }
        if (pts.length >= 2) {
          const tlS = addThemed(LineSeries, {
            lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
            crosshairMarkerVisible: false,
            lineStyle: tl.broken ? LineStyle.Dashed : LineStyle.Solid,
          }, (p) => ({ color: tl.kind === "support" ? p.up : p.down }));
          tlS.setData(pts);
        }
      }
      if (analysis.entry) themedPriceLine(main, { price: analysis.entry, lineWidth: 1, title: "entry" }, "accent");
      if (analysis.stop) themedPriceLine(main, { price: analysis.stop, lineWidth: 2, title: "stop" }, "down");
      if (analysis.target) themedPriceLine(main, { price: analysis.target, lineWidth: 2, title: "3R" }, "up");

      const buildMarkers = (p) => {
        const markers = [];
        for (const pat of (analysis.patterns || [])) {
          for (const pv of (pat.pivots || [])) {
            markers.push({ time: pv.date, position: "aboveBar", color: p.accent, shape: "circle", text: pv.role });
          }
        }
        for (const g of (analysis.gaps || [])) {
          if (g.filled) continue;
          markers.push({
            time: g.date, position: g.kind === "up" ? "belowBar" : "aboveBar",
            color: g.kind === "up" ? p.up : p.down,
            shape: g.kind === "up" ? "arrowUp" : "arrowDown", text: "gap",
          });
        }
        return markers.sort((a, b) => (a.time < b.time ? -1 : 1));
      };
      const markers = buildMarkers(c);
      if (markers.length) {
        const markerApi = createSeriesMarkers(main, markers);
        recolor.push((cc) => markerApi.setMarkers(buildMarkers(cc)));
      }
    }

    // refresh the crosshair legend maps + reset the resting legend to the last bar
    const byTime = new Map(displayBars.map((b) => [b.time, b]));
    const idx = new Map(displayBars.map((b, i) => [b.time, i]));
    legendMapsRef.current = { bars: displayBars, byTime, idx };
    const lastB = displayBars[displayBars.length - 1];
    const prevB = displayBars[displayBars.length - 2];
    const lastChange = prevB && prevB.close ? ((lastB.close - prevB.close) / prevB.close) * 100 : null;
    setLegend({ ...lastB, changePct: lastChange, overlays: [] });

    // view preservation: refit only for a genuinely new dataset (ticker/timeframe)
    if (isNewDataset) {
      chart.timeScale().fitContent();
      // Re-enable auto-scale on EVERY pane so a prior manual wheel-zoom doesn't
      // freeze an axis at a stale range when the ticker/timeframe changes.
      for (const pane of chart.panes()) rightScaleOf(pane)?.setAutoScale(true);
      datasetKeyRef.current = datasetKey;
    } else if (savedRange) {
      const wasAtEdge = savedRange.to >= prevLen - 1.5;
      if (dataChanged && wasAtEdge) chart.timeScale().scrollToRealTime();
      else chart.timeScale().setVisibleLogicalRange(savedRange);
    }
    prevBarsRef.current = displayBars;
    // Tell the drawing layer to re-attach to the series we just built.
    setSeriesEpoch((n) => n + 1);
  }, [bars, displayBars, compareBars, analysis, prefs.type, prefs.overlays, prefs.compare,
      prefs.tf, ticker, intraday, ma, ema, bb, vwap, vol, rsi, macd]);

  // User-drawn annotations: their own primitive layer, so they're independent
  // of indicator toggles and of the analysis overlays drawn from the payload.
  const drawing = useDrawings({
    ticker,
    chartRef,
    elRef,
    mainSeriesRef,
    seriesEpoch,
    enabled: hasData,
    colors: drawColors,
  });

  const toneOf = (b) => (b && b.close >= b.open ? "pos" : "neg");

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar} role="toolbar" aria-label="Chart controls">
        <div className={styles.group} role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((t) => (
            <button key={t.key} className={styles.pill} data-active={prefs.tf === t.key ? "yes" : "no"}
                    onClick={() => setPref({ tf: t.key })}>{t.label}</button>
          ))}
        </div>

        <div className={styles.segmented} role="group" aria-label="Chart type">
          {CHART_TYPES.map((t) => {
            const active = prefs.type === t.key;
            return (
              <button
                key={t.key}
                type="button"
                className={styles.segBtn}
                data-active={active ? "yes" : "no"}
                onClick={() => setPref({ type: t.key })}
                title={t.label}
                aria-label={t.label}
                aria-pressed={active}
              >
                {active && (
                  <motion.span
                    layoutId="chartTypeThumb"
                    className={styles.segThumb}
                    transition={prefersReducedMotion()
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 520, damping: 40 }}
                    aria-hidden="true"
                  />
                )}
                <span className={styles.segGlyph}><TypeIcon type={t.key} /></span>
              </button>
            );
          })}
        </div>

        <div className={styles.group} role="group" aria-label="Indicators">
          {IND_DEFS.map((d) => {
            const disabled = d.intradayOnly && !intraday;
            return (
              <button
                key={d.key}
                className={styles.pill}
                data-active={prefs.inds[d.key] && !disabled ? "yes" : "no"}
                disabled={disabled}
                title={disabled ? `${d.label} — intraday timeframes only` : d.label}
                onClick={() => setPref({ inds: { [d.key]: !prefs.inds[d.key] } })}
              >
                {d.key.toUpperCase()}
              </button>
            );
          })}
        </div>

        <div className={styles.group} role="group" aria-label="Scale and overlays">
          <button className={styles.pill} data-active={prefs.logScale && !prefs.compare ? "yes" : "no"}
                  disabled={prefs.compare} title="Logarithmic price scale"
                  onClick={() => setPref({ logScale: !prefs.logScale })}>LOG</button>
          <button className={styles.pill} data-active={prefs.compare ? "yes" : "no"}
                  title="Compare with SPY (percent scale)"
                  onClick={() => setPref({ compare: !prefs.compare })}>vs SPY</button>
          {intraday && (
            <button className={styles.pill} data-active={prefs.prepost ? "yes" : "no"}
                    title="Include pre-market / after-hours bars"
                    onClick={() => setPref({ prepost: !prefs.prepost })}>EXT</button>
          )}
          {analysis && (
            <button className={styles.pill} data-active={prefs.overlays ? "yes" : "no"}
                    title="Analysis overlays: support/resistance, entry/stop/target, patterns (daily)"
                    onClick={() => setPref({ overlays: !prefs.overlays })}>PLAN</button>
          )}
        </div>

        <div className={styles.group} role="group" aria-label="Drawing tools">
          {DRAW_TOOLS.map((t) => (
            <button
              key={t.key}
              className={styles.pill}
              data-active={drawing.tool === t.key ? "yes" : "no"}
              title={t.title}
              aria-pressed={drawing.tool === t.key}
              onClick={() => drawing.setTool(t.key)}
            >
              {t.glyph}
            </button>
          ))}
          <button
            className={styles.pill}
            title={drawing.selectedId ? "Delete the selected drawing (Del)" : "Remove every drawing on this chart"}
            disabled={drawing.shapes.length === 0}
            onClick={() => (drawing.selectedId ? drawing.deleteSelected() : drawing.clearAll())}
          >
            {drawing.selectedId ? "DEL" : "CLR"}
          </button>
          {!drawing.synced && (
            <span className={styles.offlineNote} title="Saved on this device; the server copy will catch up on the next load.">
              local
            </span>
          )}
        </div>
      </div>

      {legend && (
        <div className={styles.legend} aria-live="off">
          <span className={styles.legendTicker}>{ticker}</span>
          <span>O <em data-tone={toneOf(legend)}>{fmt(legend.open)}</em></span>
          <span>H <em data-tone={toneOf(legend)}>{fmt(legend.high)}</em></span>
          <span>L <em data-tone={toneOf(legend)}>{fmt(legend.low)}</em></span>
          <span>C <em data-tone={toneOf(legend)}>{fmt(legend.close)}</em></span>
          {legend.changePct != null && (
            <span><em data-tone={legend.changePct >= 0 ? "pos" : "neg"}>
              {legend.changePct >= 0 ? "+" : ""}{legend.changePct.toFixed(2)}%
            </em></span>
          )}
          <span>Vol <em>{fmtVol(legend.volume)}</em>
            {legend.volume != null && (
              <span className={styles.volExact}> ({legend.volume.toLocaleString()})</span>
            )}
          </span>
          {prefs.compare && <span className={styles.legendCompare}>vs SPY (%)</span>}
          {legend.overlays?.map((o) => (
            <span key={o.label} className={styles.overlayChip}>
              <span className={styles.overlayDot} style={{ background: o.color }} aria-hidden="true" />
              {o.label} <em>{fmt(o.value)}</em>
            </span>
          ))}
        </div>
      )}

      {error ? (
        <div className={styles.message}>
          <p>Chart data unavailable: {error}</p>
          <button className={styles.retry} onClick={loadBars}>Retry</button>
        </div>
      ) : bars && bars.length === 0 ? (
        <div className={styles.message}><p>No {prefs.tf} price history for {ticker}.</p></div>
      ) : null}

      <div className={styles.canvasWrap}>
        <div ref={elRef} className={styles.canvas} style={{ width: "100%" }} />
        <AnimatePresence>
          {(updating || bars === null) && !error && (
            <motion.div
              key="chart-loader"
              className={styles.loader}
              initial={prefersReducedMotion() ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion() ? 0 : 0.18 }}
            >
              <span className={styles.spinner} aria-hidden="true" />
              <span>{bars === null ? `Loading ${prefs.tf} bars…` : "Updating…"}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <p className={styles.key}>
        {prefs.inds.ma && <><span data-c="info">MA20</span><span data-c="accent">MA50</span><span data-c="muted">MA150</span><span data-c="neg">MA200</span></>}
        {prefs.inds.ema && <><span data-c="pos">EMA9</span><span data-c="cmp">EMA21</span></>}
        {prefs.inds.bb && <span data-c="muted">BB(20,2)</span>}
        {prefs.inds.vwap && intraday && <span data-c="cmp">VWAP</span>}
        {prefs.compare && <span data-c="cmp">SPY</span>}
        {prefs.overlays && prefs.tf === "1d" && analysis && !prefs.compare && (
          <span className={styles.keyNote}>dashed = support/resistance · dotted = round numbers · diagonals = trendlines · dots = pattern pivots · arrows = unfilled gaps</span>
        )}
      </p>
    </div>
  );
}
