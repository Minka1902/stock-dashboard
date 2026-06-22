import Icon from "./Icon";
import Skeleton from "./Skeleton";
import { formatDate } from "../lib/format";
import styles from "./CongressPanel.module.css";

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

function SkeletonRows({ rows = 8 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i}>
      <td><Skeleton w="140px" /></td>
      <td><Skeleton w="28px" /></td>
      <td><Skeleton w="46px" /></td>
      <td><Skeleton w="70px" /></td>
      <td><Skeleton w="120px" /></td>
      <td><Skeleton w="64px" /></td>
    </tr>
  ));
}

export default function CongressPanel({ data, loading, busy, onRefresh }) {
  const showEmpty = !loading && data.length === 0;

  return (
    <section className={styles.panel} id="congress">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Congressional Trades</h2>
          <p className={styles.subtitle}>
            STOCK Act disclosures · House &amp; Senate · legislators trading ahead of policy booms
          </p>
        </div>
      </header>

      {showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="layers" size={24} /></span>
          <p className={styles.emptyTitle}>No congressional trades loaded yet</p>
          <button className={styles.emptyBtn} onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Representative</th>
                <th>Party</th>
                <th>Ticker</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows />
              ) : (
                data.map((t) => (
                  <tr key={t.trade_hash}>
                    <td className={styles.rep} title={`${t.representative} (${t.state})`}>
                      <span className={styles.repName}>{t.representative}</span>
                      {t.state && <span className={styles.state}>{t.state}</span>}
                    </td>
                    <td>
                      {t.party ? (
                        <span className={styles.badge} data-tone={partyTone(t.party)}>
                          {t.party}
                        </span>
                      ) : "—"}
                    </td>
                    <td>
                      <span className={styles.ticker}>{t.ticker || "—"}</span>
                    </td>
                    <td>
                      <span className={styles.badge} data-tone={typeTone(t.transaction_type)}>
                        {t.transaction_type}
                      </span>
                    </td>
                    <td className={styles.amount}>{t.amount_range || "—"}</td>
                    <td className={styles.muted}>{formatDate(t.transaction_date)}</td>
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
