import Icon from "./Icon";
import { formatRelativeTime } from "../lib/format";
import styles from "./TopBar.module.css";

export default function TopBar({ title, sources, busy, onRefresh, theme, onToggleTheme }) {
  // "Live" reflects whether the most recently refreshed source succeeded.
  const refreshed = sources
    .filter((s) => s.last_refreshed_at)
    .sort((a, b) => (a.last_refreshed_at < b.last_refreshed_at ? 1 : -1));
  const latest = refreshed[0];
  const live = latest && latest.status === "ok";
  const lastRefresh = latest ? formatRelativeTime(latest.last_refreshed_at) : "never";

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <h1 className={styles.title}>{title}</h1>
        <span className={styles.status} data-live={live ? "yes" : "no"}>
          <span className={styles.dot} />
          {live ? "Live" : "Idle"} · updated {lastRefresh}
        </span>
      </div>

      <div className={styles.actions}>
        <button
          className={styles.iconBtn}
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          aria-label="Toggle theme"
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
        </button>
        <button className={styles.refresh} onClick={onRefresh} disabled={busy}>
          <span className={busy ? styles.spin : ""}>
            <Icon name="refresh" size={16} />
          </span>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </header>
  );
}
