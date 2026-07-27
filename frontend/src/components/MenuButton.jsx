import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { prefersReducedMotion } from "../lib/motionConfig";
import styles from "./MenuButton.module.css";

/**
 * A "⋯" overflow menu, shared by anything that needs row- or tab-level actions.
 * Follows the same contract as UserMenu (aria-haspopup + role="menu", outside
 * mousedown and Escape to close, motion entrance gated on reduced motion) and
 * adds arrow-key roving focus, since these menus can get long.
 *
 * Children are a render prop receiving `close`, so callers compose their own
 * items with the exported MenuItem / MenuLabel / MenuDivider.
 */
export default function MenuButton({
  label = "More actions",
  align = "end",
  glyph = "⋯",
  className = "",
  children,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        // Return focus to the trigger so keyboard users aren't stranded.
        wrapRef.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Focus the first item on open so the menu is immediately keyboard-operable.
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector('[role="menuitem"]:not([disabled])');
    first?.focus();
  }, [open]);

  const onMenuKeyDown = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || [],
    );
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    const next = e.key === "ArrowDown"
      ? (i + 1) % items.length
      : (i - 1 + items.length) % items.length;
    items[next].focus();
  };

  return (
    <div className={`${styles.wrap} ${className}`} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
      >
        {glyph}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            ref={menuRef}
            className={styles.menu}
            data-align={align}
            role="menu"
            onKeyDown={onMenuKeyDown}
            initial={prefersReducedMotion() ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={prefersReducedMotion() ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -6 }}
            transition={{ duration: prefersReducedMotion() ? 0 : 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            {typeof children === "function" ? children(close) : children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function MenuItem({ onSelect, tone, disabled, children }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={styles.item}
      data-tone={tone}
      disabled={disabled}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

export function MenuLabel({ children }) {
  return <div className={styles.groupLabel}>{children}</div>;
}

export function MenuDivider() {
  return <div className={styles.divider} />;
}
