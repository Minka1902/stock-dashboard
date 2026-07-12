import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart, CandlestickSeries, BarSeries, HistogramSeries, LineSeries,
  AreaSeries, BaselineSeries, LineStyle, PriceScaleMode, createSeriesMarkers,
} from "lightweight-charts";
import { motion } from "motion/react";
import { getChart } from "../api";
import {
  smaSeries, emaSeries, bollingerSeries, rsiSeries, macdSeries, vwapSeries,
  heikinAshi,
} from "../lib/indicators";
import { prefersReducedMotion } from "../lib/motionConfig";
import styles from "./ChartPro.module.css";

// lightweight-charts renders to canvas and cannot parse oklch(), so the chart
// uses fixed hex/rgb colors tuned to the dark "amber terminal" palette rather
// than reading the oklch CSS tokens.
const COLORS = {
  text: "#b7b0a6",
  grid: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.12)",
  up: "#4fd6a0",       // positive / mint
  down: "#e5544b",     // negative / crimson
  accent: "#f0b429",   // amber
  info: "#57a5e0",     // cool blue
  muted: "#8f887e",    // warm gray
  compare: "#c084fc",  // SPY overlay (violet, distinct from every indicator)
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

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return { ...DEFAULT_PREFS, ...raw, inds: { ...DEFAULT_PREFS.inds, ...(raw.inds || {}) } };
  } catch {
    return DEFAULT_PREFS;
  }
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

/**
 * Pro chart workspace (TradingView lightweight-charts v5): chart types,
 * intraday-to-monthly timeframes, indicator menu with RSI/MACD sub-panes,
 * log scale, SPY comparison, crosshair OHLCV legend, and the analysis
 * overlays (S/R, entry/stop/target, pattern markers) on the daily view.
 * Preferences persist in localStorage.
 */
export default function ChartPro({ ticker, analysis = null, height = 460 }) {
  const elRef = useRef(null);
  const [prefs, setPrefs] = useState(loadPrefs);
  // Viewport-aware chart height: fill the space below the toolbar/legend down
  // to the bottom of the viewport, clamped to [280, `height`] so the chart +
  // toolbar + legend fit one screen without page scroll (Task 9).
  const [chartHeight, setChartHeight] = useState(height);
  const [bars, setBars] = useState(null);      // null = loading, [] = no data
  const [compareBars, setCompareBars] = useState(null);
  const [error, setError] = useState(null);
  const [legend, setLegend] = useState(null);

  // Persistent chart handles: the chart is created once (see the mount effect)
  // and only its *series* are torn down/rebuilt on data/indicator changes, so
  // the user's zoom/pan (visible logical range) survives toolbar interactions.
  const chartRef = useRef(null);
  const seriesRef = useRef([]);        // every removable series (main + overlays + panes)
  const overlayRef = useRef([]);       // {series,label,color} for the crosshair legend
  const datasetKeyRef = useRef(null);  // `${ticker}|${tf}` — only refit when this changes
  const prevBarsRef = useRef(null);    // identity check: did the bar data actually change?
  const legendMapsRef = useRef({ bars: [], byTime: new Map(), idx: new Map() });

  const setPref = useCallback((patch) => {
    setPrefs((p) => {
      const next = { ...p, ...patch, inds: { ...p.inds, ...(patch.inds || {}) } };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);

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
        textColor: COLORS.text,
        fontFamily: monoFont(),
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: COLORS.border, enableResize: false },
      },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.border },
      timeScale: { borderColor: COLORS.border, rightOffset: 4, secondsVisible: false },
      crosshair: { mode: 0 },
    });
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
        if (d && d.value != null) overlays.push({ label: o.label, color: o.color, value: d.value });
      }
      setLegend({ ...b, changePct, overlays });
    };
    chart.subscribeCrosshairMove(onMove);

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);

    return () => {
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
      scaleMargins: { top: 0.08, bottom: prefs.inds.vol ? 0.26 : 0.08 },
    });
    chart.timeScale().applyOptions({ timeVisible: intraday });
  }, [prefs.compare, prefs.logScale, prefs.inds.vol, intraday]);

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

    // main series by chart type
    let main;
    const upDown = {
      upColor: COLORS.up, downColor: COLORS.down, borderVisible: false,
      wickUpColor: COLORS.up, wickDownColor: COLORS.down,
    };
    const ohlcData = displayBars.map((b) => ({
      time: b.time, open: b.open, high: b.high, low: b.low, close: b.close,
    }));
    const closeData = displayBars.map((b) => ({ time: b.time, value: b.close }));
    if (prefs.type === "hollow") {
      main = track(chart.addSeries(CandlestickSeries, {
        ...upDown,
        upColor: "transparent", borderVisible: true,
        borderUpColor: COLORS.up, borderDownColor: COLORS.down,
      }));
      main.setData(ohlcData);
    } else if (prefs.type === "bars") {
      main = track(chart.addSeries(BarSeries, { upColor: COLORS.up, downColor: COLORS.down, thinBars: false }));
      main.setData(ohlcData);
    } else if (prefs.type === "line") {
      main = track(chart.addSeries(LineSeries, { color: COLORS.accent, lineWidth: 2 }));
      main.setData(closeData);
    } else if (prefs.type === "area") {
      main = track(chart.addSeries(AreaSeries, {
        lineColor: COLORS.accent, lineWidth: 2,
        topColor: "rgba(240,180,41,0.28)", bottomColor: "rgba(240,180,41,0.02)",
      }));
      main.setData(closeData);
    } else if (prefs.type === "baseline") {
      main = track(chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: displayBars[0].close },
        topLineColor: COLORS.up, bottomLineColor: COLORS.down,
        topFillColor1: "rgba(79,214,160,0.22)", topFillColor2: "rgba(79,214,160,0.02)",
        bottomFillColor1: "rgba(229,84,75,0.02)", bottomFillColor2: "rgba(229,84,75,0.22)",
      }));
      main.setData(closeData);
    } else {
      main = track(chart.addSeries(CandlestickSeries, upDown));
      main.setData(ohlcData);
    }

    // volume histogram (overlay scale at the bottom of the main pane)
    if (vol) {
      const volS = track(chart.addSeries(HistogramSeries, {
        priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false,
        lastValueVisible: false,
      }));
      volS.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volS.setData(displayBars.map((b) => ({
        time: b.time, value: b.volume,
        color: (b.close >= b.open ? COLORS.up : COLORS.down) + "55",
      })));
    }

    // A tracked line series; `label` (if given) registers it for the crosshair legend.
    const addLine = (data, color, label, width = 1, style) => {
      if (data.length < 2) return;
      const s = track(chart.addSeries(LineSeries, {
        color, lineWidth: width, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: true,
        ...(style != null ? { lineStyle: style } : {}),
      }));
      s.setData(data);
      if (label) overlayRef.current.push({ series: s, label, color });
    };

    // overlays computed from the *raw* bars (indicator math on real OHLC)
    if (ma) for (const def of MA_DEFS) addLine(smaSeries(bars, def.n), COLORS[def.key], `SMA ${def.n}`, def.n >= 150 ? 2 : 1);
    if (ema) for (const def of EMA_DEFS) addLine(emaSeries(bars, def.n), COLORS[def.key], `EMA ${def.n}`, 1, LineStyle.Dotted);
    if (bb) {
      const bands = bollingerSeries(bars);
      addLine(bands.upper, COLORS.muted, "BB upper", 1, LineStyle.Dashed);
      addLine(bands.middle, COLORS.muted, "BB mid", 1);
      addLine(bands.lower, COLORS.muted, "BB lower", 1, LineStyle.Dashed);
    }
    if (vwap && intraday) addLine(vwapSeries(bars), COLORS.compare, "VWAP", 2);

    // SPY comparison (percent scale set in the options effect)
    if (prefs.compare && compareBars && compareBars.length > 1) {
      const cmp = track(chart.addSeries(LineSeries, {
        color: COLORS.compare, lineWidth: 2, priceLineVisible: false, title: "SPY",
      }));
      cmp.setData(compareBars.map((b) => ({ time: b.time, value: b.close })));
    }

    // sub-panes
    let paneIndex = 0;
    if (rsi) {
      paneIndex += 1;
      const rsiS = track(chart.addSeries(LineSeries, {
        color: COLORS.info, lineWidth: 2, priceLineVisible: false, title: "RSI 14",
      }, paneIndex));
      rsiS.setData(rsiSeries(bars));
      rsiS.createPriceLine({ price: 70, color: COLORS.down, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
      rsiS.createPriceLine({ price: 30, color: COLORS.up, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
      chart.panes()[paneIndex]?.setHeight?.(96);
    }
    if (macd) {
      paneIndex += 1;
      const { macd: macdData, signal, hist } = macdSeries(bars);
      const histSeries = track(chart.addSeries(HistogramSeries, {
        priceLineVisible: false, lastValueVisible: false,
      }, paneIndex));
      histSeries.setData(hist.map((p) => ({
        ...p, color: (p.value >= 0 ? COLORS.up : COLORS.down) + "88",
      })));
      const macdLine = track(chart.addSeries(LineSeries, {
        color: COLORS.accent, lineWidth: 2, priceLineVisible: false, title: "MACD",
      }, paneIndex));
      macdLine.setData(macdData);
      const sigLine = track(chart.addSeries(LineSeries, {
        color: COLORS.info, lineWidth: 1, priceLineVisible: false,
      }, paneIndex));
      sigLine.setData(signal);
      chart.panes()[paneIndex]?.setHeight?.(110);
    }

    // analysis overlays (daily view only; hidden in percent-compare mode)
    if (showOverlays) {
      // Horizontal S/R — round-number levels get a distinct dotted/muted style.
      for (const l of (analysis.support || [])) {
        const round = l.source === "round";
        main.createPriceLine({ price: l.price, color: round ? COLORS.muted : COLORS.up, lineWidth: 1,
          lineStyle: round ? LineStyle.Dotted : LineStyle.Dashed, axisLabelVisible: true,
          title: round ? `S ⌾ ${l.price}` : `S ${l.touches}x` });
      }
      for (const l of (analysis.resistance || [])) {
        const round = l.source === "round";
        main.createPriceLine({ price: l.price, color: round ? COLORS.muted : COLORS.down, lineWidth: 1,
          lineStyle: round ? LineStyle.Dotted : LineStyle.Dashed, axisLabelVisible: true,
          title: round ? `R ⌾ ${l.price}` : `R ${l.touches}x` });
      }
      // Diagonal trendlines as two-point line series (dashed when broken).
      const lastBar = displayBars[displayBars.length - 1];
      for (const tl of (analysis.trendlines || [])) {
        const pts = (tl.pivots || []).map((pv) => ({ time: pv.date, value: pv.price }));
        if (pts.length && lastBar && lastBar.time > pts[pts.length - 1].time) {
          pts.push({ time: lastBar.time, value: tl.current_value });
        }
        if (pts.length >= 2) {
          const tlS = track(chart.addSeries(LineSeries, {
            color: tl.kind === "support" ? COLORS.up : COLORS.down,
            lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
            crosshairMarkerVisible: false,
            lineStyle: tl.broken ? LineStyle.Dashed : LineStyle.Solid,
          }));
          tlS.setData(pts);
        }
      }
      if (analysis.entry) main.createPriceLine({ price: analysis.entry, color: COLORS.accent, lineWidth: 1, title: "entry" });
      if (analysis.stop) main.createPriceLine({ price: analysis.stop, color: COLORS.down, lineWidth: 2, title: "stop" });
      if (analysis.target) main.createPriceLine({ price: analysis.target, color: COLORS.up, lineWidth: 2, title: "3R" });

      const markers = [];
      for (const p of (analysis.patterns || [])) {
        for (const pv of (p.pivots || [])) {
          markers.push({ time: pv.date, position: "aboveBar", color: COLORS.accent, shape: "circle", text: pv.role });
        }
      }
      for (const g of (analysis.gaps || [])) {
        if (g.filled) continue;
        markers.push({
          time: g.date, position: g.kind === "up" ? "belowBar" : "aboveBar",
          color: g.kind === "up" ? COLORS.up : COLORS.down,
          shape: g.kind === "up" ? "arrowUp" : "arrowDown", text: "gap",
        });
      }
      markers.sort((a, b) => (a.time < b.time ? -1 : 1));
      if (markers.length) createSeriesMarkers(main, markers);
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
      datasetKeyRef.current = datasetKey;
    } else if (savedRange) {
      const wasAtEdge = savedRange.to >= prevLen - 1.5;
      if (dataChanged && wasAtEdge) chart.timeScale().scrollToRealTime();
      else chart.timeScale().setVisibleLogicalRange(savedRange);
    }
    prevBarsRef.current = displayBars;
  }, [bars, displayBars, compareBars, analysis, prefs.type, prefs.overlays, prefs.compare,
      prefs.tf, ticker, intraday, ma, ema, bb, vwap, vol, rsi, macd]);

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
      ) : bars === null ? (
        <div className={styles.message}><p>Loading {prefs.tf} bars…</p></div>
      ) : bars.length === 0 ? (
        <div className={styles.message}><p>No {prefs.tf} price history for {ticker}.</p></div>
      ) : null}

      <div ref={elRef} className={styles.canvas} style={{ width: "100%" }} />

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
