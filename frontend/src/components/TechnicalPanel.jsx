import { LineChart, Line, ResponsiveContainer } from "recharts";
import Icon from "./Icon";
import Skeleton from "./Skeleton";
import ViewAll from "./ViewAll";
import CollapseToggle from "./CollapseToggle";
import { formatCurrencyCompact, formatRelativeTime, freshnessTone } from "../lib/format";
import styles from "./TechnicalPanel.module.css";

const COMPACT_LIMIT = 5;

function RsiCell({ rsi }) {
  if (rsi == null) return <span className={styles.muted}>—</span>;
  const tone = rsi < 30 ? "oversold" : rsi > 70 ? "overbought" : "neutral";
  return <span className={styles.rsi} data-tone={tone}>{rsi.toFixed(1)}</span>;
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
  return <span className={styles.chg} data-tone={tone}>{rel_volume.toFixed(1)}×</span>;
}

function FreshnessCell({ fetched_at }) {
  const text = formatRelativeTime(fetched_at);
  const tone = freshnessTone(fetched_at);
  return <span className={styles.freshness} data-tone={tone}>{text}</span>;
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

function SkeletonRows({ rows = 5 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i}>
      <td><Skeleton w="50px" /></td>
      <td className={styles.num}><Skeleton w="52px" /></td>
      <td className={styles.num}><Skeleton w="44px" /></td>
      <td className={styles.num}><Skeleton w="38px" /></td>
      <td className={styles.num}><Skeleton w="52px" /></td>
      <td className={styles.num}><Skeleton w="52px" /></td>
      <td><Skeleton w="56px" /></td>
      <td><Skeleton w="64px" /></td>
      <td className={styles.num}><Skeleton w="40px" /></td>
      <td className={styles.num}><Skeleton w="52px" /></td>
      <td className={styles.num}><Skeleton w="52px" /></td>
      <td><Skeleton w="60px" /></td>
      <td><Skeleton w="56px" /></td>
    </tr>
  ));
}

export default function TechnicalPanel({ data, loading, busy, onRefresh, compact = false, onViewAll, collapsible = false, collapsed = false, onToggleCollapse }) {
  const showEmpty = !loading && data.length === 0;
  const rows = compact ? data.slice(0, COMPACT_LIMIT) : data;

  return (
    <section className={styles.panel} id="signals">
      <header className={styles.head}>
        {collapsible && <CollapseToggle collapsed={collapsed} onClick={onToggleCollapse} label="Technical signals" />}
        <div>
          <h2 className={styles.title}>Technical Signals</h2>
          <p className={styles.subtitle}>
            RSI · MACD · moving averages · volume · 52-week range · per watchlist ticker
          </p>
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
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Ticker</th>
                <th className={styles.num}>Price</th>
                <th className={styles.num}>Chg%</th>
                <th className={styles.num}>RSI14</th>
                <th className={styles.num}>MA50</th>
                <th className={styles.num}>MA200</th>
                <th>Cross</th>
                <th>MACD</th>
                <th className={styles.num}>Vol Ratio</th>
                <th className={styles.num}>52W Hi</th>
                <th className={styles.num}>52W Lo</th>
                <th>Trend</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows />
              ) : (
                rows.map((s) => (
                  <tr key={s.ticker}>
                    <td className={styles.ticker}>{s.ticker}</td>
                    <td className={`${styles.num} tabular`}>{s.price != null ? formatCurrencyCompact(s.price) : "—"}</td>
                    <td className={`${styles.num} tabular`}>
                      {s.change_pct != null ? (
                        <span data-tone={s.change_pct >= 0 ? "pos" : "neg"} className={styles.chg}>
                          {s.change_pct >= 0 ? "+" : ""}{s.change_pct.toFixed(2)}%
                        </span>
                      ) : "—"}
                    </td>
                    <td className={styles.num}><RsiCell rsi={s.rsi14} /></td>
                    <td className={`${styles.num} tabular`}>{s.ma50 != null ? formatCurrencyCompact(s.ma50) : "—"}</td>
                    <td className={`${styles.num} tabular`}>{s.ma200 != null ? formatCurrencyCompact(s.ma200) : "—"}</td>
                    <td><CrossCell golden_cross={s.golden_cross} /></td>
                    <td><MacdCell macd_crossover={s.macd_crossover} macd={s.macd} /></td>
                    <td className={styles.num}><VolCell rel_volume={s.rel_volume} /></td>
                    <td className={`${styles.num} tabular`}>{s.high_52w != null ? formatCurrencyCompact(s.high_52w) : "—"}</td>
                    <td className={`${styles.num} tabular`}>{s.low_52w != null ? formatCurrencyCompact(s.low_52w) : "—"}</td>
                    <td><MiniSparkline pricesJson={s.prices_json} /></td>
                    <td><FreshnessCell fetched_at={s.fetched_at} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
