import { LineChart, Line, ResponsiveContainer } from "recharts";
import DataTable from "./DataTable";
import Icon from "./Icon";
import ViewAll from "./ViewAll";
import CollapseToggle from "./CollapseToggle";
import { currencyForSymbol, formatMoney, formatRelativeTime, freshnessTone } from "../lib/format";

// Per-row prices in the ticker's own currency (₪ for Tel Aviv listings).
const BLURB = "RSI · MACD · moving averages · volume · 52-week range · per watchlist ticker";
const money = (v, t) => formatMoney(v, currencyForSymbol(t) || "USD", { compact: true });
import styles from "./TechnicalPanel.module.css";
import Tooltip from "./Tooltip";
import Term from "./Term";
import { freshnessTip } from "../lib/freshness";
import PanelInfo from "./PanelInfo";

const COMPACT_LIMIT = 5;
const priceCol = (key, label, field) => ({
  key, label, caption: typeof label === "string" ? label : undefined, className: styles.num, cellClassName: "tabular",
  skeleton: "52px", render: (s) => (s[field] != null ? money(s[field], s.ticker) : "—"),
});

const COLUMNS = [
  { key: "ticker", label: "Ticker", cellClassName: styles.ticker, phone: "title", skeleton: "50px",
    render: (s) => s.ticker },
  { ...priceCol("price", "Price", "price"), phone: "value" },
  { key: "chg", caption: "Chg%", label: <Term tip="Change since the previous close, in percent">Chg%</Term>,
    className: styles.num, cellClassName: "tabular", phone: "value", skeleton: "44px",
    tone: (s) => (s.change_pct == null ? null : s.change_pct >= 0 ? "pos" : "neg"),
    render: (s) => (s.change_pct != null ? (
      <span data-tone={s.change_pct >= 0 ? "pos" : "neg"} className={styles.chg}>
        {s.change_pct >= 0 ? "+" : ""}{s.change_pct.toFixed(2)}%
      </span>
    ) : "—") },
  { key: "rsi", caption: "RSI14", label: <Term term="rsi" tip="Computed over 14 days.">RSI14</Term>,
    className: styles.num, skeleton: "38px", render: (s) => <RsiCell rsi={s.rsi14} /> },
  { ...priceCol("ma50", <Term term="moving_average" tip="MA50: the 50-day average.">MA50</Term>, "ma50"), caption: "MA50" },
  { ...priceCol("ma200", <Term term="moving_average" tip="MA200: the 200-day average.">MA200</Term>, "ma200"),
    caption: "MA200" },
  { key: "cross", caption: "Cross", phone: "subtitle", skeleton: "56px",
    label: <Term tip="Golden: MA50 is above MA200 (uptrend). Death: MA50 is below MA200 (downtrend).">Cross</Term>,
    render: (s) => <CrossCell golden_cross={s.golden_cross} /> },
  { key: "macd", caption: "MACD", skeleton: "64px",
    label: <Term term="macd" tip="Shows “Crossover” when it just crossed its signal line; otherwise the MACD value.">MACD</Term>,
    render: (s) => <MacdCell macd_crossover={s.macd_crossover} macd={s.macd} /> },
  { key: "vol", caption: "Vol ratio", label: <Term term="relative_volume">Vol Ratio</Term>, className: styles.num,
    skeleton: "40px", render: (s) => <VolCell rel_volume={s.rel_volume} /> },
  { ...priceCol("hi", <Term tip="Highest price in the last 52 weeks">52W Hi</Term>, "high_52w"), caption: "52W hi" },
  { ...priceCol("lo", <Term tip="Lowest price in the last 52 weeks">52W Lo</Term>, "low_52w"), caption: "52W lo" },
  { key: "trend", caption: "Trend", skeleton: "60px",
    label: <Term tip="Recent closing prices; green if the last is above the first">Trend</Term>,
    render: (s) => <MiniSparkline pricesJson={s.prices_json} /> },
  { key: "updated", label: "Updated", skeleton: "56px", render: (s) => <FreshnessCell fetched_at={s.fetched_at} /> },
];

function RsiCell({ rsi }) {
  if (rsi == null) return <span className={styles.muted}>—</span>;
  const tone = rsi < 30 ? "oversold" : rsi > 70 ? "overbought" : "neutral";
  const read = tone === "oversold" ? "below 30: oversold" : tone === "overbought" ? "above 70: overbought" : "between 30 and 70";
  return (
    <Tooltip content={`RSI ${rsi.toFixed(1)} — ${read}`}>
      <span className={styles.rsi} data-tone={tone}>{rsi.toFixed(1)}</span>
    </Tooltip>
  );
}

function CrossCell({ golden_cross }) {
  if (golden_cross == null) return <span className={styles.muted}>—</span>;
  return (
    <span className={styles.badge} data-tone={golden_cross ? "buy" : "sell"}>
      {golden_cross ? "Golden" : "Death"}
    </span>
  );
}

function MacdCell({ macd_crossover, macd }) {
  if (macd == null) return <span className={styles.muted}>—</span>;
  if (macd_crossover) {
    return <span className={styles.badge} data-tone="buy">Crossover</span>;
  }
  const tone = macd > 0 ? "pos" : "neg";
  return <span className={styles.chg} data-tone={tone}>{macd > 0 ? "+" : ""}{macd.toFixed(2)}</span>;
}

function VolCell({ rel_volume }) {
  if (rel_volume == null) return <span className={styles.muted}>—</span>;
  const tone = rel_volume > 1.5 ? "pos" : rel_volume < 0.7 ? "neg" : "neutral";
  return (
    <Tooltip content={`Today's volume is ${rel_volume.toFixed(1)}× its average. Above 1.5× reads as strong participation.`}>
      <span className={styles.chg} data-tone={tone}>{rel_volume.toFixed(1)}×</span>
    </Tooltip>
  );
}

function FreshnessCell({ fetched_at }) {
  const text = formatRelativeTime(fetched_at);
  const tone = freshnessTone(fetched_at);
  return (
    <Tooltip content={freshnessTip(fetched_at)}>
      <span className={styles.freshness} data-tone={tone}>{text}</span>
    </Tooltip>
  );
}

function MiniSparkline({ pricesJson }) {
  let prices = [];
  try { prices = JSON.parse(pricesJson); } catch { /* empty */ }
  if (prices.length < 2) return <span className={styles.muted}>—</span>;
  const data = prices.map((v, i) => ({ i, v }));
  const last = prices[prices.length - 1];
  const first = prices[0];
  const color = last >= first ? "var(--positive)" : "var(--negative)";
  return (
    <ResponsiveContainer width={60} height={28}>
      <LineChart data={data}>
        <Line type="monotone" dataKey="v" dot={false} strokeWidth={1.5} stroke={color} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function TechnicalPanel({ data, loading, busy, onRefresh, compact = false, onViewAll, collapsible = false, collapsed = false, onToggleCollapse }) {
  const showEmpty = !loading && data.length === 0;

  return (
    <section className={styles.panel} id="signals">
      <header className={styles.head}>
        {collapsible && <CollapseToggle collapsed={collapsed} onClick={onToggleCollapse} label="Technical signals" />}
        <div>
          <h2 className={styles.title}>Technical Signals<PanelInfo label="Technical Signals" blurb={BLURB} /></h2>
          <p className={styles.subtitle}>{BLURB}</p>
        </div>
        {compact && onViewAll && <ViewAll onClick={onViewAll} />}
      </header>

      {!collapsed && (showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="spark" size={24} /></span>
          <p className={styles.emptyTitle}>Add tickers to your watchlist to see signals</p>
          <button className={styles.emptyBtn} onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={data}
          rowKey={(s) => s.ticker}
          limit={compact ? COMPACT_LIMIT : undefined}
          loading={loading}
          skeletonRows={5}
          classes={{ wrap: styles.tableWrap, table: styles.table }}
        />
      ))}
    </section>
  );
}
