import GLOSSARY from "../lib/glossary";
import styles from "./InfoTip.module.css";

// Small accessible "i" affordance that reveals a plain-language definition for a
// glossary term on hover/focus. Renders nothing for an unknown term.
export default function InfoTip({ term, size = 16 }) {
  const entry = GLOSSARY[term];
  if (!entry) return null;
  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={styles.btn}
        aria-label={`What is ${entry.label}?`}
        title={`${entry.label}: ${entry.short}`}
        style={{ width: size, height: size }}
      >
        i
      </button>
      <span role="tooltip" className={styles.pop}>
        <strong className={styles.popTitle}>{entry.label}</strong>
        <span>{entry.short}</span>
      </span>
    </span>
  );
}
