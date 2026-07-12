import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Icon from "./Icon";
import AlertsBell from "./AlertsBell";
import UserMenu from "./UserMenu";
import { formatRelativeTime } from "../lib/format";
import { prefersReducedMotion } from "../lib/motionConfig";
import styles from "./TopBar.module.css";

// Theme switcher: a trigger button + motion popover of the available themes,
// each with a two-tone preview swatch.
function ThemeMenu({ theme, themes, onSetTheme }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const isLight = theme === "light" || theme === "warm";
  return (
    <div className={styles.themeWrap} ref={ref}>
      <button
        className={styles.iconBtn}
        onClick={() => setOpen((o) => !o)}
        title="Change theme"
        aria-label="Change theme"
        aria-haspopup="menu"
        aria-expanded={open}
        data-active={open ? "yes" : "no"}
      >
        <Icon name={isLight ? "sun" : "moon"} size={17} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className={styles.themeMenu}
            role="menu"
            initial={prefersReducedMotion() ? false : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={prefersReducedMotion() ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={prefersReducedMotion() ? { duration: 0 } : { duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            {themes.map((t) => (
              <button
                key={t.key}
                type="button"
                role="menuitemradio"
                aria-checked={t.key === theme}
                className={styles.themeItem}
                data-active={t.key === theme ? "yes" : "no"}
                onClick={() => { onSetTheme(t.key); setOpen(false); }}
              >
                <span
                  className={styles.themeSwatch}
                  style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 0 50%, ${t.swatch[1]} 50% 100%)` }}
                  aria-hidden="true"
                />
                <span className={styles.themeItemText}>
                  <span className={styles.themeItemLabel}>{t.label}</span>
                  <span className={styles.themeItemHint}>{t.hint}</span>
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const LEAN_LABEL = {
  GREEDY: "Greedy",
  FEARFUL: "Fearful",
  NEUTRAL: "Neutral",
  RISK_ON: "Risk on",
  RISK_OFF: "Risk off",
};

export default function TopBar({
  title, sources, busy, onRefresh, theme, onSetTheme, themes = [],
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
        <ThemeMenu theme={theme} themes={themes} onSetTheme={onSetTheme} />
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
