import Icon from "./Icon";
import styles from "./BoomScorePanel.module.css";

const CHIP_LABELS = {
  golden_cross:        "Golden ✕",
  insider_cluster_buy: "Insider Cluster",
  congress_buy:        "Congress Buy",
  analyst_upgrade:     "Analyst Up",
  short_squeeze:       "High Short",
  wsb_rising:          "WSB↑",
  rsi_recovery:        "RSI Zone",
};

function scoreTone(score) {
  if (score >= 60) return "high";
  if (score >= 30) return "mid";
  return "low";
}

export default function BoomScorePanel({ data, loading, busy, onRefresh }) {
  const showEmpty = !loading && data.length === 0;

  return (
    <section className={styles.panel} id="boom-score">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Boom Score</h2>
          <p className={styles.subtitle}>
            Composite signal strength · 0–100 · ranked by conviction
          </p>
        </div>
      </header>

      {showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="spark" size={24} /></span>
          <p className={styles.emptyTitle}>Add tickers to your watchlist</p>
          <p className={styles.emptyHint}>Scores compute automatically once data is loaded.</p>
          <button className={styles.emptyBtn} onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      ) : (
        <ul className={styles.list}>
          {data.map((s, idx) => {
            const components = (() => {
              try { return JSON.parse(s.components); } catch { return {}; }
            })();
            const firedKeys = Object.keys(components);
            const tone = scoreTone(s.score);

            return (
              <li key={s.ticker} className={styles.row}>
                <span className={styles.rank}>{idx + 1}</span>

                <span className={styles.ticker}>{s.ticker}</span>

                <div className={styles.barWrap}>
                  <div className={styles.bar} data-tone={tone} style={{ width: `${s.score}%` }} />
                </div>

                <span className={styles.scoreBadge} data-tone={tone}>
                  {s.score}
                </span>

                <div className={styles.chips}>
                  {firedKeys.map((key) => (
                    <span key={key} className={styles.chip}>{CHIP_LABELS[key] ?? key}</span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
