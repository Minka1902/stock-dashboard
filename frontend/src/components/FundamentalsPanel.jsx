import Icon from "./Icon";
import Skeleton from "./Skeleton";
import styles from "./FundamentalsPanel.module.css";

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

function SkeletonRows({ rows = 5 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i}>
      <td><Skeleton w="48px" /></td>
      <td><Skeleton w="80px" /></td>
      <td><Skeleton w="40px" /></td>
      <td><Skeleton w="40px" /></td>
      <td><Skeleton w="36px" /></td>
      <td><Skeleton w="40px" /></td>
      <td><Skeleton w="52px" /></td>
      <td><Skeleton w="52px" /></td>
      <td><Skeleton w="60px" /></td>
    </tr>
  ));
}

export default function FundamentalsPanel({ data, loading, busy, onRefresh }) {
  const showEmpty = !loading && data.length === 0;

  return (
    <section className={styles.panel} id="fundamentals">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Fundamentals</h2>
          <p className={styles.subtitle}>Yahoo Finance · valuation &amp; growth per watchlist ticker</p>
        </div>
      </header>

      {showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="star" size={24} /></span>
          <p className={styles.emptyTitle}>No fundamental data loaded yet</p>
          <button className={styles.emptyBtn} onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Sector</th>
                <th>P/E</th>
                <th>Fwd P/E</th>
                <th>PEG</th>
                <th>P/B</th>
                <th>Rev Growth</th>
                <th>Margin</th>
                <th>Mkt Cap</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows />
              ) : (
                data.map((f) => (
                  <tr key={f.ticker}>
                    <td><span className={styles.ticker}>{f.ticker}</span></td>
                    <td className={styles.sector}>{f.sector || "—"}</td>
                    <td className={styles.num}>{fmtRatio(f.pe_ratio)}</td>
                    <td className={styles.num}>{fmtRatio(f.forward_pe)}</td>
                    <td className={styles.num}>{f.peg_ratio != null ? f.peg_ratio.toFixed(2) : "—"}</td>
                    <td className={styles.num}>{fmtRatio(f.pb_ratio)}</td>
                    <td className={`${styles.num} ${styles.growth}`} data-tone={growthTone(f.revenue_growth)}>
                      {fmtPct(f.revenue_growth)}
                    </td>
                    <td className={styles.num}>{fmtPct(f.profit_margin)}</td>
                    <td className={styles.num}>{fmtCap(f.market_cap)}</td>
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
