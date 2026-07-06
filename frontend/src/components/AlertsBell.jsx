import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { formatRelativeTime } from "../lib/format";
import styles from "./AlertsBell.module.css";

/** Passive unread indicator + popover of recent alerts. No full page. */
export default function AlertsBell({ alerts = [], unread = 0, onMarkRead }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const recent = alerts.slice(0, 8);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.bell}
        onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `Alerts, ${unread} unread` : "Alerts"}
        aria-expanded={open}
        data-unread={unread > 0 ? "yes" : "no"}
      >
        <Icon name="bell" size={17} />
        {unread > 0 && <span className={styles.badge}>{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <div className={styles.pop} role="dialog" aria-label="Recent alerts">
          <div className={styles.popHead}>
            <span className="caption">Alerts</span>
            {unread > 0 && (
              <button type="button" className={styles.markRead} onClick={() => onMarkRead?.()}>
                Mark all read
              </button>
            )}
          </div>
          {recent.length === 0 ? (
            <p className={styles.empty}>No alerts yet. They appear as your signals change.</p>
          ) : (
            <ul className={styles.list}>
              {recent.map((a) => (
                <li key={a.dedup_key} className={styles.item} data-unread={a.read ? "no" : "yes"}>
                  <span className={styles.dot} data-sev={a.severity} />
                  <div className={styles.body}>
                    <div className={styles.line1}>
                      <span className={styles.symbol}>{a.ticker}</span>
                      <span className={styles.title}>{a.title}</span>
                      <span className={styles.time}>{formatRelativeTime(a.created_at)}</span>
                    </div>
                    <p className={styles.message}>{a.message}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
