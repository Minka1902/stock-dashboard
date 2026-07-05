import Icon from "./Icon";
import Skeleton from "./Skeleton";
import ViewAll from "./ViewAll";
import CollapseToggle from "./CollapseToggle";
import styles from "./SocialPanel.module.css";

const COMPACT_LIMIT = 5;

function SkeletonRows({ rows = 6 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i}>
      <td><Skeleton w="52px" /></td>
      <td><Skeleton w="40px" /></td>
      <td><Skeleton w="60px" /></td>
      <td><Skeleton w="56px" /></td>
    </tr>
  ));
}

function RankChange({ change }) {
  if (change == null) return <span className={styles.muted}>—</span>;
  if (change > 0) return <span className={styles.rising}>↑{change}</span>;
  if (change < 0) return <span className={styles.falling}>↓{Math.abs(change)}</span>;
  return <span className={styles.muted}>—</span>;
}

export default function SocialPanel({ data, loading, busy, onRefresh, compact = false, onViewAll, collapsible = false, collapsed = false, onToggleCollapse }) {
  const showEmpty = !loading && data.length === 0;
  const rows = compact ? data.slice(0, COMPACT_LIMIT) : data;

  return (
    <section className={styles.panel} id="social">
      <header className={styles.head}>
        {collapsible && <CollapseToggle collapsed={collapsed} onClick={onToggleCollapse} label="WSB Sentiment" />}
        <div>
          <h2 className={styles.title}>WSB Sentiment</h2>
          <p className={styles.subtitle}>ApeWisdom · Reddit mentions &amp; rank movement for watchlist tickers</p>
        </div>
        {compact && onViewAll && <ViewAll onClick={onViewAll} />}
      </header>

      {!collapsed && (showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="news" size={24} /></span>
          <p className={styles.emptyTitle}>No social sentiment data loaded yet</p>
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
                <th>Rank</th>
                <th>Mentions</th>
                <th>Rank Change</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows />
              ) : (
                rows.map((s) => (
                  <tr key={s.ticker}>
                    <td><span className={styles.ticker}>{s.ticker}</span></td>
                    <td className={styles.num}>{s.rank ?? "—"}</td>
                    <td className={styles.num}>{s.mentions != null ? s.mentions.toLocaleString() : "—"}</td>
                    <td><RankChange change={s.rank_change} /></td>
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
