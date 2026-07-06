import { useState } from "react";
import Icon from "./Icon";
import StockDetailPanel from "./StockDetailPanel";
import { formatRelativeTime } from "../lib/format";
import styles from "./WatchlistPanel.module.css";

function changeTone(pct) {
  if (pct == null) return "flat";
  return pct >= 0 ? "pos" : "neg";
}

export default function WatchlistPanel({ watchlist, quotes = {}, onAdd, onRemove }) {
  const [ticker, setTicker] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState(null);

  if (selected) {
    return <StockDetailPanel key={selected} ticker={selected} onBack={() => setSelected(null)} />;
  }

  async function submit(e) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setPending(true);
    try {
      await onAdd(t, note.trim());
      setTicker("");
      setNote("");
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.panel} id="watchlist">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Watchlist</h2>
          <p className={styles.subtitle}>Tickers you want to keep an eye on</p>
        </div>
      </header>

      <form className={styles.form} onSubmit={submit}>
        <input
          className={styles.ticker}
          placeholder="Ticker (e.g. LMT)"
          value={ticker}
          maxLength={12}
          onChange={(e) => setTicker(e.target.value)}
        />
        <input
          className={styles.note}
          placeholder="Note (optional)"
          value={note}
          maxLength={120}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className={styles.add} disabled={pending || !ticker.trim()}>
          {pending ? "Adding…" : "Add"}
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}

      {watchlist.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="star" size={24} /></span>
          <p className={styles.emptyTitle}>Your watchlist is empty</p>
          <p className={styles.emptyText}>Add a ticker above to start tracking it.</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {watchlist.map((w) => {
            const q = quotes[w.ticker];
            return (
            <li key={w.ticker} className={styles.item}>
              <button
                className={styles.symbolBtn}
                onClick={() => setSelected(w.ticker)}
                title={`Open ${w.ticker} chart`}
              >
                <span className={styles.symbol}>{w.ticker}</span>
              </button>
              <span className={styles.price}>
                {q && q.price != null ? q.price.toFixed(2) : "—"}
              </span>
              <span className={styles.change} data-tone={changeTone(q?.change_pct)}>
                {q && q.change_pct != null
                  ? `${q.change_pct >= 0 ? "+" : ""}${q.change_pct.toFixed(2)}%`
                  : "—"}
              </span>
              <span className={styles.state} data-state={q?.market_state ?? "none"}>
                {q ? q.market_state : ""}
              </span>
              <span className={styles.itemNote}>{w.note || "—"}</span>
              <span className={styles.added}>added {formatRelativeTime(w.added_at)}</span>
              <button
                className={styles.remove}
                onClick={() => onRemove(w.ticker)}
                title={`Remove ${w.ticker}`}
                aria-label={`Remove ${w.ticker}`}
              >
                ×
              </button>
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
