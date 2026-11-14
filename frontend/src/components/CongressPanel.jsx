import Icon from "./Icon";
import DataTable from "./DataTable";
import ViewAll from "./ViewAll";
import CollapseToggle from "./CollapseToggle";
import { formatDate } from "../lib/format";
import styles from "./CongressPanel.module.css";
import Tooltip from "./Tooltip";
import PanelInfo from "./PanelInfo";

const BLURB = "STOCK Act disclosures · House & Senate · legislators trading ahead of policy booms";
const COMPACT_LIMIT = 5;

// Amount is a bucket string ("$1,001 - $15,000"); sort by its lower bound.
const AMOUNT_RE = /[\d,]+/;

const COLUMNS = [
  { key: "representative", label: "Representative", cellClassName: styles.rep, phone: "title", skeleton: "140px",
    sort: (t) => t.representative,
    render: (t) => (
      <>
        <Tooltip truncate content={t.state ? `${t.representative} (${t.state})` : t.representative}>
          <span className={styles.repName}>{t.representative}</span>
        </Tooltip>
        {t.state && <span className={styles.state}>{t.state}</span>}
      </>
    ) },
  { key: "party", label: "Party", skeleton: "28px", sort: (t) => t.party,
    render: (t) => (t.party ? <span className={styles.badge} data-tone={partyTone(t.party)}>{t.party}</span> : "—") },
  { key: "ticker", label: "Ticker", phone: "subtitle", skeleton: "46px", sort: (t) => t.ticker,
    render: (t) => (t.asset_description ? (
      <Tooltip content={t.asset_description}>
        <span className={styles.ticker}>{t.ticker || "—"}</span>
      </Tooltip>
    ) : <span className={styles.ticker}>{t.ticker || "—"}</span>) },
  { key: "type", label: "Type", phone: "value", skeleton: "70px", sort: (t) => t.transaction_type,
    render: (t) => (
      <span className={styles.badge} data-tone={typeTone(t.transaction_type)}>{t.transaction_type}</span>
    ) },
  { key: "amount", label: "Amount", cellClassName: styles.amount, phone: "value", skeleton: "120px",
    sort: (t) => {
      const m = (t.amount_range || "").match(AMOUNT_RE);
      return m ? Number(m[0].replace(/,/g, "")) : null;
    },
    render: (t) => t.amount_range || "—" },
  { key: "date", label: "Date", cellClassName: styles.muted, phone: "subtitle", skeleton: "64px",
    sort: (t) => Date.parse(t.transaction_date) || 0, render: (t) => formatDate(t.transaction_date) },
  { key: "filing", label: "Filing", skeleton: "32px",
    render: (t) => (t.source_url ? (
      <a className={styles.link} href={t.source_url} target="_blank" rel="noreferrer"
         title={t.doc_id ? `House Clerk PTR ${t.doc_id}, filed ${t.filed_at}` : "Senate Stock Watcher"}>
        {t.doc_id ? "PTR ↗" : "source ↗"}
      </a>
    ) : <span className={styles.muted}>—</span>) },
];

function partyTone(party) {
  if (party === "D") return "dem";
  if (party === "R") return "rep";
  return "neutral";
}

function typeTone(type) {
  if (type === "Purchase") return "buy";
  if (type === "Sale") return "sell";
  return "neutral";
}

export default function CongressPanel({ data, loading, busy, onRefresh, compact = false, onViewAll, collapsible = false, collapsed = false, onToggleCollapse }) {
  const showEmpty = !loading && data.length === 0;

  return (
    <section className={styles.panel} id="congress">
      <header className={styles.head}>
        {collapsible && <CollapseToggle collapsed={collapsed} onClick={onToggleCollapse} label="Congress" />}
        <div>
          <h2 className={styles.title}>Congressional Trades <PanelInfo label="Congressional Trades" blurb={BLURB} term="congress_trade" /></h2>
          <p className={styles.subtitle}>{BLURB}</p>
        </div>
        {compact && onViewAll && <ViewAll onClick={onViewAll} />}
      </header>

      {!collapsed && (showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="layers" size={24} /></span>
          <p className={styles.emptyTitle}>No congressional trades loaded yet</p>
          <button className={styles.emptyBtn} onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      ) : (
        <DataTable columns={COLUMNS} rows={data} rowKey={(t) => t.trade_hash} limit={compact ? COMPACT_LIMIT : undefined}
                   loading={loading} skeletonRows={8} stickyHeader />
      ))}
    </section>
  );
}
