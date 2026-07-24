import { useMemo, useState } from "react";
import { motion } from "motion/react";
import Icon from "./Icon";
import Skeleton from "./Skeleton";
import ViewAll from "./ViewAll";
import CollapseToggle from "./CollapseToggle";
import EmptyState from "./EmptyState";
import XPostCard from "./XPostCard";
import { sourceStale } from "../lib/sources";
import { prefersReducedMotion, staggerContainer, staggerItem } from "../lib/motionConfig";
import { formatRelativeTime } from "../lib/format";
import styles from "./NewsPanel.module.css";

const COMPACT_LIMIT = 5;

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

export default function NewsPanel({ news, portfolio = [], xPosts = [], sources = [], loading, busy, onRefresh, compact = false, onViewAll, collapsible = false, collapsed = false, onToggleCollapse }) {
  const held = useMemo(() => new Set(portfolio.map((h) => h.ticker)), [portfolio]);
  const tickers = useMemo(
    () => [...new Set(news.filter((a) => a.ticker).map((a) => a.ticker))].sort(),
    [news],
  );
  const hasTagged = tickers.length > 0;

  // "portfolio" = articles tagged with any held/watched symbol; default to it
  // when the user actually holds something and tagged articles exist.
  const [filter, setFilter] = useState(null); // null = auto
  const active = filter ?? (hasTagged && held.size > 0 ? "portfolio" : "all");

  // If the GDELT news source hasn't responded in the last 24h (errored, or its
  // last refresh is stale), discard the now-stale articles and fall back to the
  // X Watch feed — the only live option. Signals, not stale data.
  const newsStatus = useMemo(() => sources.find((s) => s.source === "gdelt"), [sources]);
  const newsStale = sourceStale(newsStatus, 24);
  const effectiveActive = newsStale ? "x" : active;

  const filtered = useMemo(() => {
    if (active === "all") return news;
    if (active === "macro") return news.filter((a) => !a.ticker);
    if (active === "portfolio") return news.filter((a) => a.ticker && (held.size === 0 || held.has(a.ticker)));
    return news.filter((a) => a.ticker === active);
  }, [news, active, held]);

  const showEmpty = !loading && news.length === 0;
  const rows = compact ? filtered.slice(0, COMPACT_LIMIT) : filtered;

  // X tab: date-sorted posts from the monitored accounts (Task 1).
  const isX = effectiveActive === "x";
  const xRows = useMemo(
    () => [...xPosts].sort(
      (a, b) => (Date.parse(b.posted_at) || 0) - (Date.parse(a.posted_at) || 0),
    ),
    [xPosts],
  );

  return (
    <section className={styles.panel} id="news">
      <header className={styles.head}>
        {collapsible && <CollapseToggle collapsed={collapsed} onClick={onToggleCollapse} label="News" />}
        <div>
          <h2 className={styles.title}>News</h2>
          <p className={styles.subtitle}>
            Your portfolio&apos;s tape plus macro headlines, aggregated from GDELT
          </p>
        </div>
        {compact && onViewAll && <ViewAll onClick={onViewAll} />}
      </header>

      {!collapsed && newsStale && (
        <p className={styles.staleNote}>
          <Icon name="info" size={13} /> News hasn’t responded in the last 24h — showing X&nbsp;Watch only.
        </p>
      )}

      {!collapsed && !compact && !showEmpty && !newsStale && (
        <div className={styles.tabs} role="tablist" aria-label="News filter">
          <button className={styles.tab} role="tab" aria-selected={active === "all"}
                  data-active={active === "all" ? "yes" : "no"} onClick={() => setFilter("all")}>
            All
          </button>
          {hasTagged && (
            <button className={styles.tab} role="tab" aria-selected={active === "portfolio"}
                    data-active={active === "portfolio" ? "yes" : "no"} onClick={() => setFilter("portfolio")}>
              Portfolio
            </button>
          )}
          <button className={styles.tab} role="tab" aria-selected={active === "macro"}
                  data-active={active === "macro" ? "yes" : "no"} onClick={() => setFilter("macro")}>
            Macro
          </button>
          {xPosts.length > 0 && (
            <button className={styles.tab} role="tab" aria-selected={active === "x"}
                    data-active={active === "x" ? "yes" : "no"} onClick={() => setFilter("x")}>
              X
            </button>
          )}
          {tickers.map((t) => (
            <button key={t} className={styles.tab} role="tab" aria-selected={active === t}
                    data-active={active === t ? "yes" : "no"} onClick={() => setFilter(t)}>
              {t}
            </button>
          ))}
        </div>
      )}

      {!collapsed && (showEmpty && !isX ? (
        <EmptyState icon="news" title="No news loaded yet" onRetry={onRefresh} busy={busy} />
      ) : (
        <motion.ul
          className={styles.list}
          variants={loading ? undefined : staggerContainer}
          initial={loading || prefersReducedMotion() ? false : "hidden"}
          animate="visible"
        >
          {isX ? (
            xRows.length === 0 ? (
              <li className={styles.noMatch}>
                No X posts loaded yet — they arrive with the next refresh.
              </li>
            ) : (
              xRows.map((p) => (
                <motion.li key={`${p.account}:${p.post_id}`} variants={staggerItem}>
                  <XPostCard post={p} compact />
                </motion.li>
              ))
            )
          ) : loading ? (
            <SkeletonItems />
          ) : rows.length === 0 ? (
            <li className={styles.noMatch}>
              No articles for this filter yet — they arrive with the next news refresh.
            </li>
          ) : (
            rows.map((a) => (
              <motion.li key={a.url} className={styles.item} variants={staggerItem}>
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
                    {a.ticker && <span className={styles.tickerBadge}>{a.ticker}</span>}
                    <span className={styles.domain}>{a.domain}</span>
                    {a.sourcecountry && <span className={styles.sep}>·</span>}
                    {a.sourcecountry && <span>{a.sourcecountry}</span>}
                    <span className={styles.sep}>·</span>
                    <span>{formatRelativeTime(a.seendate)}</span>
                  </div>
                </div>
              </motion.li>
            ))
          )}
        </motion.ul>
      ))}
    </section>
  );
}
