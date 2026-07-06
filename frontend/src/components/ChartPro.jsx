import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart, CandlestickSeries, BarSeries, HistogramSeries, LineSeries,
  AreaSeries, BaselineSeries, LineStyle, PriceScaleMode, createSeriesMarkers,
} from "lightweight-charts";
import { getChart } from "../api";
import {
  smaSeries, emaSeries, bollingerSeries, rsiSeries, macdSeries, vwapSeries,
  heikinAshi,
} from "../lib/indicators";
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
  const [bars, setBars] = useState(null);      // null = loading, [] = no data
  const [compareBars, setCompareBars] = useState(null);
  const [error, setError] = useState(null);
  const [legend, setLegend] = useState(null);

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
      const data = await getChart(ticker, prefs.tf);
      setBars(data.bars);
      setError(null);
    } catch (e) {
      setError(e.message || "chart data unavailable");
    }
  }, [ticker, prefs.tf]);

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

  // ---- chart lifecycle ----
  useEffect(() => {
    if (!elRef.current || !displayBars || displayBars.length === 0) return undefined;

    const el = elRef.current;
    const inds = prefs.inds;
    const showOverlays = prefs.overlays && prefs.tf === "1d" && analysis && !prefs.compare;
    const priceMode = prefs.compare
      ? PriceScaleMode.Percentage
      : prefs.logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal;

    const chart = createChart(el, {
      height,
      layout: {
        background: { color: "transparent" },
        textColor: COLORS.text,
        fontFamily: monoFont(),
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: COLORS.border, enableResize: false },
      },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: {
        borderColor: COLORS.border,
        mode: priceMode,
        scaleMargins: { top: 0.08, bottom: inds.vol ? 0.26 : 0.08 },
      },
      timeScale: {
        borderColor: COLORS.border,
        rightOffset: 4,
        timeVisible: INTRADAY.has(prefs.tf),
        secondsVisible: false,
      },
      crosshair: { mode: 0 },
    });

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
      main = chart.addSeries(CandlestickSeries, {
        ...upDown,
        upColor: "transparent", borderVisible: true,
        borderUpColor: COLORS.up, borderDownColor: COLORS.down,
      });
      main.setData(ohlcData);
    } else if (prefs.type === "bars") {
      main = chart.addSeries(BarSeries, { upColor: COLORS.up, downColor: COLORS.down, thinBars: false });
      main.setData(ohlcData);
    } else if (prefs.type === "line") {
      main = chart.addSeries(LineSeries, { color: COLORS.accent, lineWidth: 2 });
      main.setData(closeData);
    } else if (prefs.type === "area") {
      main = chart.addSeries(AreaSeries, {
        lineColor: COLORS.accent, lineWidth: 2,
        topColor: "rgba(240,180,41,0.28)", bottomColor: "rgba(240,180,41,0.02)",
      });
      main.setData(closeData);
    } else if (prefs.type === "baseline") {
      main = chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: displayBars[0].close },
        topLineColor: COLORS.up, bottomLineColor: COLORS.down,
        topFillColor1: "rgba(79,214,160,0.22)", topFillColor2: "rgba(79,214,160,0.02)",
        bottomFillColor1: "rgba(229,84,75,0.02)", bottomFillColor2: "rgba(229,84,75,0.22)",
      });
      main.setData(closeData);
    } else {
      main = chart.addSeries(CandlestickSeries, upDown);
      main.setData(ohlcData);
    }

    // volume histogram (overlay scale at the bottom of the main pane)
    if (inds.vol) {
      const vol = chart.addSeries(HistogramSeries, {
        priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false,
        lastValueVisible: false,
      });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(displayBars.map((b) => ({
        time: b.time, value: b.volume,
        color: (b.close >= b.open ? COLORS.up : COLORS.down) + "55",
      })));
    }

    const addLine = (data, color, width = 1, style) => {
      if (data.length < 2) return;
      const s = chart.addSeries(LineSeries, {
        color, lineWidth: width, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false,
        ...(style != null ? { lineStyle: style } : {}),
      });
      s.setData(data);
    };

    // overlays computed from the *raw* bars (indicator math on real OHLC)
    if (inds.ma) for (const def of MA_DEFS) addLine(smaSeries(bars, def.n), COLORS[def.key], def.n >= 150 ? 2 : 1);
    if (inds.ema) for (const def of EMA_DEFS) addLine(emaSeries(bars, def.n), COLORS[def.key], 1, LineStyle.Dotted);
    if (inds.bb) {
      const bb = bollingerSeries(bars);
      addLine(bb.upper, COLORS.muted, 1, LineStyle.Dashed);
      addLine(bb.middle, COLORS.muted, 1);
      addLine(bb.lower, COLORS.muted, 1, LineStyle.Dashed);
    }
    if (inds.vwap && intraday) addLine(vwapSeries(bars), COLORS.compare, 2);

    // SPY comparison (percent scale set above)
    if (prefs.compare && compareBars && compareBars.length > 1) {
      const cmp = chart.addSeries(LineSeries, {
        color: COLORS.compare, lineWidth: 2, priceLineVisible: false,
        title: "SPY",
      });
      cmp.setData(compareBars.map((b) => ({ time: b.time, value: b.close })));
    }

    // sub-panes
    let paneIndex = 0;
    if (inds.rsi) {
      paneIndex += 1;
      const rsi = chart.addSeries(LineSeries, {
        color: COLORS.info, lineWidth: 2, priceLineVisible: false, title: "RSI 14",
      }, paneIndex);
      rsi.setData(rsiSeries(bars));
      rsi.createPriceLine({ price: 70, color: COLORS.down, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
      rsi.createPriceLine({ price: 30, color: COLORS.up, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
      chart.panes()[paneIndex]?.setHeight?.(96);
    }
    if (inds.macd) {
      paneIndex += 1;
      const { macd, signal, hist } = macdSeries(bars);
      const histSeries = chart.addSeries(HistogramSeries, {
        priceLineVisible: false, lastValueVisible: false,
      }, paneIndex);
      histSeries.setData(hist.map((p) => ({
        ...p, color: (p.value >= 0 ? COLORS.up : COLORS.down) + "88",
      })));
      const macdLine = chart.addSeries(LineSeries, {
        color: COLORS.accent, lineWidth: 2, priceLineVisible: false, title: "MACD",
      }, paneIndex);
      macdLine.setData(macd);
      const sigLine = chart.addSeries(LineSeries, {
        color: COLORS.info, lineWidth: 1, priceLineVisible: false,
      }, paneIndex);
      sigLine.setData(signal);
      chart.panes()[paneIndex]?.setHeight?.(110);
    }

    // analysis overlays (daily view only; hidden in percent-compare mode)
    if (showOverlays) {
      for (const l of (analysis.support || [])) {
        main.createPriceLine({ price: l.price, color: COLORS.up, lineWidth: 1,
          lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `S ${l.touches}x` });
      }
      for (const l of (analysis.resistance || [])) {
        main.createPriceLine({ price: l.price, color: COLORS.down, lineWidth: 1,
          lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `R ${l.touches}x` });
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

    // crosshair legend
    const byTime = new Map(displayBars.map((b) => [b.time, b]));
    const setFromBar = (b, prev) => {
      if (!b) { setLegend(null); return; }
      const changePct = prev && prev.close ? ((b.close - prev.close) / prev.close) * 100 : null;
      setLegend({ ...b, changePct });
    };
    const idx = new Map(displayBars.map((b, i) => [b.time, i]));
    setFromBar(displayBars[displayBars.length - 1], displayBars[displayBars.length - 2]);
    const onMove = (param) => {
      if (!param.time || !byTime.has(param.time)) {
        setFromBar(displayBars[displayBars.length - 1], displayBars[displayBars.length - 2]);
        return;
      }
      const i = idx.get(param.time);
      setFromBar(displayBars[i], i > 0 ? displayBars[i - 1] : null);
    };
    chart.subscribeCrosshairMove(onMove);

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (el) chart.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);

    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      ro.disconnect();
      chart.remove();
    };
  }, [bars, displayBars, compareBars, analysis, prefs, height, intraday]);

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

        <select
          className={styles.select}
          value={prefs.type}
          onChange={(e) => setPref({ type: e.target.value })}
          aria-label="Chart type"
        >
          {CHART_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>

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
          <span>Vol <em>{fmtVol(legend.volume)}</em></span>
          {prefs.compare && <span className={styles.legendCompare}>vs SPY (%)</span>}
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
          <span className={styles.keyNote}>dashed = support/resistance · dots = pattern pivots · arrows = unfilled gaps</span>
        )}
      </p>
    </div>
  );
}
