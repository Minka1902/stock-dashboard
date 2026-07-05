import styles from "./LiveTicker.module.css";

function changeTone(pct) {
  if (pct == null) return "flat";
  return pct >= 0 ? "pos" : "neg";
}

/** Always-visible strip of live quotes (incl. pre/post-market). */
export default function LiveTicker({ quotes }) {
  if (!quotes || quotes.length === 0) return null;

  return (
    <div className={styles.strip} role="list" aria-label="Live quotes">
      {quotes.map((q) => (
        <div key={q.ticker} className={styles.item} role="listitem">
          <span className={styles.symbol}>{q.ticker}</span>
          <span className={styles.price}>
            {q.price != null ? q.price.toFixed(2) : "—"}
          </span>
          <span className={styles.change} data-tone={changeTone(q.change_pct)}>
            {q.change_pct != null
              ? `${q.change_pct >= 0 ? "+" : ""}${q.change_pct.toFixed(2)}%`
              : "—"}
          </span>
          <span className={styles.badge} data-state={q.market_state}>
            {q.market_state}
          </span>
        </div>
      ))}
    </div>
  );
}
