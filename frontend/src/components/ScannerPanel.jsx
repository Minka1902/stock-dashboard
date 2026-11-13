import { useMemo, useState } from "react";
import DataTable from "./DataTable";
import Segmented from "./Segmented";
import { currencyForSymbol, formatPercentSigned, formatPrice, formatRelativeTime } from "../lib/format";
import { openTickerTab } from "../lib/nav";
import styles from "./ScannerPanel.module.css";

// Inside the Scanner tab's narrow column, or a phone, the matches are a list.
const CARDS_BELOW = 640;
const INITIAL_SORT = { key: "first", dir: "desc" };

function groupByTicker(hits, order) {
  const by = new Map();
  for (const h of hits) {
    const row = by.get(h.ticker) || { ticker: h.ticker, hits: [], first_seen_at: h.first_seen_at, current: false };
    row.hits.push(h);
    row.current ||= h.current;
    if (h.first_seen_at < row.first_seen_at) row.first_seen_at = h.first_seen_at;
    by.set(h.ticker, row);
  }
  return [...by.values()].map((r) => {
    r.hits.sort((a, b) => order[a.scan] - order[b.scan]);
    const latest = r.hits.reduce((a, b) => (b.last_seen_at > a.last_seen_at ? b : a));
    return { ...r, price: latest.price, change_pct: latest.change_pct };
  });
}

/**
 * Today's scanner matches, one row per ticker with every scan it matched.
 * Filter by scan (the metric column follows the filter), sort any column,
 * show or hide matches that have since dropped off. Clicking a ticker opens
 * its stock page. Props: hits, scans ([{key, label, description,
 * metric_label}]), rowActions(ticker) → extra cells' content,
 * onOpen(ticker) (openTickerTab), emptyText.
 */
export default function ScannerPanel({
  hits, scans, rowActions = null, onOpen = openTickerTab,
  emptyText = "No matches yet today.",
}) {
  const [filter, setFilter] = useState("all");
  const [showEarlier, setShowEarlier] = useState(false);

  const order = useMemo(() => Object.fromEntries(scans.map((s, i) => [s.key, i])), [scans]);
  const meta = useMemo(() => Object.fromEntries(scans.map((s) => [s.key, s])), [scans]);
  const grouped = useMemo(() => groupByTicker(hits, order), [hits, order]);
  const visible = useMemo(() => grouped.filter((r) => showEarlier || r.current), [grouped, showEarlier]);
  const counts = useMemo(() => {
    const c = {};
    visible.forEach((r) => r.hits.forEach((h) => { c[h.scan] = (c[h.scan] || 0) + 1; }));
    return c;
  }, [visible]);
  const rows = useMemo(() => visible
    .filter((r) => filter === "all" || r.hits.some((h) => h.scan === filter))
    .map((r) => {
      const shown = filter === "all" ? r.hits[0] : r.hits.find((h) => h.scan === filter);
      return { ...r, metric: shown.metric, metricScan: shown.scan };
    }), [visible, filter]);
  const earlier = grouped.filter((r) => !r.current).length;

  const columns = [
    { key: "ticker", label: "Ticker", phone: "title", sort: (r) => r.ticker,
      render: (r) => <button type="button" className={styles.ticker} onClick={() => onOpen(r.ticker)}>{r.ticker}</button> },
    { key: "scans", label: "Matched", phone: "subtitle",
      render: (r) => r.hits.map((h) => (
        <span key={h.scan} className={styles.chip} title={meta[h.scan]?.description}>{meta[h.scan]?.label || h.scan}</span>
      )) },
    { key: "price", label: "Price", className: styles.num, phone: "value", sort: (r) => r.price,
      render: (r) => formatPrice(r.price, currencyForSymbol(r.ticker)) },
    { key: "change", label: "Today", className: styles.num, phone: "value", sort: (r) => r.change_pct,
      cellProps: (r) => ({ "data-tone": r.change_pct > 0 ? "up" : r.change_pct < 0 ? "down" : "flat" }),
      tone: (r) => (r.change_pct > 0 ? "pos" : r.change_pct < 0 ? "neg" : null),
      render: (r) => (r.change_pct == null ? "—" : formatPercentSigned(r.change_pct / 100, 2)) },
    { key: "metric", label: filter === "all" ? "Metric" : meta[filter]?.metric_label, caption: "Metric",
      className: styles.num, sort: (r) => r.metric,
      render: (r) => (r.metric == null ? "—"
        : <><span className={styles.faint}>{meta[r.metricScan]?.metric_label} </span>{r.metric}</>) },
    { key: "first", label: "First seen", cellClassName: styles.faint, sort: (r) => r.first_seen_at,
      render: (r) => formatRelativeTime(r.first_seen_at) },
    ...(rowActions ? [{ key: "actions", label: "Actions", hideLabel: true, cellClassName: styles.actions,
      render: (r) => rowActions(r.ticker) }] : []),
  ];

  const options = [
    { value: "all", label: "All", badge: visible.length },
    ...scans.map((s) => ({ value: s.key, label: s.label, title: s.description, badge: counts[s.key] || 0 })),
  ];

  return (
    <div className={styles.root}>
      <div className={styles.controls}>
        <Segmented options={options} value={filter} onChange={setFilter} ariaLabel="Filter by scan" overflow="scroll" />
        {earlier > 0 && (
          <label className={styles.check}>
            <input type="checkbox" checked={showEarlier} onChange={(e) => setShowEarlier(e.target.checked)} />
            Include {earlier} that dropped off
          </label>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.ticker}
        rowProps={(r) => ({ "data-current": r.current ? "yes" : "no" })}
        initialSort={INITIAL_SORT}
        cardsBelow={CARDS_BELOW}
        empty={<p className={styles.empty}>{emptyText}</p>}
        classes={{ wrap: styles.wrap, table: styles.table }}
      />
    </div>
  );
}
