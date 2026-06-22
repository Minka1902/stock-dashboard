import Icon from "./Icon";
import Skeleton from "./Skeleton";
import { formatRelativeTime } from "../lib/format";
import styles from "./ShortPanel.module.css";

function SkeletonRows({ rows = 6 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i}>
      <td><Skeleton w="52px" /></td>
      <td><Skeleton w="64px" /></td>
      <td><Skeleton w="56px" /></td>
      <td><Skeleton w="70px" /></td>
      <td><Skeleton w="60px" /></td>
    </tr>
  ));
}

function FreshnessCell({ fetched_at }) {
  const text = formatRelativeTime(fetched_at);
  const hrAgo = (Date.now() - new Date(fetched_at).getTime()) / 3600000;
  const tone = hrAgo < 1 ? "fresh" : hrAgo < 6 ? "mid" : "stale";
  return <span className={styles.freshness} data-tone={tone}>{text}</span>;
}

function fmtPct(v) {
  if (v == null) return "—";
  return (v * 100).toFixed(1) + "%";
}

function fmtNum(v) {
  if (v == null) return "—";
  return v.toLocaleString();
}

function fmtCover(v) {
  if (v == null) return "—";
  return v.toFixed(1) + "d";
}

export default function ShortPanel({ data, loading, busy, onRefresh }) {
  const showEmpty = !loading && data.length === 0;

  return (
    <section className={styles.panel} id="short-interest">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Short Interest</h2>
          <p className={styles.subtitle}>Yahoo Finance · shares short &amp; days to cover per watchlist ticker</p>
        </div>
      </header>

      {showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="trending" size={24} /></span>
          <p className={styles.emptyTitle}>No short interest data loaded yet</p>
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
                <th>Short % Float</th>
                <th>Days to Cover</th>
                <th>Squeeze</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows />
              ) : (
                data.map((s) => (
                  <tr key={s.ticker}>
                    <td><span className={styles.ticker}>{s.ticker}</span></td>
                    <td className={styles.num}>{fmtPct(s.short_pct_float)}</td>
                    <td className={styles.num}>{fmtCover(s.days_to_cover)}</td>
                    <td>
                      {s.squeeze_flag ? (
                        <span className={styles.badge} data-tone="squeeze">Squeeze</span>
                      ) : (
                        <span className={styles.badge}>Normal</span>
                      )}
                    </td>
                    <td><FreshnessCell fetched_at={s.fetched_at} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
