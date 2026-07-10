import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Icon from "./Icon";
import { initialsFor, gradientFor } from "../lib/avatar";
import { prefersReducedMotion } from "../lib/motionConfig";
import styles from "./UserMenu.module.css";

/**
 * User identity chip + dropdown, replacing the bare email + logout icon.
 * Avatar initials on a deterministic gradient, the email local part beside it
 * (≥ 960px), and a keyboard-operable menu (Settings / Info / Log out) with an
 * Admin badge for the admin account.
 */
export default function UserMenu({ user, onLogout, onNavigate }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const email = user?.email || "";
  const local = email.includes("@") ? email.split("@")[0] : email;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  const go = (view) => { setOpen(false); onNavigate?.(view); };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Signed in as ${email}`}
      >
        <span className={styles.avatar} style={{ background: gradientFor(email) }} aria-hidden="true">
          {initialsFor(email)}
        </span>
        <span className={styles.local}>{local}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className={styles.menu}
            role="menu"
            initial={prefersReducedMotion() ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={prefersReducedMotion() ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -6 }}
            transition={{ duration: prefersReducedMotion() ? 0 : 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className={styles.identity}>
              <span className={styles.avatarLg} style={{ background: gradientFor(email) }} aria-hidden="true">
                {initialsFor(email)}
              </span>
              <div className={styles.identityText}>
                <span className={styles.fullEmail}>{email}</span>
                {user.is_admin && <span className={styles.adminBadge}>Admin</span>}
              </div>
            </div>

            <div className={styles.divider} />

            <button type="button" role="menuitem" className={styles.item} onClick={() => go("settings")}>
              <Icon name="settings" size={15} /> Settings
            </button>
            <button type="button" role="menuitem" className={styles.item} onClick={() => go("info")}>
              <Icon name="info" size={15} /> Info / Guide
            </button>

            <div className={styles.divider} />

            <button type="button" role="menuitem" className={`${styles.item} ${styles.logout}`} onClick={() => { setOpen(false); onLogout?.(); }}>
              <Icon name="arrowRight" size={15} /> Log out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
