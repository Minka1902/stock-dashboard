import Icon from "./Icon";
import DataTable from "./DataTable";
import ViewAll from "./ViewAll";
import CollapseToggle from "./CollapseToggle";
import TickerLabel from "./TickerLabel";
import { formatDate, formatRelativeTime, freshnessTone } from "../lib/format";
import styles from "./AnalystPanel.module.css";
import { freshnessTip } from "../lib/freshness";
import Tooltip from "./Tooltip";
import Term from "./Term";
import InfoTip from "./InfoTip";

const COMPACT_LIMIT = 5;

const COLUMNS = [
  { key: "ticker", label: "Ticker", phone: "title", skeleton: "52px",
    render: (s) => <TickerLabel ticker={s.ticker} className={styles.ticker} /> },
  { key: "next", label: "Next Earnings", caption: "Next earnings", cellClassName: styles.muted, skeleton: "76px",
    render: (s) => (s.next_earnings ? formatDate(s.next_earnings) : "—") },
  { key: "strong", label: <Term tip="Number of analysts rating it Strong Buy">Str Buy</Term>, caption: "Strong buy",
    align: "end", skeleton: "32px", render: (s) => s.rec_strong_buy ?? "—" },
  { key: "buy", label: "Buy", align: "end", skeleton: "32px", render: (s) => s.rec_buy ?? "—" },
  { key: "hold", label: "Hold", align: "end", skeleton: "32px", render: (s) => s.rec_hold ?? "—" },
  { key: "sell", label: "Sell", align: "end", skeleton: "32px", render: (s) => s.rec_sell ?? "—" },
  { key: "latest", caption: "Latest", phone: "value", skeleton: "56px",
    label: <Term tip="The most recent rating action: upgrade, downgrade, initiation or reiteration">Latest</Term>,
    render: (s) => (
      <span className={styles.badge} data-tone={actionTone(s.latest_action)}>{actionLabel(s.latest_action)}</span>
    ) },
  { key: "firm", label: "Firm", cellClassName: styles.firm, truncate: true, phone: "subtitle", skeleton: "80px",
    render: (s) => s.latest_firm || "—" },
  { key: "updated", label: "Updated", skeleton: "60px", render: (s) => <FreshnessCell fetched_at={s.fetched_at} /> },
];

function FreshnessCell({ fetched_at }) {
  const text = formatRelativeTime(fetched_at);
  const tone = freshnessTone(fetched_at);
  return (
    <Tooltip content={freshnessTip(fetched_at)}>
      <span className={styles.freshness} data-tone={tone}>{text}</span>
    </Tooltip>
  );
}

function actionTone(action) {
  if (!action) return "neutral";
  const a = action.toLowerCase();
  if (a === "up" || a === "init" || a === "reit") return "buy";
  if (a === "down") return "sell";
  return "neutral";
}

function actionLabel(action) {
  if (!action) return "—";
  const map = { up: "Upgrade", down: "Downgrade", init: "Initiate", reit: "Reiterate" };
  return map[action.toLowerCase()] ?? action;
}

export default function AnalystPanel({ data, loading, busy, onRefresh, compact = false, onViewAll, collapsible = false, collapsed = false, onToggleCollapse }) {
  const showEmpty = !loading && data.length === 0;

  return (
    <section className={styles.panel} id="analyst">
      <header className={styles.head}>
        {collapsible && <CollapseToggle collapsed={collapsed} onClick={onToggleCollapse} label="Analyst" />}
        <div>
          <h2 className={styles.title}>Analyst Ratings <InfoTip term="analyst_rating" /></h2>
          <p className={styles.subtitle}>Yahoo Finance · current consensus &amp; recent upgrades/downgrades</p>
        </div>
        {compact && onViewAll && <ViewAll onClick={onViewAll} />}
      </header>

      {!collapsed && (showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="star" size={24} /></span>
          <p className={styles.emptyTitle}>No analyst data loaded yet</p>
          <button className={styles.emptyBtn} onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      ) : (
        <DataTable columns={COLUMNS} rows={data} rowKey={(s) => s.ticker} limit={compact ? COMPACT_LIMIT : undefined}
                   loading={loading} skeletonRows={6} stickyHeader />
      ))}
    </section>
  );
}
