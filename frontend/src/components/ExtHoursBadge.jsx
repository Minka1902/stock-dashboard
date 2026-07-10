import styles from "./ExtHoursBadge.module.css";

/**
 * Pre-market / after-hours badge for a live quote. Renders nothing during
 * regular hours or when closed. Shows the extended-hours change % when known.
 */
export default function ExtHoursBadge({ quote, showChange = true }) {
  const state = quote?.market_state;
  if (state !== "PRE" && state !== "POST") return null;
  const label = state === "PRE" ? "PRE" : "AH";
  const chg = quote.extended_change_pct;
  return (
    <span className={styles.badge} data-state={state} title={state === "PRE" ? "Pre-market" : "After hours"}>
      {label}
      {showChange && chg != null && (
        <em className={styles.chg} data-tone={chg >= 0 ? "pos" : "neg"}>
          {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
        </em>
      )}
    </span>
  );
}
