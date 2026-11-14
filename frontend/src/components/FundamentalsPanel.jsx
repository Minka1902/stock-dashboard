import Icon from "./Icon";
import DataTable from "./DataTable";
import ViewAll from "./ViewAll";
import CollapseToggle from "./CollapseToggle";
import styles from "./FundamentalsPanel.module.css";
import Term from "./Term";
import PanelInfo from "./PanelInfo";

const BLURB = "Yahoo Finance · valuation & growth per watchlist ticker";
const COMPACT_LIMIT = 5;

const COLUMNS = [
  { key: "ticker", label: "Ticker", phone: "title", skeleton: "48px",
    render: (f) => <span className={styles.ticker}>{f.ticker}</span> },
  { key: "sector", label: "Sector", cellClassName: styles.sector, truncate: true, phone: "subtitle", skeleton: "80px",
    render: (f) => f.sector || "—" },
  { key: "pe", caption: "P/E", align: "end", phone: "value", skeleton: "40px",
    label: <Term term="pe_ratio" tip="This column is the trailing (last 12 months) P/E.">P/E</Term>,
    render: (f) => fmtRatio(f.pe_ratio) },
  { key: "fpe", caption: "Fwd P/E", align: "end", skeleton: "40px",
    label: <Term term="pe_ratio" tip="This column is the forward P/E, from analysts' next-12-month estimates.">Fwd P/E</Term>,
    render: (f) => fmtRatio(f.forward_pe) },
  { key: "peg", caption: "PEG", label: <Term term="peg">PEG</Term>, align: "end", skeleton: "36px",
    render: (f) => (f.peg_ratio != null ? f.peg_ratio.toFixed(2) : "—") },
  { key: "pb", caption: "P/B", label: <Term term="price_to_book">P/B</Term>, align: "end", skeleton: "40px",
    render: (f) => fmtRatio(f.pb_ratio) },
  { key: "growth", caption: "Rev growth", align: "end", cellClassName: styles.growth, phone: "value", skeleton: "52px",
    label: <Term tip="Revenue growth, year over year">Rev Growth</Term>,
    cellProps: (f) => ({ "data-tone": growthTone(f.revenue_growth) }),
    tone: (f) => growthTone(f.revenue_growth),
    render: (f) => fmtPct(f.revenue_growth) },
  { key: "margin", caption: "Margin", align: "end", skeleton: "52px",
    label: <Term tip="Profit margin: net income as a share of revenue">Margin</Term>,
    render: (f) => fmtPct(f.profit_margin) },
  { key: "cap", caption: "Mkt cap", align: "end", skeleton: "60px",
    label: <Term tip="Market capitalisation: share price × shares outstanding">Mkt Cap</Term>,
    render: (f) => fmtCap(f.market_cap) },
];

function fmtRatio(v) {
  if (v == null) return "—";
  return v.toFixed(1) + "×";
}

function fmtPct(v) {
  if (v == null) return "—";
  return (v * 100).toFixed(1) + "%";
}

function fmtCap(v) {
  if (v == null) return "—";
  if (v >= 1e12) return (v / 1e12).toFixed(1) + "T";
  if (v >= 1e9)  return (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6)  return (v / 1e6).toFixed(1) + "M";
  return v.toLocaleString();
}

function growthTone(v) {
  if (v == null) return "neutral";
  if (v > 0.1)  return "pos";
  if (v < 0)    return "neg";
  return "neutral";
}

export default function FundamentalsPanel({ data, loading, busy, onRefresh, compact = false, onViewAll, collapsible = false, collapsed = false, onToggleCollapse }) {
  const showEmpty = !loading && data.length === 0;

  return (
    <section className={styles.panel} id="fundamentals">
      <header className={styles.head}>
        {collapsible && <CollapseToggle collapsed={collapsed} onClick={onToggleCollapse} label="Fundamentals" />}
        <div>
          <h2 className={styles.title}>Fundamentals<PanelInfo label="Fundamentals" blurb={BLURB} /></h2>
          <p className={styles.subtitle}>{BLURB}</p>
        </div>
        {compact && onViewAll && <ViewAll onClick={onViewAll} />}
      </header>

      {!collapsed && (showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="star" size={24} /></span>
          <p className={styles.emptyTitle}>No fundamental data loaded yet</p>
          <button className={styles.emptyBtn} onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      ) : (
        <DataTable columns={COLUMNS} rows={data} rowKey={(f) => f.ticker} limit={compact ? COMPACT_LIMIT : undefined}
                   loading={loading} skeletonRows={5} stickyHeader />
      ))}
    </section>
  );
}
