import { useEffect, useRef } from "react";
import {
  createChart, CandlestickSeries, HistogramSeries, LineSeries, LineStyle,
  createSeriesMarkers,
} from "lightweight-charts";

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
};

function monoFont() {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--mono").trim();
  return v || "monospace";
}

function sma(closes, n) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < n) return out;
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= n) sum -= closes[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

const MA_DEFS = [
  { n: 20, key: "info" },
  { n: 50, key: "accent" },
  { n: 150, key: "muted" },
  { n: 200, key: "down" },
];

/**
 * Annotated candlestick chart (TradingView lightweight-charts v5).
 * Props: bars [{date,open,high,low,close,volume}], analysis (S/R + pattern
 * markers, daily only), showMarkers, height.
 */
export default function ChartPro({ bars, analysis, showMarkers = true, height = 460 }) {
  const elRef = useRef(null);

  useEffect(() => {
    if (!elRef.current || !bars || bars.length === 0) return;

    const chart = createChart(elRef.current, {
      height,
      layout: {
        background: { color: "transparent" },
        textColor: COLORS.text,
        fontFamily: monoFont(),
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.border, scaleMargins: { top: 0.08, bottom: 0.28 } },
      timeScale: { borderColor: COLORS.border, rightOffset: 4 },
      crosshair: { mode: 0 },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up, downColor: COLORS.down, borderVisible: false,
      wickUpColor: COLORS.up, wickDownColor: COLORS.down,
    });
    candles.setData(bars.map((b) => ({
      time: b.date, open: b.open, high: b.high, low: b.low, close: b.close,
    })));

    const vol = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false,
    });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(bars.map((b) => ({
      time: b.date, value: b.volume,
      color: (b.close >= b.open ? COLORS.up : COLORS.down) + "66",
    })));

    const closes = bars.map((b) => b.close);
    for (const def of MA_DEFS) {
      const vals = sma(closes, def.n);
      const data = [];
      for (let i = 0; i < bars.length; i++) if (vals[i] != null) data.push({ time: bars[i].date, value: vals[i] });
      if (data.length < 2) continue;
      const line = chart.addSeries(LineSeries, {
        color: COLORS[def.key], lineWidth: def.n >= 150 ? 2 : 1,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      line.setData(data);
    }

    if (analysis) {
      for (const l of (analysis.support || [])) {
        candles.createPriceLine({ price: l.price, color: COLORS.up, lineWidth: 1,
          lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `S ${l.touches}x` });
      }
      for (const l of (analysis.resistance || [])) {
        candles.createPriceLine({ price: l.price, color: COLORS.down, lineWidth: 1,
          lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `R ${l.touches}x` });
      }
      if (analysis.entry) candles.createPriceLine({ price: analysis.entry, color: COLORS.accent, lineWidth: 1, title: "entry" });
      if (analysis.stop) candles.createPriceLine({ price: analysis.stop, color: COLORS.down, lineWidth: 2, title: "stop" });
      if (analysis.target) candles.createPriceLine({ price: analysis.target, color: COLORS.up, lineWidth: 2, title: "3R" });
    }

    if (showMarkers && analysis) {
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
      if (markers.length) createSeriesMarkers(candles, markers);
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (elRef.current) chart.applyOptions({ width: elRef.current.clientWidth });
    });
    ro.observe(elRef.current);

    return () => { ro.disconnect(); chart.remove(); };
  }, [bars, analysis, showMarkers, height]);

  return <div ref={elRef} style={{ width: "100%" }} />;
}
