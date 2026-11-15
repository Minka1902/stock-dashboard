import Button from "./Button";
import Dialog from "./Dialog";
import styles from "./NewsSourceSheet.module.css";

/**
 * The News source filter on a phone: every publisher and X account with its
 * item count, any number of them picked. None picked means every source.
 *
 * Props: open, counts [{source, kind, count}] (lib/newsSources.js
 * `sourceCounts`), picked [source], onChange(picked), onClose.
 */
export default function NewsSourceSheet({ open, counts, picked, onChange, onClose }) {
  const toggle = (source) => onChange(picked.includes(source)
    ? picked.filter((p) => p !== source)
    : [...picked, source]);
  const shown = counts.reduce((n, s) => n + (!picked.length || picked.includes(s.source) ? s.count : 0), 0);

  return (
    <Dialog
      open={open}
      size="sm"
      caption="News"
      title="Sources"
      onClose={onClose}
      footer={(
        <>
          <Button variant="quiet" onClick={() => onChange([])} disabled={!picked.length}>All sources</Button>
          <Button variant="primary" onClick={onClose}>Show {shown}</Button>
        </>
      )}
    >
      <ul className={styles.list}>
        {counts.map((s) => (
          <li key={s.source}>
            <label className={styles.option}>
              <input type="checkbox" checked={picked.includes(s.source)} onChange={() => toggle(s.source)} />
              <span className={styles.name} data-kind={s.kind}>{s.source}</span>
              <span className={styles.count}>{s.count}</span>
            </label>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
