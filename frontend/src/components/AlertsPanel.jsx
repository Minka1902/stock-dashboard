import { useEffect } from "react";
import Icon from "./Icon";
import { formatRelativeTime } from "../lib/format";
import styles from "./AlertsPanel.module.css";

const TYPE_ICON = {
  boom_cross: "spark",
  golden_cross: "trending",
  insider_cluster: "trending",
  earnings_soon: "calendar",
  congress_buy: "layers",
};

export default function AlertsPanel({ alerts, onMarkRead }) {
  // Opening the panel clears the unread badge.
  useEffect(() => {
    if (alerts.some((a) => !a.read)) onMarkRead?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className={styles.panel} id="alerts">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Alerts</h2>
          <p className={styles.subtitle}>
            Notable changes the moment they happen — score crossings, golden crosses, clusters, and earnings risk.
          </p>
        </div>
      </header>

      {alerts.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="bell" size={24} /></span>
          <p className={styles.emptyTitle}>No alerts yet</p>
          <p className={styles.emptyText}>
            Alerts appear here as your watchlist signals change.
          </p>
        </div>
      ) : (
        <ul className={styles.list}>
          {alerts.map((a) => (
            <li key={a.dedup_key} className={styles.item} data-unread={a.read ? "no" : "yes"}>
              <span className={styles.icon} data-sev={a.severity}>
                <Icon name={TYPE_ICON[a.type] || "bell"} size={16} />
              </span>
              <div className={styles.text}>
                <div className={styles.line1}>
                  <span className={styles.symbol}>{a.ticker}</span>
                  <span className={styles.alertTitle}>{a.title}</span>
                  <span className={styles.sev} data-sev={a.severity}>{a.severity}</span>
                </div>
                <p className={styles.message}>{a.message}</p>
              </div>
              <span className={styles.time}>{formatRelativeTime(a.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
