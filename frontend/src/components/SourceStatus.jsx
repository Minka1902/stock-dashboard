import { sourceState, SOURCE_META } from "../lib/sources";
import styles from "./SourceStatus.module.css";

// A compact strip flagging only the data sources that failed to respond. When every
// source is healthy this renders nothing — the full directory lives in Settings →
// Data sources. Never invents data: a red chip means the source recorded an error.
export default function SourceStatus({ sources }) {
  const failed = (sources || []).filter((s) => sourceState(s.status) === "error");
  if (failed.length === 0) return null;

  return (
    <div className={styles.row}>
      <span className={styles.label}>Not responding</span>
      {failed.map((s) => {
        const name = SOURCE_META[s.source]?.label || s.source;
        return (
          <div key={s.source} className={styles.chip} data-state="error" title={s.status}>
            <span className={styles.dot} />
            <span className={styles.name}>{name}</span>
            <span className={styles.meta}>{s.status}</span>
          </div>
        );
      })}
    </div>
  );
}
