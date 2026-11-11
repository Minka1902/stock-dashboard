import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { prefersReducedMotion } from "../lib/motionConfig";
import styles from "./Sheet.module.css";

/**
 * The modal layer under Dialog and under every Popover on a phone: a scrim
 * and a raised panel, centred on a desktop and a bottom sheet at 640px and
 * below. Owns the layer, the surface and the motion; the caller sizes the
 * panel (`className`, `style`) and owns its content, focus and keys.
 * `onDismiss` runs on a tap on the scrim.
 */
export default function Sheet({ open, onDismiss, panelRef, className = "", children, ...rest }) {
  const reduced = prefersReducedMotion();

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={styles.layer} key="sheet">
          <motion.div
            className={styles.backdrop}
            onClick={onDismiss}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.18 }}
          />
          <motion.div
            ref={panelRef}
            className={`${styles.panel} ${className}`}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            transition={reduced ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            {...rest}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
