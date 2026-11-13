import { useLayoutEffect, useRef, useState } from "react";
import styles from "./Clamp.module.css";

/**
 * Content cut to `lines` lines with a More / Less toggle, shown only when
 * something is actually cut. Inactive (`active={false}`), it is a plain
 * `<span className>` around the children, so a caller can clamp on a phone
 * and leave the wider layout untouched.
 */
export default function Clamp({ active = true, lines = 2, className = "", label, children }) {
  const textRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!active || open || !el) return undefined;
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, open]);

  if (!active) return <span className={className}>{children}</span>;
  return (
    <span className={`${className} ${styles.clamp}`}>
      <span ref={textRef} className={styles.text} data-open={open ? "yes" : "no"} style={{ "--lines": lines }}>
        {children}
      </span>
      {(cut || open) && (
        <button type="button" className={styles.toggle} aria-expanded={open}
                aria-label={`${open ? "Less" : "More"}${label ? `: ${label}` : ""}`}
                onClick={() => setOpen((o) => !o)}>
          {open ? "Less" : "More"}
        </button>
      )}
    </span>
  );
}
