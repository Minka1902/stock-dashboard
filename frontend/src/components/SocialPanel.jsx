import Icon from "./Icon";
import DataTable from "./DataTable";
import ViewAll from "./ViewAll";
import CollapseToggle from "./CollapseToggle";
import TickerLabel from "./TickerLabel";
import styles from "./SocialPanel.module.css";
import Term from "./Term";
import Tooltip from "./Tooltip";
import InfoTip from "./InfoTip";

const COMPACT_LIMIT = 5;

const COLUMNS = [
  { key: "ticker", label: "Ticker", phone: "title", skeleton: "52px",
    render: (s) => <TickerLabel ticker={s.ticker} className={styles.ticker} /> },
  { key: "rank", caption: "Rank", label: <Term term="wsb_rank">Rank</Term>, align: "end", phone: "subtitle",
    skeleton: "40px", phoneRender: (s) => (s.rank == null ? "unranked" : `#${s.rank}`), render: (s) => s.rank ?? "—" },
  { key: "mentions", caption: "Mentions", align: "end", phone: "value", skeleton: "60px",
    label: <Term tip="Mention count across Reddit stock communities, as reported by ApeWisdom (last 24 hours)">Mentions</Term>,
    render: (s) => (s.mentions != null ? s.mentions.toLocaleString() : "—") },
  { key: "change", caption: "Rank change", phone: "value", skeleton: "56px",
    label: <Term tip="Places gained (↑) or lost (↓) in the mention rank vs 24 hours ago">Rank Change</Term>,
    render: (s) => <RankChange change={s.rank_change} /> },
];

function RankChange({ change }) {
  if (change == null) return <span className={styles.muted}>—</span>;
  const places = (n) => `${n} place${n === 1 ? "" : "s"}`;
  if (change > 0) {
    return (
      <Tooltip content={`Up ${places(change)} in mention rank vs 24 hours ago`}>
        <span className={styles.rising}>↑{change}</span>
      </Tooltip>
    );
  }
  if (change < 0) {
    return (
      <Tooltip content={`Down ${places(Math.abs(change))} in mention rank vs 24 hours ago`}>
        <span className={styles.falling}>↓{Math.abs(change)}</span>
      </Tooltip>
    );
  }
  return <span className={styles.muted}>—</span>;
}

export default function SocialPanel({ data, loading, busy, onRefresh, compact = false, onViewAll, collapsible = false, collapsed = false, onToggleCollapse }) {
  const showEmpty = !loading && data.length === 0;

  return (
    <section className={styles.panel} id="social">
      <header className={styles.head}>
        {collapsible && <CollapseToggle collapsed={collapsed} onClick={onToggleCollapse} label="WSB Sentiment" />}
        <div>
          <h2 className={styles.title}>WSB Sentiment <InfoTip term="wsb_rank" /></h2>
          <p className={styles.subtitle}>ApeWisdom · Reddit mentions &amp; rank movement for watchlist tickers</p>
        </div>
        {compact && onViewAll && <ViewAll onClick={onViewAll} />}
      </header>

      {!collapsed && (showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="news" size={24} /></span>
          <p className={styles.emptyTitle}>No social sentiment data loaded yet</p>
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
