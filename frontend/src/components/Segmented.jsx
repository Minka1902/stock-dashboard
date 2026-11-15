import { useEffect, useId, useRef } from "react";
import { motion } from "motion/react";
import { prefersReducedMotion } from "../lib/motionConfig";
import ScrollHint from "./ScrollHint";
import Tooltip from "./Tooltip";
import styles from "./Segmented.module.css";

/**
 * A keyboard-navigable tablist with a sliding active indicator.
 *
 * Roving tabindex: only the selected tab is in the tab order, and Arrow keys
 * move between options. That's the WAI-ARIA tabs pattern — with plain buttons,
 * a long strip forces a keyboard user to Tab through every option to reach the
 * content.
 *
 * The indicator is one element shared across tabs via layoutId, so Motion
 * animates it between positions instead of cross-fading a per-tab background.
 *
 * `overflow="scroll"`: on a phone (640px and below) the strip stays one row
 * that scrolls sideways behind a ScrollHint fade, with the selected option
 * kept in view; wider, it wraps as usual.
 *
 * @param options [{ value, label, title?, badge? }]
 */
export default function Segmented({
  options, value, onChange, ariaLabel, className = "", overflow = "wrap",
}) {
  const groupId = useId();
  const ref = useRef(null);
  const scrolls = overflow === "scroll";

  useEffect(() => {
    const strip = ref.current;
    const scroller = strip?.parentElement;
    const tab = strip?.querySelector('[aria-selected="true"]');
    if (!scrolls || !scroller || !tab || scroller.scrollWidth <= scroller.clientWidth) return;
    const s = scroller.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    const pad = 24;
    if (t.left < s.left + pad) scroller.scrollLeft -= s.left + pad - t.left;
    else if (t.right > s.right - pad) scroller.scrollLeft += t.right - (s.right - pad);
  }, [scrolls, value]);

  const move = (delta) => {
    const idx = options.findIndex((o) => o.value === value);
    if (idx < 0) return;
    const next = options[(idx + delta + options.length) % options.length];
    onChange(next.value);
    // Follow the selection with focus, or the arrow keys stop working after the
    // first press (the old button loses focus when it leaves the tab order).
    requestAnimationFrame(() => {
      ref.current?.querySelector(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
    });
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(1); }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    if (e.key === "Home") { e.preventDefault(); onChange(options[0].value); }
    if (e.key === "End") { e.preventDefault(); onChange(options[options.length - 1].value); }
  };

  const strip = (
    <div
      ref={ref}
      role="tablist"
      aria-label={ariaLabel}
      className={`${styles.group} ${className}`}
      data-overflow={overflow}
      onKeyDown={onKeyDown}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Tooltip key={o.value} content={o.title} side="bottom">
          <button
            type="button"
            role="tab"
            data-value={o.value}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={styles.tab}
            data-active={selected ? "yes" : "no"}
            onClick={() => onChange(o.value)}
          >
            {selected && (
              <motion.span
                layoutId={`segmented-${groupId}`}
                className={styles.indicator}
                transition={prefersReducedMotion()
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className={styles.label}>{o.label}</span>
            {o.badge != null && <span className={styles.badge}>{o.badge}</span>}
          </button>
          </Tooltip>
        );
      })}
    </div>
  );
  return scrolls ? <ScrollHint className={styles.scroller}>{strip}</ScrollHint> : strip;
}
