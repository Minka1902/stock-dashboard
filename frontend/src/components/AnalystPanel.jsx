import Icon from "./Icon";
import Skeleton from "./Skeleton";
import { formatDate, formatRelativeTime, freshnessTone } from "../lib/format";
import styles from "./AnalystPanel.module.css";

function SkeletonRows({ rows = 6 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i}>
      <td><Skeleton w="52px" /></td>
      <td><Skeleton w="76px" /></td>
      <td><Skeleton w="32px" /></td>
      <td><Skeleton w="32px" /></td>
      <td><Skeleton w="32px" /></td>
      <td><Skeleton w="32px" /></td>
      <td><Skeleton w="56px" /></td>
      <td><Skeleton w="80px" /></td>
      <td><Skeleton w="60px" /></td>
    </tr>
  ));
}

function FreshnessCell({ fetched_at }) {
  const text = formatRelativeTime(fetched_at);
  const tone = freshnessTone(fetched_at);
  return <span className={styles.freshness} data-tone={tone}>{text}</span>;
}

function actionTone(action) {
  if (!action) return "neutral";
  const a = action.toLowerCase();
  if (a === "up" || a === "init" || a === "reit") return "buy";
  if (a === "down") return "sell";
  return "neutral";
}

function actionLabel(action) {
  if (!action) return "—";
  const map = { up: "Upgrade", down: "Downgrade", init: "Initiate", reit: "Reiterate" };
  return map[action.toLowerCase()] ?? action;
}

export default function AnalystPanel({ data, loading, busy, onRefresh }) {
  const showEmpty = !loading && data.length === 0;

  return (
    <section className={styles.panel} id="analyst">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Analyst Ratings</h2>
          <p className={styles.subtitle}>Yahoo Finance · current consensus &amp; recent upgrades/downgrades</p>
        </div>
      </header>

      {showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="star" size={24} /></span>
          <p className={styles.emptyTitle}>No analyst data loaded yet</p>
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
                <th>Next Earnings</th>
                <th>Str Buy</th>
                <th>Buy</th>
                <th>Hold</th>
                <th>Sell</th>
                <th>Latest</th>
                <th>Firm</th>
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
                    <td className={styles.muted}>{s.next_earnings ? formatDate(s.next_earnings) : "—"}</td>
                    <td className={styles.num}>{s.rec_strong_buy ?? "—"}</td>
                    <td className={styles.num}>{s.rec_buy ?? "—"}</td>
                    <td className={styles.num}>{s.rec_hold ?? "—"}</td>
                    <td className={styles.num}>{s.rec_sell ?? "—"}</td>
                    <td>
                      <span className={styles.badge} data-tone={actionTone(s.latest_action)}>
                        {actionLabel(s.latest_action)}
                      </span>
                    </td>
                    <td className={styles.firm}>{s.latest_firm || "—"}</td>
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
