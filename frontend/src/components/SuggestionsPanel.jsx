import { useEffect, useState } from "react";
import ViewAll from "./ViewAll";
import CollapseToggle from "./CollapseToggle";
import EmptyState from "./EmptyState";
import { getSuggestionLog } from "../api";
import { formatRelativeTime } from "../lib/format";
import styles from "./SuggestionsPanel.module.css";

function statusTone(status) {
  if (status.startsWith("sent")) return "pos";
  if (status.startsWith("error")) return "neg";
  return "muted"; // skipped: ...
}

// Newest 2 email + newest 2 SMS deliveries; `alert` rows are excluded here.
function recentDeliveries(log) {
  const byChannel = (ch) =>
    log
      .filter((e) => e.channel === ch)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 2);
  return [...byChannel("email"), ...byChannel("sms")].sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1,
  );
}

function DeliveryLog() {
  const [log, setLog] = useState([]);
  useEffect(() => {
    getSuggestionLog().then(setLog).catch(() => {});
  }, []);
  const rows = recentDeliveries(log);
  if (rows.length === 0) return null;
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Recent deliveries</h3>
      <ul className={styles.log}>
        {rows.map((e, i) => (
          <li key={i} className={styles.logRow}>
            <span className={styles.logTime}>{formatRelativeTime(e.created_at)}</span>
            <span className={styles.logFor}>for {e.for_date}</span>
            <span className={styles.logChannel}>{e.channel}</span>
            <span className={styles.logStatus} data-tone={statusTone(e.status)}>{e.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

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

function OpportunityRow({ o }) {
  // Fresh deploy: TA not computed yet — fall back to the Boom read, flagged.
  if (o.ta_pending) {
    return (
      <li className={styles.alert}>
        <span className={styles.symbol}>{o.ticker}</span>
        <span className={styles.score}>Boom {o.score}</span>
        <span className={styles.reasons}>
          {o.signals.map((s) => <span key={s} className={styles.chip} data-tone="bull">{s}</span>)}
          <span className={styles.chip} data-tone="muted">TA pending</span>
        </span>
      </li>
    );
  }
  const tone = o.recommendation === "buy" ? "bull" : o.recommendation === "sell" ? "bear" : "muted";
  return (
    <li className={styles.alert}>
      <span className={styles.symbol}>{o.ticker}</span>
      <span className={styles.chip} data-tone={tone}>{(o.recommendation || "hold").toUpperCase()}</span>
      <span className={styles.action} data-risk="no">
        conv {o.conviction}
        {o.rr != null ? ` · R/R ${o.rr}` : ""}
        {o.entry != null ? ` · entry ${o.entry} / stop ${o.stop}` : ""}
      </span>
      <span className={styles.reasons}>
        {(o.evidence || []).map((e) => <span key={e} className={styles.chip}>{e}</span>)}
        {o.score != null && <span className={styles.chip} data-tone="muted">Boom {o.score}</span>}
      </span>
    </li>
  );
}

export default function SuggestionsPanel({ data, loading, busy, onRefresh, compact = false, onViewAll, collapsible = false, collapsed = false, onToggleCollapse }) {
  const empty = !loading && data
    && data.holdings_alerts.length === 0
    && data.opportunities.length === 0
    && data.seasonality.length === 0;

  return (
    <section className={styles.panel} id="suggestions">
      <header className={styles.head}>
        {collapsible && <CollapseToggle collapsed={collapsed} onClick={onToggleCollapse} label="Suggestions" />}
        <div>
          <h2 className={styles.title}>Suggestions for {data ? data.for_date : "the next trading day"}</h2>
          <p className={styles.subtitle}>
            {data ? data.market_context.summary : "Tailored to your portfolio and watchlist — the same digest that gets emailed/texted."}
          </p>
        </div>
        {compact && onViewAll && <ViewAll onClick={onViewAll} />}
      </header>

      {!collapsed && (loading || !data ? (
        <div className={styles.placeholder}>Loading suggestions…</div>
      ) : empty ? (
        <EmptyState
          icon="spark"
          title="No suggestions yet"
          text="Add tickers to your watchlist and portfolio, then refresh signals."
          onRetry={onRefresh}
          busy={busy}
        />
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
                {data.opportunities.map((o) => <OpportunityRow key={o.ticker} o={o} />)}
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

          {!compact && <DeliveryLog />}

          <p className={styles.disclaimer}>{data.disclaimer}</p>
        </div>
      ))}
    </section>
  );
}
