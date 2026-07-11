import styles from "./LiveTicker.module.css";

function tone(pct) {
  if (pct == null) return "flat";
  return pct >= 0 ? "pos" : "neg";
}

function Item({ q }) {
  const t = tone(q.change_pct);
  return (
    <span className={styles.item} role="listitem">
      <span className={styles.symbol}>{q.ticker}</span>
      <span className={styles.price}>{q.price != null ? q.price.toFixed(2) : "—"}</span>
      <span className={styles.change} data-tone={t}>
        <span className={styles.arrow}>{t === "pos" ? "▲" : t === "neg" ? "▼" : "•"}</span>
        {q.change_pct != null ? `${Math.abs(q.change_pct).toFixed(2)}%` : "—"}
      </span>
      {(q.market_state === "PRE" || q.market_state === "POST") && (
        <span className={styles.badge}>{q.market_state}</span>
      )}
    </span>
  );
}

function marketBadge(quotes) {
  const state = quotes.find((q) => q.market_state)?.market_state;
  return state || null;
}

/** Scrolling tape of live quotes (incl. pre/post-market). Pauses on hover; halts under reduce-motion. */
export default function LiveTicker({ quotes, asOf, marketStatus }) {
  if (!quotes || quotes.length === 0) return null;
  // Prefer the backend's clock-based session; fall back to per-quote state.
  const state = marketStatus || marketBadge(quotes);
  const stamp = asOf
    ? new Date(asOf).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  return (
    <div className={styles.tape} role="list" aria-label="Live quotes">
      {stamp && (
        <span className={styles.asOf} data-state={state || "CLOSED"}>
          <span className={styles.dot} aria-hidden="true" />
          {state || "CLOSED"} · {stamp}
        </span>
      )}
      <div className={styles.trackWrap}>
        <div className={styles.track}>
          {quotes.map((q) => <Item key={q.ticker} q={q} />)}
          {/* duplicate for a seamless loop */}
          {quotes.map((q) => <Item key={`${q.ticker}-b`} q={q} />)}
        </div>
      </div>
    </div>
  );
}
