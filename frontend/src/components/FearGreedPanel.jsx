import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import Icon from "./Icon";
import Skeleton from "./Skeleton";
import ViewAll from "./ViewAll";
import CollapseToggle from "./CollapseToggle";
import styles from "./FearGreedPanel.module.css";

const TOOLTIP_STYLE = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  fontSize: "12px",
  color: "var(--text)",
  padding: "6px 10px",
};

function scoreTone(score) {
  if (score < 30) return "fear";
  if (score > 70) return "greed";
  return "neutral";
}

export default function FearGreedPanel({ data, loading, busy, onRefresh, compact = false, onViewAll, collapsible = false, collapsed = false, onToggleCollapse }) {
  const showEmpty = !loading && data.length === 0;
  const latest = data.length > 0 ? data[data.length - 1] : null;
  const tone = latest ? scoreTone(latest.score) : "neutral";

  const chartData = data.map((s) => ({ date: s.captured_at.slice(0, 10), score: s.score, rating: s.rating }));

  return (
    <section className={styles.panel} id="fear-greed">
      <header className={styles.head}>
        {collapsible && <CollapseToggle collapsed={collapsed} onClick={onToggleCollapse} label="Fear & Greed" />}
        <div>
          <h2 className={styles.title}>Fear &amp; Greed Index</h2>
          <p className={styles.subtitle}>
            CNN composite sentiment · extreme fear (&lt;25) marks historical boom entry points
          </p>
        </div>
        {compact && onViewAll && <ViewAll onClick={onViewAll} />}
      </header>

      {!collapsed && (loading ? (
        <div className={styles.loadWrap}>
          <Skeleton w="80px" h="64px" />
          <Skeleton w="100%" h="60px" />
        </div>
      ) : showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="sun" size={24} /></span>
          <p className={styles.emptyTitle}>No Fear &amp; Greed data loaded yet</p>
          <button className={styles.emptyBtn} onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      ) : (
        <div className={styles.body}>
          {latest && (
            <div className={styles.scoreRow}>
              <span className={styles.score} data-tone={tone}>
                {Math.round(latest.score)}
              </span>
              <div className={styles.scoreInfo}>
                <span className={styles.rating} data-tone={tone}>{latest.rating}</span>
                <span className={styles.scoreSub}>out of 100</span>
                <span className={styles.scoreSub}>{latest.captured_at.slice(0, 10)}</span>
              </div>
            </div>
          )}

          <div className={styles.scaleRow}>
            <span className={styles.scaleLabel}>Extreme Fear</span>
            <div className={styles.scaleBar}>
              {latest && (
                <div
                  className={styles.scaleThumb}
                  style={{ left: `${Math.min(Math.max(latest.score, 2), 98)}%` }}
                  data-tone={tone}
                />
              )}
            </div>
            <span className={styles.scaleLabel}>Extreme Greed</span>
          </div>

          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={64}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                <defs>
                  <linearGradient id="fgGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="score"
                  dot={false}
                  strokeWidth={2}
                  stroke="var(--accent)"
                  fill="url(#fgGrad)"
                  isAnimationActive={false}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v, _n, props) => [
                    `${Math.round(v)} — ${props.payload?.rating ?? ""}`,
                    "Score",
                  ]}
                  labelFormatter={(l) => l}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}
    </section>
  );
}
