import Segmented from "./Segmented";
import styles from "./HeatmapToggle.module.css";

const VIEWS = [
  { value: "table", label: "Table" },
  { value: "heatmap", label: "Heatmap" },
];

/**
 * Table | Heatmap, and in heatmap mode what the tiles are coloured by. Pair
 * with useHeatmapView, which remembers both. `metrics`: [{ value, label }].
 * `row` lays it out as a block of its own (under a phone header).
 */
export default function HeatmapToggle({ view, onView, metric, onMetric, metrics, label, row = false }) {
  return (
    <span className={`${styles.toggle} ${row ? styles.row : ""}`}>
      <Segmented ariaLabel={`Show ${label} as`} value={view} onChange={onView} options={VIEWS} />
      {view === "heatmap" && metrics.length > 1 && (
        <Segmented ariaLabel="Colour tiles by" value={metric} onChange={onMetric} options={metrics} />
      )}
    </span>
  );
}
