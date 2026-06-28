import { useEffect, useState } from "react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import Icon from "./Icon";
import ViewAll from "./ViewAll";
import CollapseToggle from "./CollapseToggle";
import { getBoomScoreHistory } from "../api";
import styles from "./BoomScorePanel.module.css";

const COMPACT_LIMIT = 5;

const CHIP_META = {
  // bullish
  golden_cross:           { label: "Golden ✕",      tone: "bull", horizon: "M", tip: "MA50 crossed above MA200 — medium-term uptrend" },
  insider_cluster_buy:    { label: "Insider Buy",    tone: "bull", horizon: "M", tip: "≥2 open-market insider purchases in last 30 days" },
  congress_buy:           { label: "Congress Buy",   tone: "bull", horizon: "L", tip: "Congressional purchase — weighted by amount & recency" },
  analyst_upgrade:        { label: "Analyst Up",     tone: "bull", horizon: "M", tip: "Recent analyst upgrade or initiation" },
  near_52w_high:          { label: "52W Break",      tone: "bull", horizon: "S", tip: "Price within 3% of 52-week high — breakout territory" },
  macd_crossover:         { label: "MACD ✕",         tone: "bull", horizon: "S", tip: "MACD line crossed above signal line — momentum shift" },
  volume_confirmed:       { label: "Vol Confirm",    tone: "bull", horizon: "S", tip: "Price rising on 1.5× average volume — institutional participation" },
  short_squeeze:          { label: "Squeeze Risk",   tone: "bull", horizon: "S", tip: "Short float > 15% — squeeze potential if price rises" },
  wsb_rising:             { label: "WSB↑",           tone: "bull", horizon: "S", tip: "Rising Reddit/WSB mention rank in last 24 hours" },
  rsi_recovery:           { label: "RSI Zone",       tone: "bull", horizon: "S", tip: "RSI 30–50 — oversold recovery zone" },
  fear_greed_contrarian:  { label: "Fear Extreme",   tone: "bull", horizon: "M", tip: "Fear & Greed < 25 — extreme fear historically marks entry points" },
  yield_uninversion:      { label: "Curve Norm",     tone: "bull", horizon: "L", tip: "Yield curve un-inverted in last 30 days — historically bullish 6–18 months out" },
  contracts_catalyst:     { label: "Gov Contract",   tone: "bull", horizon: "M", tip: "Major federal contract (>$100M) awarded in last 30 days" },
  seasonal_tailwind:      { label: "Seasonal ↑",     tone: "bull", horizon: "M", tip: "Strong historical edge for the coming week (avg ≥ +2%, win-rate ≥ 60% over 10y)" },
  // bearish
  death_cross:            { label: "Death ✕",        tone: "bear", horizon: "M", tip: "MA50 dropped below MA200 — medium-term downtrend" },
  insider_cluster_sell:   { label: "Insider Dump",   tone: "bear", horizon: "M", tip: "≥2 open-market insider sales in last 30 days" },
  overbought_rsi:         { label: "Overbought",     tone: "bear", horizon: "S", tip: "RSI > 70 — overbought, pullback risk" },
  congress_sale:          { label: "Congress Sell",  tone: "bear", horizon: "L", tip: "Congressional sale — legislators reducing position" },
  analyst_downgrade_cluster: { label: "Downgrades", tone: "bear", horizon: "M", tip: "≥2 analyst downgrades in last 30 days" },
  extreme_greed:          { label: "Greed Extreme",  tone: "bear", horizon: "S", tip: "Fear & Greed > 78 — euphoria precedes distribution" },
};

const HORIZON_TIP = { S: "Short (days–weeks)", M: "Medium (weeks–months)", L: "Long (months+)" };

function convictionTier(score) {
  if (score >= 76) return { label: "Strong Setup",    tone: "high" };
  if (score >= 51) return { label: "High Conviction", tone: "mid" };
  if (score >= 26) return { label: "Interesting",     tone: "low" };
  if (score >= 0)  return { label: "Watching",        tone: "faint" };
  return               { label: "Bearish Signals",   tone: "neg" };
}

function ScoreSparkline({ ticker }) {
  const [history, setHistory] = useState([]);
  useEffect(() => {
    getBoomScoreHistory(ticker).then(setHistory).catch(() => {});
  }, [ticker]);
  if (history.length < 2) return null;
  const data = history.map((h, i) => ({ i, v: h.score }));
  return (
    <span className={styles.sparkWrap}>
      <ResponsiveContainer width={60} height={20}>
        <LineChart data={data}>
          <Line type="monotone" dataKey="v" dot={false} strokeWidth={1.5}
                stroke="var(--accent)" isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </span>
  );
}

export default function BoomScorePanel({ data, loading, busy, onRefresh, compact = false, onViewAll, collapsible = false, collapsed = false, onToggleCollapse }) {
  const showEmpty = !loading && data.length === 0;
  const rows = compact ? data.slice(0, COMPACT_LIMIT) : data;

  return (
    <section className={styles.panel} id="boom-score">
      <header className={styles.head}>
        {collapsible && <CollapseToggle collapsed={collapsed} onClick={onToggleCollapse} label="Boom Score" />}
        <div>
          <h2 className={styles.title}>Boom Score</h2>
          <p className={styles.subtitle}>
            Composite signal strength · bullish &amp; bearish · ranked by conviction
          </p>
        </div>
        {compact && onViewAll && <ViewAll onClick={onViewAll} />}
      </header>

      {!collapsed && (showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="spark" size={24} /></span>
          <p className={styles.emptyTitle}>Add tickers to your watchlist</p>
          <p className={styles.emptyHint}>Scores compute automatically once data is loaded.</p>
          <button className={styles.emptyBtn} onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      ) : (
        <ul className={styles.list}>
          {rows.map((s, idx) => {
            const components = (() => {
              try { return JSON.parse(s.components); } catch { return {}; }
            })();
            const firedKeys = Object.keys(components);
            const tier = convictionTier(s.score);
            const barWidth = Math.max(0, Math.min(100, s.score));

            return (
              <li key={s.ticker} className={styles.row}>
                <span className={styles.rank}>{idx + 1}</span>

                <span className={styles.ticker}>
                  {s.ticker}
                  {s.earnings_soon && (
                    <span className={styles.earningsWarn} title="Earnings within 7 days — high event risk">⚠</span>
                  )}
                </span>

                <div className={styles.barWrap}>
                  <div className={styles.bar} data-tone={tier.tone} style={{ width: `${barWidth}%` }} />
                </div>

                <span className={styles.scoreBadge} data-tone={tier.tone}>
                  {s.score}
                </span>

                <span className={styles.tier} data-tone={tier.tone}>{tier.label}</span>

                <ScoreSparkline ticker={s.ticker} />

                {s.mixed_signals && (
                  <span className={styles.mixedWarn} title="Conflicting bullish and bearish signals — research further">⚡</span>
                )}

                <div className={styles.chips}>
                  {firedKeys.map((key) => {
                    const meta = CHIP_META[key];
                    if (!meta) return null;
                    const tip = meta.tip + ` · ${HORIZON_TIP[meta.horizon]}`;
                    return (
                      <span key={key} className={styles.chip} data-tone={meta.tone} title={tip}>
                        {meta.label}
                        <span className={styles.horizon}>{meta.horizon}</span>
                      </span>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      ))}
    </section>
  );
}
