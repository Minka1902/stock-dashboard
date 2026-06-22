import Icon from "./Icon";
import Skeleton from "./Skeleton";
import { formatRelativeTime } from "../lib/format";
import styles from "./NewsPanel.module.css";

function SkeletonItems({ rows = 6 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <li key={i} className={styles.item}>
      <div className={styles.body}>
        <Skeleton w="80%" h="15px" />
        <Skeleton w="40%" h="11px" />
      </div>
    </li>
  ));
}

export default function NewsPanel({ news, loading, busy, onRefresh }) {
  const showEmpty = !loading && news.length === 0;

  return (
    <section className={styles.panel} id="news">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>World &amp; market news</h2>
          <p className={styles.subtitle}>
            Geopolitics and economy, aggregated from GDELT
          </p>
        </div>
      </header>

      {showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="news" size={24} /></span>
          <p className={styles.emptyTitle}>No news loaded yet</p>
          <button className={styles.emptyBtn} onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      ) : (
        <ul className={styles.list}>
          {loading ? (
            <SkeletonItems />
          ) : (
            news.map((a) => (
              <li key={a.url} className={styles.item}>
                {a.image ? (
                  <img className={styles.thumb} src={a.image} alt="" loading="lazy" />
                ) : (
                  <span className={styles.thumbFallback}><Icon name="news" size={18} /></span>
                )}
                <div className={styles.body}>
                  <a className={styles.headline} href={a.url} target="_blank" rel="noreferrer">
                    {a.title}
                  </a>
                  <div className={styles.meta}>
                    <span className={styles.domain}>{a.domain}</span>
                    {a.sourcecountry && <span className={styles.sep}>·</span>}
                    {a.sourcecountry && <span>{a.sourcecountry}</span>}
                    <span className={styles.sep}>·</span>
                    <span>{formatRelativeTime(a.seendate)}</span>
                  </div>
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  );
}
