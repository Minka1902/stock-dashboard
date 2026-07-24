import styles from "./SparkRange.module.css";

const SPARK_RANGES = [
  { key: "1d", label: "1D" },
  { key: "3d", label: "3D" },
  { key: "1w", label: "1W" },
  { key: "1m", label: "1M" },
];

// Segmented control selecting the sparkline range for a table.
export default function SparkRange({ value, onChange }) {
  return (
    <div className={styles.toggle} role="group" aria-label="Sparkline range">
      {SPARK_RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          className={styles.btn}
          data-active={value === r.key ? "yes" : "no"}
          onClick={() => onChange(r.key)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
