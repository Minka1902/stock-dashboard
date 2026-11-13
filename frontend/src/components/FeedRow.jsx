import { formatRelativeTime } from "../lib/format";
import { openTickerTab } from "../lib/nav";
import styles from "./FeedRow.module.css";

/**
 * One feed item on a phone, an article and an X post alike: the headline (or
 * the post) in two lines, then source · time and the tagged tickers. The
 * source filters the feed to it (`onPickSource`); a ticker opens its analysis.
 * `item` is a unified feed item (lib/newsSources.js `unifyFeed`).
 */
export default function FeedRow({ item, onPickSource }) {
  const { raw, kind, source, tickers } = item;
  const post = kind === "x";

  return (
    <>
      <a className={styles.title} href={raw.url || undefined} target="_blank" rel="noreferrer">
        {post ? raw.text : raw.title}
      </a>
      <div className={styles.meta}>
        <button type="button" className={styles.source} data-kind={kind}
                aria-label={`Show only ${source}`} onClick={() => onPickSource(source)}>
          {source}
        </button>
        <span className={styles.sep} aria-hidden="true">·</span>
        <span>{formatRelativeTime(post ? raw.posted_at : raw.seendate)}</span>
        {tickers.length > 0 && (
          <span className={styles.tickers}>
            {tickers.map((t) => (
              <button key={t} type="button" className={styles.ticker}
                      aria-label={`Analyze ${t} in a new tab`} onClick={() => openTickerTab(t)}>
                {t}
              </button>
            ))}
          </span>
        )}
      </div>
    </>
  );
}
