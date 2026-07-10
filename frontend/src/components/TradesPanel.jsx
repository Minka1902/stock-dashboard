import { motion } from "motion/react";
import Skeleton from "./Skeleton";
import ViewAll from "./ViewAll";
import CollapseToggle from "./CollapseToggle";
import EmptyState from "./EmptyState";
import { prefersReducedMotion, staggerContainer, staggerItem } from "../lib/motionConfig";
import {
  formatCurrencyCompact,
  formatCurrencyFull,
  formatCount,
  formatDate,
} from "../lib/format";
import styles from "./TradesPanel.module.css";

const COMPACT_LIMIT = 5;

function typeTone(type) {
  if (type === "Buy") return "buy";
  if (type === "Sell") return "sell";
  return "neutral";
}

function SkeletonRows({ rows = 8 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i}>
      <td><Skeleton w="46px" /></td>
      <td><Skeleton w="64px" /></td>
      <td><Skeleton w="70%" /></td>
      <td className={styles.num}><Skeleton w="60px" /></td>
      <td className={styles.num}><Skeleton w="70px" /></td>
      <td><Skeleton w="64px" /></td>
    </tr>
  ));
}

export default function TradesPanel({ trades, loading, busy, onRefresh, compact = false, onViewAll, collapsible = false, collapsed = false, onToggleCollapse }) {
  const showEmpty = !loading && trades.length === 0;
  const rows = compact ? trades.slice(0, COMPACT_LIMIT) : trades;

  return (
    <section className={styles.panel} id="trades">
      <header className={styles.head}>
        {collapsible && <CollapseToggle collapsed={collapsed} onClick={onToggleCollapse} label="Trades" />}
        <div>
          <h2 className={styles.title}>Insider trades</h2>
          <p className={styles.subtitle}>
            Corporate insiders (SEC Form 4) buying and selling their own stock
          </p>
        </div>
        {compact && onViewAll && <ViewAll onClick={onViewAll} />}
      </header>

      {!collapsed && (showEmpty ? (
        <EmptyState icon="trending" title="No insider filings loaded yet" onRetry={onRefresh} busy={busy} />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Action</th>
                <th>Insider</th>
                <th className={styles.num}>Shares</th>
                <th className={styles.num}>Value</th>
                <th>Date</th>
              </tr>
            </thead>
            <motion.tbody
              variants={loading ? undefined : staggerContainer}
              initial={loading || prefersReducedMotion() ? false : "hidden"}
              animate="visible"
            >
              {loading ? (
                <SkeletonRows />
              ) : (
                rows.map((t) => (
                  <motion.tr key={t.accession} variants={staggerItem}>
                    <td>
                      <a
                        className={styles.ticker}
                        href={t.filing_url}
                        target="_blank"
                        rel="noreferrer"
                        title={`${t.company} — view filing`}
                      >
                        {t.ticker || "—"}
                      </a>
                    </td>
                    <td>
                      <span className={styles.badge} data-tone={typeTone(t.transaction_type)}>
                        {t.transaction_type}
                      </span>
                    </td>
                    <td className={styles.insider}>
                      <span className={styles.owner} title={t.owner}>{t.owner}</span>
                      <span className={styles.role} title={t.role}>{t.role}</span>
                    </td>
                    <td className={`${styles.num} tabular`}>{formatCount(Math.round(t.shares))}</td>
                    <td className={`${styles.num} tabular`} title={formatCurrencyFull(t.value)}>
                      {t.value > 0 ? formatCurrencyCompact(t.value) : "—"}
                    </td>
                    <td className={styles.muted}>{formatDate(t.transaction_date)}</td>
                  </motion.tr>
                ))
              )}
            </motion.tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
