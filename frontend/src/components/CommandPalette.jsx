import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import styles from "./CommandPalette.module.css";

/**
 * Keyboard-first jump menu. Mounted only while open (App owns the Cmd/Ctrl+K
 * shortcut). Type to filter, arrows to move, Enter to run, Esc to close.
 * `items` = [{ id, label, hint, icon, run }].
 */
export default function CommandPalette({ items, onClose }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) => it.label.toLowerCase().includes(q) || it.hint?.toLowerCase().includes(q)
    );
  }, [items, query]);

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
            placeholder="Jump to…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onInputKey}
            aria-label="Command search"
          />
          <kbd className={styles.kbd}>esc</kbd>
        </div>
        <ul className={styles.list}>
          {filtered.length === 0 && <li className={styles.empty}>No matches</li>}
          {filtered.map((it, i) => (
            <li key={it.id}>
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
