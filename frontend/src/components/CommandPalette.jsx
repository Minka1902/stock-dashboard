import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import { searchStocks } from "../api";
import styles from "./CommandPalette.module.css";

/**
 * Keyboard-first jump menu. Mounted only while open (App owns the Cmd/Ctrl+K
 * shortcut). Type to filter, arrows to move, Enter to run, Esc to close.
 * `items` = [{ id, label, hint, icon, run }]. When `onOpenTicker` is provided,
 * typing also searches the whole market (ticker or company name) and matching
 * stocks appear below the commands.
 */
export default function CommandPalette({ items, onClose, onOpenTicker }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [stocks, setStocks] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Debounced market search (only when the palette can open a ticker).
  useEffect(() => {
    if (!onOpenTicker) return undefined;
    const q = query.trim();
    let alive = true;
    const id = setTimeout(() => {
      if (!q) {
        if (alive) setStocks([]);
        return;
      }
      searchStocks(q)
        .then((rows) => { if (alive) setStocks(rows); })
        .catch(() => { if (alive) setStocks([]); });
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(id); };
  }, [query, onOpenTicker]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const commands = !q ? items : items.filter(
      (it) => it.label.toLowerCase().includes(q) || it.hint?.toLowerCase().includes(q)
    );
    const stockItems = q
      ? stocks.map((s) => ({
          id: `stock-${s.symbol}`,
          label: s.symbol,
          hint: `${s.name}${s.exchange ? ` · ${s.exchange}` : ""}`,
          icon: "trending",
          section: "stocks",
          run: () => onOpenTicker(s.symbol),
        }))
      : [];
    return [...commands, ...stockItems];
  }, [items, query, stocks, onOpenTicker]);

  const run = (item) => {
    if (!item) return;
    item.run();
    onClose();
  };

  const onInputKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[active]);
    }
  };

  return (
    <div className={styles.overlay} onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className={styles.panel} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.searchRow}>
          <Icon name="command" size={15} />
          <input
            ref={inputRef}
            className={styles.input}
            placeholder={onOpenTicker ? "Jump to, or search any stock…" : "Jump to…"}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onInputKey}
            aria-label="Command and stock search"
          />
          <kbd className={styles.kbd}>esc</kbd>
        </div>
        <ul className={styles.list}>
          {filtered.length === 0 && <li className={styles.empty}>No matches</li>}
          {filtered.map((it, i) => (
            <li key={it.id}>
              {it.section === "stocks" && filtered[i - 1]?.section !== "stocks" && (
                <div className={styles.section} aria-hidden="true">Stocks</div>
              )}
              <button
                type="button"
                className={`${styles.item} ${i === active ? styles.itemActive : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(it)}
              >
                <Icon name={it.icon} size={16} />
                <span className={styles.itemLabel}>{it.label}</span>
                {it.hint && <span className={styles.itemHint}>{it.hint}</span>}
                <Icon name="arrowRight" size={14} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
