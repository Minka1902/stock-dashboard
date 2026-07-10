import Icon from "./Icon";
import AlertsBell from "./AlertsBell";
import UserMenu from "./UserMenu";
import { formatRelativeTime } from "../lib/format";
import styles from "./TopBar.module.css";

const LEAN_LABEL = {
  GREEDY: "Greedy",
  FEARFUL: "Fearful",
  NEUTRAL: "Neutral",
  RISK_ON: "Risk on",
  RISK_OFF: "Risk off",
};

export default function TopBar({
  title, index, sources, busy, onRefresh, theme, onToggleTheme,
  dyslexia, onToggleDyslexia, lean, alerts = [], unreadAlerts = 0,
  onMarkAlertsRead, onOpenCommand, user, onLogout, onNavigate, hasTour, onStartTour,
}) {
  const refreshed = sources
    .filter((s) => s.last_refreshed_at)
    .sort((a, b) => (a.last_refreshed_at < b.last_refreshed_at ? 1 : -1));
  const latest = refreshed[0];
  const live = latest && (latest.status === "ok" || latest.status.startsWith("ok ("));
  const lastRefresh = latest ? formatRelativeTime(latest.last_refreshed_at) : "never";

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        {index && <span className={styles.index}>{index}</span>}
        <h1 className={styles.title}>{title}</h1>
        <span className={styles.status} data-live={live ? "yes" : "no"}>
          <span className={styles.dot} />
          {live ? "LIVE" : "IDLE"}
          <span className={styles.since}>· {lastRefresh}</span>
        </span>
      </div>

      <div className={styles.actions}>
        {lean && (
          <span className={styles.lean} data-lean={lean}>
            <span className={styles.leanCap}>Lean</span>
            {LEAN_LABEL[lean] || lean}
          </span>
        )}

        <button
          type="button"
          className={styles.cmd}
          onClick={onOpenCommand}
          aria-label="Open command palette and stock search"
          title="Jump to a view, or search any stock (Ctrl/Cmd + K)"
          data-tour="palette"
        >
          <Icon name="command" size={13} />
          <kbd>K</kbd>
        </button>

        <span data-tour="alerts">
          <AlertsBell alerts={alerts} unread={unreadAlerts} onMarkRead={onMarkAlertsRead} />
        </span>

        {hasTour && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onStartTour}
            title="Take a guided tour of this view"
            aria-label="Take a guided tour of this view"
          >
            <span aria-hidden="true" style={{ fontWeight: 700 }}>?</span>
          </button>
        )}

        <button
          className={styles.iconBtn}
          onClick={onToggleDyslexia}
          title={dyslexia ? "Turn off dyslexia-friendly mode" : "Turn on dyslexia-friendly mode"}
          aria-label="Toggle dyslexia-friendly mode"
          aria-pressed={dyslexia}
          data-active={dyslexia ? "yes" : "no"}
        >
          <Icon name="book" size={17} />
        </button>
        <button
          className={styles.iconBtn}
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          aria-label="Toggle theme"
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
        </button>
        <button className={styles.refresh} onClick={onRefresh} disabled={busy} data-tour="refresh">
          <span className={busy ? styles.spin : ""}>
            <Icon name="refresh" size={15} />
          </span>
          {busy ? "Syncing" : "Refresh"}
        </button>

        <UserMenu user={user} onLogout={onLogout} onNavigate={onNavigate} />
      </div>
    </header>
  );
}
