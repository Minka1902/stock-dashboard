import Dialog from "../Dialog";
import styles from "./ChartToolsSheet.module.css";

/**
 * The phone's chart toolbar: every control the desktop toolbar shows in a
 * row, stacked in a sheet as captioned groups. ChartPro hands in the same
 * controls it renders on a desktop, so the two can never drift apart.
 * Props: open, onClose, caption, sections [{ id, label, content }].
 */
export default function ChartToolsSheet({ open, onClose, caption, sections }) {
  return (
    <Dialog open={open} size="sm" caption={caption} title="Chart tools" onClose={onClose}>
      <div className={styles.sections}>
        {sections.map((s) => (
          <section key={s.id} className={styles.section} aria-label={s.label}>
            <h3 className="caption">{s.label}</h3>
            <div className={styles.controls}>{s.content}</div>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
