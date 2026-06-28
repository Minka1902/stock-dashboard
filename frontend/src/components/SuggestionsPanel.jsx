import Icon from "./Icon";
import styles from "./SuggestionsPanel.module.css";

function AlertRow({ a }) {
  const tone = a.pl_pct == null ? "flat" : a.pl_pct >= 0 ? "pos" : "neg";
  const risky = /trim|watch|earnings|hedg/i.test(a.action);
  return (
    <li className={styles.alert}>
      <span className={styles.symbol}>{a.ticker}</span>
      {a.pl_pct != null && (
        <span className={styles.pl} data-tone={tone}>
          {a.pl_pct >= 0 ? "+" : ""}{a.pl_pct.toFixed(1)}%
        </span>
      )}
      <span className={styles.action} data-risk={risky ? "yes" : "no"}>{a.action}</span>
      {a.reasons.length > 0 && (
        <span className={styles.reasons}>
          {a.reasons.map((r) => <span key={r} className={styles.chip}>{r}</span>)}
        </span>
      )}
    </li>
  );
}

export default function SuggestionsPanel({ data, loading, busy, onRefresh }) {
  const empty = !loading && data
    && data.holdings_alerts.length === 0
    && data.opportunities.length === 0
    && data.seasonality.length === 0;

  return (
    <section className={styles.panel} id="suggestions">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Suggestions for {data ? data.for_date : "the next trading day"}</h2>
          <p className={styles.subtitle}>
            {data ? data.market_context.summary : "Tailored to your portfolio and watchlist — the same digest that gets emailed/texted."}
          </p>
        </div>
      </header>

      {loading || !data ? (
        <div className={styles.placeholder}>Loading suggestions…</div>
      ) : empty ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}><Icon name="spark" size={24} /></span>
          <p className={styles.emptyTitle}>No suggestions yet</p>
          <p className={styles.emptyText}>
            Add tickers to your watchlist and portfolio, then refresh signals.
          </p>
          <button className={styles.emptyBtn} onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      ) : (
        <div className={styles.body}>
          {data.holdings_alerts.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Your holdings</h3>
              <ul className={styles.list}>
                {data.holdings_alerts.map((a) => <AlertRow key={a.ticker} a={a} />)}
              </ul>
            </div>
          )}

          {data.opportunities.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>New opportunities</h3>
              <ul className={styles.list}>
                {data.opportunities.map((o) => (
                  <li key={o.ticker} className={styles.alert}>
                    <span className={styles.symbol}>{o.ticker}</span>
                    <span className={styles.score}>Boom {o.score}</span>
                    <span className={styles.reasons}>
                      {o.signals.map((s) => <span key={s} className={styles.chip} data-tone="bull">{s}</span>)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.seasonality.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Seasonal edge (this time of year)</h3>
              <ul className={styles.list}>
                {data.seasonality.map((s) => (
                  <li key={s.ticker} className={styles.alert}>
                    <span className={styles.symbol}>{s.ticker}</span>
                    <span className={styles.action} data-risk={s.kind === "headwind" ? "yes" : "no"}>
                      {s.window_label}: avg {s.avg_pct >= 0 ? "+" : ""}{s.avg_pct}%, win {Math.round(s.win_rate * 100)}% / {s.n}y
                    </span>
                    <span className={styles.chip} data-tone={s.kind === "tailwind" ? "bull" : "bear"}>
                      {s.kind}{s.held ? " · held" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className={styles.disclaimer}>{data.disclaimer}</p>
        </div>
      )}
    </section>
  );
}
