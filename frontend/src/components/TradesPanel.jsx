import { useState } from "react";
import DataTable from "./DataTable";
import ViewAll from "./ViewAll";
import CollapseToggle from "./CollapseToggle";
import EmptyState from "./EmptyState";
import Segmented from "./Segmented";
import {
  formatCurrencyCompact,
  formatCurrencyFull,
  formatCount,
  formatDate,
} from "../lib/format";
import styles from "./TradesPanel.module.css";
import Tooltip from "./Tooltip";
import InfoTip from "./InfoTip";

const COMPACT_LIMIT = 5;

const TYPE_TONE = { Buy: "pos", Sell: "neg" };
const SIDES = [
  { value: "all", label: "All" },
  { value: "Buy", label: "Buys" },
  { value: "Sell", label: "Sells" },
];

const COLUMNS = [
  { key: "ticker", label: "Ticker", phone: "title", skeleton: "46px", sort: (t) => t.ticker,
    render: (t) => (
      <Tooltip content={`${t.company} — open the Form 4 filing on SEC EDGAR (new tab)`}>
        <a className={styles.ticker} href={t.filing_url} target="_blank" rel="noreferrer">{t.ticker || "—"}</a>
      </Tooltip>
    ) },
  { key: "action", label: "Action", phone: "title", skeleton: "64px", sort: (t) => t.transaction_type,
    render: (t) => (
      <span className={styles.badge} data-tone={typeTone(t.transaction_type)}>{t.transaction_type}</span>
    ) },
  { key: "insider", label: "Insider", cellClassName: styles.insider, phone: "subtitle", skeleton: "70%",
    sort: (t) => t.owner, phoneRender: (t) => (t.role ? `${t.owner} · ${t.role}` : t.owner),
    render: (t) => (
      <>
        <Tooltip truncate><span className={styles.owner}>{t.owner}</span></Tooltip>
        <Tooltip truncate><span className={styles.role}>{t.role}</span></Tooltip>
      </>
    ) },
  { key: "shares", label: "Shares", className: styles.num, cellClassName: "tabular", skeleton: "60px",
    sort: (t) => t.shares, render: (t) => formatCount(Math.round(t.shares)) },
  { key: "value", label: "Value", className: styles.num, cellClassName: "tabular", phone: "value", skeleton: "70px",
    sort: (t) => t.value, tone: (t) => TYPE_TONE[t.transaction_type],
    render: (t) => (t.value > 0 ? (
      <Tooltip content={`Exact value: ${formatCurrencyFull(t.value)}`}>
        <span>{formatCurrencyCompact(t.value)}</span>
      </Tooltip>
    ) : "—") },
  { key: "date", label: "Date", cellClassName: styles.muted, phone: "subtitle", skeleton: "64px",
    sort: (t) => Date.parse(t.transaction_date) || 0, render: (t) => formatDate(t.transaction_date) },
];

function typeTone(type) {
  if (type === "Buy") return "buy";
  if (type === "Sell") return "sell";
  return "neutral";
}

export default function TradesPanel({ trades, loading, busy, onRefresh, compact = false, onViewAll, collapsible = false, collapsed = false, onToggleCollapse }) {
  const [side, setSide] = useState("all");
  const showEmpty = !loading && trades.length === 0;
  // A side with no filings is left out (and stops filtering), so the list is
  // never emptied by a filter.
  const sides = SIDES.map((o) => ({
    ...o, badge: o.value === "all" ? trades.length : trades.filter((t) => t.transaction_type === o.value).length,
  })).filter((o) => o.badge);
  const active = sides.some((o) => o.value === side) ? side : "all";
  const rows = active === "all" ? trades : trades.filter((t) => t.transaction_type === active);

  return (
    <section className={styles.panel} id="trades">
      <header className={styles.head}>
        {collapsible && <CollapseToggle collapsed={collapsed} onClick={onToggleCollapse} label="Trades" />}
        <div>
          <h2 className={styles.title}>Insider trades <InfoTip term="form4" /></h2>
          <p className={styles.subtitle}>
            Corporate insiders (SEC Form 4) buying and selling their own stock
          </p>
        </div>
        {compact && onViewAll && <ViewAll onClick={onViewAll} />}
      </header>

      {!collapsed && (showEmpty ? (
        <EmptyState icon="trending" title="No insider filings loaded yet" onRetry={onRefresh} busy={busy} />
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          rowKey={(t) => t.accession}
          limit={compact ? COMPACT_LIMIT : undefined}
          loading={loading}
          animate
          classes={{ wrap: styles.tableWrap, table: styles.table }}
          toolbar={!compact && sides.length > 2 && (
            <Segmented ariaLabel="Buys or sells" value={active} onChange={setSide} options={sides} overflow="scroll" />
          )}
        />
      ))}
    </section>
  );
}
