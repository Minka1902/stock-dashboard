import ScrollHint from "./ScrollHint";
import { PHONE, useMediaQuery } from "../hooks/useMediaQuery";
import styles from "./ScrollRow.module.css";

/**
 * Controls that sit in their parent's layout wider than a phone and, on a
 * phone, stay one row that scrolls sideways behind a ScrollHint fade. Wider
 * it adds no element, so the desktop layout is the parent's alone.
 * `className` styles the phone row (e.g. its padding).
 */
export default function ScrollRow({ className = "", children }) {
  const phone = useMediaQuery(PHONE);
  if (!phone) return children;
  return <ScrollHint className={`${styles.row} ${className}`}>{children}</ScrollHint>;
}
