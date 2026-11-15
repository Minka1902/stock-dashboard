import Icon from "./Icon";
import DataTable from "./DataTable";
import ViewAll from "./ViewAll";
import CollapseToggle from "./CollapseToggle";
import {
  formatCurrencyCompact,
  formatCurrencyFull,
  formatDate,
} from "../lib/format";
import styles from "./ContractsPanel.module.css";
import Tooltip from "./Tooltip";
import PanelInfo from "./PanelInfo";

const BLURB = "Sourced live from USASpending.gov · sorted by award amount";
const COMPACT_LIMIT = 5;

const COLUMNS = [
  { key: "recipient", label: "Recipient", cellClassName: styles.recipient, truncate: true, phone: "title",
    skeleton: "70%", render: (c) => c.recipient_name },
  { key: "agency", label: "Agency", phone: "subtitle", skeleton: "50%",
    render: (c) => <Tooltip truncate><span className={styles.agency}>{c.awarding_agency}</span></Tooltip> },
  { key: "amount", label: "Amount", className: styles.amountCell, cellClassName: `${styles.amount} tabular`,
    phone: "value", skeleton: "60px",
    render: (c) => (
      <Tooltip content={`Exact amount: ${formatCurrencyFull(c.amount)}`}>
        <span>{formatCurrencyCompact(c.amount)}</span>
      </Tooltip>
    ) },
  { key: "start", label: "Start", cellClassName: styles.muted, phone: "subtitle", skeleton: "64px",
    render: (c) => formatDate(c.start_date) },
  { key: "award", label: "Award ID", cellClassName: styles.award, truncate: true, skeleton: "80%",
    render: (c) => c.award_id || "—" },
];

export default function ContractsPanel({ contracts, loading, busy, onRefresh, compact = false, onViewAll, collapsible = false, collapsed = false, onToggleCollapse }) {
  const showEmpty = !loading && contracts.length === 0;

  return (
    <section className={styles.panel} id="contracts">
      <header className={styles.head}>
        {collapsible && <CollapseToggle collapsed={collapsed} onClick={onToggleCollapse} label="Contracts" />}
        <div>
          <h2 className={styles.title}>Biggest recent federal contracts<PanelInfo label="Biggest recent federal contracts" blurb={BLURB} /></h2>
          <p className={styles.subtitle}>{BLURB}</p>
        </div>
        {compact && onViewAll && <ViewAll onClick={onViewAll} />}
      </header>

      {!collapsed && (showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>
            <Icon name="contract" size={26} />
          </span>
          <p className={styles.emptyTitle}>No contracts loaded yet</p>
          <p className={styles.emptyText}>
            Pull the latest federal awards to populate the table.
          </p>
          <button className={styles.emptyBtn} onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={contracts}
          rowKey={(c) => c.external_id}
          limit={compact ? COMPACT_LIMIT : undefined}
          loading={loading}
          classes={{ wrap: styles.tableWrap, table: styles.table }}
        />
      ))}
    </section>
  );
}
