import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Icon from "./Icon";
import ExtHoursBadge from "./ExtHoursBadge";
import MenuButton, { MenuDivider, MenuItem, MenuLabel } from "./MenuButton";
import Sparkline from "./Sparkline";
import SparkRange from "./SparkRange";
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
    addTicker, removeTicker, moveTicker, editNote, createList, renameList, deleteList,
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
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  // Per-row note editing: the ticker being edited, plus its draft.
  const [noteTicker, setNoteTicker] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");

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

  const commitNote = () => {
    const t = noteTicker;
    const draft = noteDraft.trim();
    setNoteTicker(null);
    if (t == null) return;
    const current = items.find((w) => w.ticker === t)?.note ?? "";
    if (draft !== current) editNote(t, draft).catch((err) => setError(err.message));
  };

  const startNoteEdit = (w) => { setNoteDraft(w.note || ""); setNoteTicker(w.ticker); };

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
              onBlur={commitRename}
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
                <MenuButton label={`Actions for ${l.name}`} className={styles.tabMenu}>
                  {(close) => (
                    <>
                      <MenuItem onSelect={() => { close(); setRenameDraft(l.name); setRenamingId(l.id); }}>
                        <Icon name="edit" size={14} /> Rename
                      </MenuItem>
                      <MenuDivider />
                      <MenuItem
                        tone="danger"
                        disabled={lists.length <= 1}
                        onSelect={() => { close(); setConfirmDeleteId(l.id); }}
                      >
                        <Icon name="trash" size={14} />
                        {lists.length <= 1 ? "Can't delete your only list" : "Delete list"}
                      </MenuItem>
                    </>
                  )}
                </MenuButton>
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
            onBlur={commitCreate}
          />
        ) : (
          <button className={styles.newTab} onClick={() => { setNewName(""); setCreating(true); }}>
            + New list
          </button>
        )}
      </div>

      {confirmDeleteId != null && (() => {
        const doomed = lists.find((l) => l.id === confirmDeleteId);
        const count = doomed?.id === activeId ? items.length : null;
        return (
          <div className={styles.confirm} role="alertdialog" aria-label="Confirm delete">
            <span className={styles.confirmText}>
              Delete <strong>{doomed?.name}</strong>
              {count ? ` and its ${count} ticker${count === 1 ? "" : "s"}` : " and everything on it"}?
              This can't be undone.
            </span>
            <button className={styles.confirmCancel} onClick={() => setConfirmDeleteId(null)}>
              Cancel
            </button>
            <button
              className={styles.confirmGo}
              onClick={() => {
                const id = confirmDeleteId;
                setConfirmDeleteId(null);
                deleteList(id).catch((err) => setError(err.message));
              }}
            >
              Delete list
            </button>
          </div>
        );
      })()}

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
              {noteTicker === w.ticker ? (
                <input
                  className={styles.noteInput}
                  value={noteDraft}
                  autoFocus
                  maxLength={120}
                  placeholder="Note"
                  aria-label={`Note for ${w.ticker}`}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitNote();
                    if (e.key === "Escape") setNoteTicker(null);
                  }}
                  onBlur={commitNote}
                />
              ) : (
                <button
                  className={styles.itemNote}
                  onClick={() => startNoteEdit(w)}
                  title={`Edit note for ${w.ticker}`}
                >
                  {w.note || "—"}
                </button>
              )}
              <span className={styles.added}>added {formatRelativeTime(w.added_at)}</span>
              <MenuButton label={`Actions for ${w.ticker}`}>
                {(close) => (
                  <>
                    <MenuItem onSelect={() => { close(); openTickerTab(w.ticker); }}>
                      <Icon name="trending" size={14} /> Open analysis
                    </MenuItem>
                    <MenuItem onSelect={() => { close(); startNoteEdit(w); }}>
                      <Icon name="note" size={14} /> {w.note ? "Edit note" : "Add note"}
                    </MenuItem>

                    {lists.length > 1 && (
                      <>
                        <MenuLabel>Move to</MenuLabel>
                        {lists.filter((l) => l.id !== activeId).map((l) => (
                          <MenuItem
                            key={l.id}
                            onSelect={() => {
                              close();
                              moveTicker(w.ticker, l.id).catch((err) => setError(err.message));
                            }}
                          >
                            <Icon name="move" size={14} /> {l.name}
                          </MenuItem>
                        ))}
                      </>
                    )}

                    <MenuDivider />
                    <MenuItem tone="danger" onSelect={() => { close(); removeTicker(w.ticker); }}>
                      <Icon name="trash" size={14} /> Remove from list
                    </MenuItem>
                  </>
                )}
              </MenuButton>
            </motion.li>
            );
          })}
          </AnimatePresence>
        </motion.ul>
      )}
    </section>
  );
}
