import DataTable from "./DataTable";
import styles from "./CorrelationHeatmap.module.css";

// Diverging scale: positive correlation tints toward caution, negative toward info.
function tint(rho) {
  if (rho == null) return "transparent";
  const a = Math.min(Math.abs(rho), 1) * 70;
  return `color-mix(in oklch, var(${rho >= 0 ? "--caution" : "--info"}) ${a.toFixed(0)}%, transparent)`;
}

/**
 * A ticker × ticker grid of daily-return correlations. Cells above
 * `flagAbove` are outlined as "move together"; a pair without enough shared
 * days shows a dash, never a number. A matrix reads only as a grid, so it
 * scrolls sideways on a phone rather than becoming a list. Props: tickers,
 * matrix (rows of rho | null), flagAbove (0.8).
 */
export default function CorrelationHeatmap({ tickers, matrix, flagAbove = 0.8 }) {
  if (tickers.length < 2) return <p className={styles.empty}>Needs at least two priced holdings.</p>;
  const columns = [
    { key: "row", label: "", headProps: { "aria-hidden": "true" }, rowHeader: true, render: (r) => r.ticker },
    ...tickers.map((col, j) => ({
      key: col,
      label: col,
      cellProps: (r) => {
        const rho = matrix[r.i][j];
        return {
          style: { background: r.i === j ? "var(--surface-2)" : tint(rho) },
          "data-flag": r.i !== j && rho != null && rho > flagAbove ? "yes" : "no",
          title: r.i === j ? r.ticker : `${r.ticker} vs ${col}: ${rho == null ? "not enough shared days" : rho.toFixed(2)}`,
        };
      },
      render: (r) => {
        const rho = matrix[r.i][j];
        return r.i === j ? "" : rho == null ? "—" : rho.toFixed(2);
      },
    })),
  ];
  return (
    <DataTable
      columns={columns}
      rows={tickers.map((ticker, i) => ({ ticker, i }))}
      rowKey={(r) => r.ticker}
      layout="scroll"
      label="Daily-return correlation between holdings"
      classes={{ wrap: styles.wrap, table: styles.grid }}
    />
  );
}
