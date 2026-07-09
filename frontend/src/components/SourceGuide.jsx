import { formatRelativeTime, formatCount } from "../lib/format";
import { SOURCE_META, SOURCE_ORDER, sourceState, sourceNote } from "../lib/sources";
import styles from "./SourceGuide.module.css";

// The source directory: every external feed the dashboard pulls, its upstream provider,
// and whether it last responded. Joins the static SOURCE_META to live /api/sources status.
export default function SourceGuide({ sources }) {
  const byName = new Map((sources || []).map((s) => [s.source, s]));

  return (
    <ul className={styles.list}>
      {SOURCE_ORDER.map((key) => {
        const meta = SOURCE_META[key];
        const status = byName.get(key);
        const state = status ? sourceState(status.status) : "idle";
        const note = status ? sourceNote(status.status) : null;
        return (
          <li key={key} className={styles.row} data-state={state}>
            <span className={styles.dot} title={note || undefined} />
            <span className={styles.text}>
              <span className={styles.name}>
                {meta.label}
                <span className={styles.provider}>{meta.provider}</span>
              </span>
              <span className={styles.blurb}>{meta.blurb}</span>
            </span>
            <span className={styles.meta}>
              {!status ? (
                "no data yet"
              ) : state === "ok" ? (
                <>
                  {formatCount(status.record_count)} · {formatRelativeTime(status.last_refreshed_at)}
                </>
              ) : (
                <span className={styles.err} title={status.status}>{status.status}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
