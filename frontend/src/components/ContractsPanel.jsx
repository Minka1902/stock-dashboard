import Icon from "./Icon";
import Skeleton from "./Skeleton";
import {
  formatCurrencyCompact,
  formatCurrencyFull,
  formatDate,
} from "../lib/format";
import styles from "./ContractsPanel.module.css";

function SkeletonRows({ rows = 8 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i}>
      <td><Skeleton w="70%" /></td>
      <td><Skeleton w="50%" /></td>
      <td className={styles.amountCell}><Skeleton w="60px" /></td>
      <td><Skeleton w="64px" /></td>
      <td><Skeleton w="80%" /></td>
    </tr>
  ));
}

export default function ContractsPanel({ contracts, loading, busy, onRefresh }) {
  const showEmpty = !loading && contracts.length === 0;

  return (
    <section className={styles.panel} id="contracts">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Biggest recent federal contracts</h2>
          <p className={styles.subtitle}>
            Sourced live from USASpending.gov · sorted by award amount
          </p>
        </div>
      </header>

      {showEmpty ? (
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
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Agency</th>
                <th className={styles.amountCell}>Amount</th>
                <th>Start</th>
                <th>Award ID</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows />
              ) : (
                contracts.map((c) => (
                  <tr key={c.external_id}>
                    <td className={styles.recipient} title={c.recipient_name}>
                      {c.recipient_name}
                    </td>
                    <td>
                      <span className={styles.agency} title={c.awarding_agency}>
                        {c.awarding_agency}
                      </span>
                    </td>
                    <td
                      className={`${styles.amountCell} ${styles.amount} tabular`}
                      title={formatCurrencyFull(c.amount)}
                    >
                      {formatCurrencyCompact(c.amount)}
                    </td>
                    <td className={styles.muted}>{formatDate(c.start_date)}</td>
                    <td className={styles.award} title={c.award_id}>
                      {c.award_id || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
