import { useState } from "react";
import Icon from "./Icon";
import { formatRelativeTime } from "../lib/format";
import styles from "./WatchlistPanel.module.css";

export default function WatchlistPanel({ watchlist, onAdd, onRemove }) {
  const [ticker, setTicker] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

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
          {watchlist.map((w) => (
            <li key={w.ticker} className={styles.item}>
              <span className={styles.symbol}>{w.ticker}</span>
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
          ))}
        </ul>
      )}
    </section>
  );
}
