import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Icon from "./Icon";
import ExtHoursBadge from "./ExtHoursBadge";
import Sparkline from "./Sparkline";
import SparkRange from "./SparkRange";
import TickerLabel from "./TickerLabel";
import { useWatchlists } from "../hooks/useWatchlists";
import { useSparklines } from "../hooks/useSparklines";
import { openTickerTab } from "../lib/nav";
import { prefersReducedMotion, staggerContainer, staggerItem } from "../lib/motionConfig";
import { formatRelativeTime } from "../lib/format";
import styles from "./WatchlistPanel.module.css";

function changeTone(pct) {
  if (pct == null) return "flat";
  return pct >= 0 ? "pos" : "neg";
}

export default function WatchlistPanel({ quotes = {}, marketStatus = null }) {
  const {
    lists, activeId, items, selectList,
    addTicker, removeTicker, createList, renameList, deleteList,
  } = useWatchlists();

  const [ticker, setTicker] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [range, setRange] = useState("1m");
  const { series: sparks } = useSparklines(items.map((w) => w.ticker), range);

  // List tab editing state.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");

  async function submit(e) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setPending(true);
    try {
      await addTicker(t, note.trim());
      setTicker("");
      setNote("");
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  const commitCreate = () => {
    const n = newName.trim();
    setCreating(false);
    if (n) createList(n).catch(() => {});
  };
  const commitRename = () => {
    const n = renameDraft.trim();
    const id = renamingId;
    setRenamingId(null);
    if (n && id != null) renameList(id, n).catch(() => {});
  };

  return (
    <section className={styles.panel} id="watchlist">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Watchlists</h2>
          <p className={styles.subtitle}>Group the tickers you want to keep an eye on</p>
        </div>
        {items.length > 0 && <SparkRange value={range} onChange={setRange} />}
      </header>

      {/* list selector */}
      <div className={styles.tabs} role="tablist" aria-label="Watchlists">
        {lists.map((l) => (
          renamingId === l.id ? (
            <input
              key={l.id}
              className={styles.tabInput}
              value={renameDraft}
              autoFocus
              maxLength={60}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }}
              onBlur={() => setRenamingId(null)}
            />
          ) : (
            <span key={l.id} className={styles.tabWrap} data-active={l.id === activeId ? "yes" : "no"}>
              <button
                className={styles.tab}
                role="tab"
                aria-selected={l.id === activeId}
                onClick={() => selectList(l.id)}
              >
                {l.name}
              </button>
              {l.id === activeId && (
                <>
                  <button className={styles.tabIcon} title="Rename list" aria-label={`Rename ${l.name}`}
                          onClick={() => { setRenameDraft(l.name); setRenamingId(l.id); }}>✎</button>
                  {lists.length > 1 && (
                    <button className={styles.tabIcon} title="Delete list" aria-label={`Delete ${l.name}`}
                            onClick={() => deleteList(l.id)}>×</button>
                  )}
                </>
              )}
            </span>
          )
        ))}
        {creating ? (
          <input
            className={styles.tabInput}
            value={newName}
            autoFocus
            maxLength={60}
            placeholder="List name"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitCreate(); if (e.key === "Escape") setCreating(false); }}
            onBlur={() => setCreating(false)}
          />
        ) : (
          <button className={styles.newTab} onClick={() => { setNewName(""); setCreating(true); }}>
            + New list
          </button>
        )}
      </div>

      <form className={styles.form} onSubmit={submit} data-tour="add-form">
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

      {items.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="star" size={24} /></span>
          <p className={styles.emptyTitle}>This watchlist is empty</p>
          <p className={styles.emptyText}>Add a ticker above to start tracking it.</p>
        </div>
      ) : (
        <motion.ul
          className={styles.list}
          variants={staggerContainer}
          initial={prefersReducedMotion() ? false : "hidden"}
          animate="visible"
        >
          <AnimatePresence initial={false}>
          {items.map((w) => {
            const q = quotes[w.ticker];
            return (
            <motion.li
              key={w.ticker}
              className={styles.item}
              variants={staggerItem}
              exit={prefersReducedMotion() ? { opacity: 0 } : { opacity: 0, x: -12 }}
              layout={!prefersReducedMotion()}
            >
              <button
                className={styles.symbolBtn}
                onClick={() => openTickerTab(w.ticker)}
                title={`Open ${w.ticker} analysis in a new tab`}
              >
                <TickerLabel ticker={w.ticker} className={styles.symbol} />
              </button>
              <span className={styles.price}>
                {q && q.price != null ? q.price.toFixed(2) : "—"}
              </span>
              <span className={styles.change} data-tone={changeTone(q?.change_pct)}>
                {q && q.change_pct != null
                  ? `${q.change_pct >= 0 ? "+" : ""}${q.change_pct.toFixed(2)}%`
                  : "—"}
              </span>
              <ExtHoursBadge quote={q} />
              <span className={styles.state} data-state={(marketStatus || q?.market_state) ?? "none"}>
                {(() => {
                  const eff = marketStatus || q?.market_state;
                  return eff && eff !== "PRE" && eff !== "POST" ? eff : "";
                })()}
              </span>
              <Sparkline
                closes={sparks[w.ticker]?.closes}
                changePct={sparks[w.ticker]?.change_pct}
                error={sparks[w.ticker]?.error}
                loading={!sparks[w.ticker]}
                range={range}
              />
              <span className={styles.itemNote}>{w.note || "—"}</span>
              <span className={styles.added}>added {formatRelativeTime(w.added_at)}</span>
              <button
                className={styles.remove}
                onClick={() => removeTicker(w.ticker)}
                title={`Remove ${w.ticker}`}
                aria-label={`Remove ${w.ticker}`}
              >
                ×
              </button>
            </motion.li>
            );
          })}
          </AnimatePresence>
        </motion.ul>
      )}
    </section>
  );
}
