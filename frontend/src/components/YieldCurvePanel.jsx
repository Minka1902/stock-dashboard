import {
  LineChart,
  Line,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
  YAxis,
} from "recharts";
import Icon from "./Icon";
import Skeleton from "./Skeleton";
import styles from "./YieldCurvePanel.module.css";

const TOOLTIP_STYLE = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  fontSize: "12px",
  color: "var(--text)",
  padding: "6px 10px",
};

export default function YieldCurvePanel({ data, loading, busy, onRefresh }) {
  const showEmpty = !loading && data.length === 0;
  const latest = data.length > 0 ? data[data.length - 1] : null;
  const spread = latest?.spread ?? null;
  const spreadBps = spread !== null ? (spread * 100).toFixed(0) : null;
  const tone = spread === null ? "neutral" : spread >= 0 ? "positive" : "negative";

  const chartData = data.map((p) => ({ date: p.date, spread: p.spread }));

  return (
    <section className={styles.panel} id="yield-curve">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>US Treasury Yield Curve</h2>
          <p className={styles.subtitle}>
            10yr − 2yr spread · negative = inverted · normalization often precedes a boom
          </p>
        </div>
        {latest && !loading && (
          <span className={styles.spreadBadge} data-tone={tone}>
            {spreadBps !== null ? `${spread >= 0 ? "+" : ""}${spreadBps} bps` : "—"}
          </span>
        )}
      </header>

      {loading ? (
        <div className={styles.loadWrap}>
          <Skeleton w="100%" h="80px" />
          <div className={styles.chips}>
            <Skeleton w="80px" h="36px" />
            <Skeleton w="80px" h="36px" />
            <Skeleton w="80px" h="36px" />
          </div>
        </div>
      ) : showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="trending" size={24} /></span>
          <p className={styles.emptyTitle}>No yield curve data loaded yet</p>
          <button className={styles.emptyBtn} onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      ) : (
        <>
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={80}>
              <LineChart data={chartData} margin={{ top: 6, right: 16, bottom: 6, left: 0 }}>
                <YAxis
                  width={42}
                  tickFormatter={(v) => `${v.toFixed(1)}%`}
                  tick={{ fontSize: 10, fill: "var(--text-faint)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <ReferenceLine
                  y={0}
                  stroke="var(--negative)"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
                <Line
                  type="monotone"
                  dataKey="spread"
                  dot={false}
                  strokeWidth={2}
                  stroke="var(--accent)"
                  isAnimationActive={false}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v) => [`${v != null ? v.toFixed(2) : "—"}%`, "Spread"]}
                  labelFormatter={(l) => l}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {latest && (
            <div className={styles.chips}>
              <div className={styles.chip}>
                <span className={styles.chipLabel}>2yr</span>
                <span className={styles.chipValue}>{latest.yr2 != null ? `${latest.yr2.toFixed(2)}%` : "—"}</span>
              </div>
              <div className={styles.chip}>
                <span className={styles.chipLabel}>10yr</span>
                <span className={styles.chipValue}>{latest.yr10 != null ? `${latest.yr10.toFixed(2)}%` : "—"}</span>
              </div>
              <div className={styles.chip}>
                <span className={styles.chipLabel}>30yr</span>
                <span className={styles.chipValue}>{latest.yr30 != null ? `${latest.yr30.toFixed(2)}%` : "—"}</span>
              </div>
              <div className={styles.chip}>
                <span className={styles.chipLabel}>As of</span>
                <span className={styles.chipValue}>{latest.date}</span>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
