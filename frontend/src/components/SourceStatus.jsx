import { formatRelativeTime, formatCount } from "../lib/format";
import styles from "./SourceStatus.module.css";

// A small chip per data source: colored dot + name + record count + freshness.
export default function SourceStatus({ sources }) {
  if (!sources || sources.length === 0) {
    return (
      <div className={styles.chip} data-state="idle">
        <span className={styles.dot} />
        <span className={styles.name}>no sources yet</span>
      </div>
    );
  }

  return (
    <div className={styles.row}>
      {sources.map((s) => {
        // "ok" or "ok (fallback: …)" — a fallback tier still delivered real data.
        const ok = s.status === "ok" || s.status.startsWith("ok (");
        const note = ok && s.status.length > 2 ? s.status.slice(3).replace(/^\(|\)$/g, "") : null;
        return (
          <div key={s.source} className={styles.chip} data-state={ok ? "ok" : "error"} title={note || undefined}>
            <span className={styles.dot} />
            <span className={styles.name}>{s.source}</span>
            {ok ? (
              <span className={styles.meta}>
                {formatCount(s.record_count)} · {formatRelativeTime(s.last_refreshed_at)}
              </span>
            ) : (
              <span className={styles.meta} title={s.status}>
                {s.status}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
