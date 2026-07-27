import { useMemo, useState } from "react";
import { motion } from "motion/react";
import Icon from "./Icon";
import Skeleton from "./Skeleton";
import ViewAll from "./ViewAll";
import CollapseToggle from "./CollapseToggle";
import EmptyState from "./EmptyState";
import XPostCard from "./XPostCard";
import TickerLabel from "./TickerLabel";
import { sourceStale } from "../lib/sources";
import { SORT_COLUMNS, sourceCounts, unifyFeed } from "../lib/newsSources";
import { useSortableRows } from "../hooks/useSortableRows";
import { prefersReducedMotion, staggerContainer, staggerItem } from "../lib/motionConfig";
import { formatRelativeTime } from "../lib/format";
import styles from "./NewsPanel.module.css";

const COMPACT_LIMIT = 5;
// GDELT can return a hundred-plus distinct domains. Showing every chip buries
// the feed, so the rail leads with the most prolific sources and expands.
const SOURCE_CHIP_LIMIT = 12;

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

function Article({ a, onPickSource }) {
  return (
    <>
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
          <button
            className={styles.domainBtn}
            onClick={() => onPickSource(String(a.domain || "").replace(/^www\./i, "").toLowerCase())}
            title={`Show only ${a.domain}`}
          >
            {a.domain}
          </button>
          {a.sourcecountry && <span className={styles.sep}>·</span>}
          {a.sourcecountry && <span>{a.sourcecountry}</span>}
          <span className={styles.sep}>·</span>
          <span>{formatRelativeTime(a.seendate)}</span>
        </div>
      </div>
    </>
  );
}

function SortButton({ label, sortKey, sort, onSort }) {
  const active = sort?.key === sortKey;
  return (
    <button
      type="button"
      className={styles.sortBtn}
      data-active={active ? "yes" : "no"}
      aria-pressed={active}
      onClick={onSort}
      title={`Sort by ${label}`}
    >
      {label}
      <span className={styles.caret} aria-hidden="true">
        {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </button>
  );
}

export default function NewsPanel({ news = [], portfolio = [], xPosts = [], sources = [], loading, busy, onRefresh, compact = false, onViewAll, collapsible = false, collapsed = false, onToggleCollapse }) {
  const held = useMemo(() => new Set(portfolio.map((h) => h.ticker)), [portfolio]);

  // Articles and X posts as one list, so "source" means the same thing for both
  // and a publisher can be compared against an individual X account.
  const items = useMemo(() => unifyFeed(news, xPosts), [news, xPosts]);

  const tickers = useMemo(
    () => [...new Set(items.flatMap((i) => i.tickers))].sort(),
    [items],
  );
  const hasTagged = tickers.length > 0;

  const [filter, setFilter] = useState(null);   // topic; null = auto
  const [source, setSource] = useState(null);   // null = every source
  const [allSources, setAllSources] = useState(false);
  const active = filter ?? (hasTagged && held.size > 0 ? "portfolio" : "all");

  // If GDELT hasn't responded in 24h its articles are stale; fall back to the X
  // feed, which is the only live option. Signals, not stale data.
  const newsStatus = useMemo(() => sources.find((s) => s.source === "gdelt"), [sources]);
  const newsStale = sourceStale(newsStatus, 24);

  const byTopic = useMemo(() => {
    let rows = items;
    if (newsStale) rows = rows.filter((i) => i.kind === "x");
    if (active === "macro") return rows.filter((i) => i.tickers.length === 0);
    if (active === "portfolio") {
      return rows.filter((i) => i.tickers.some((t) => held.size === 0 || held.has(t)));
    }
    if (active !== "all") return rows.filter((i) => i.tickers.includes(active));
    return rows;
  }, [items, active, held, newsStale]);

  // Counts come from the topic-filtered set, so each number describes what
  // clicking that source would actually show.
  const counts = useMemo(() => sourceCounts(byTopic), [byTopic]);

  // Always keep the selected source visible, even when it's outside the top N.
  const shownSources = useMemo(() => {
    if (allSources || counts.length <= SOURCE_CHIP_LIMIT) return counts;
    const head = counts.slice(0, SOURCE_CHIP_LIMIT);
    if (source && !head.some((s) => s.source === source)) {
      const picked = counts.find((s) => s.source === source);
      if (picked) return [...head, picked];
    }
    return head;
  }, [counts, allSources, source]);
  const hiddenSources = counts.length - Math.min(counts.length, SOURCE_CHIP_LIMIT);

  const filtered = useMemo(
    () => (source ? byTopic.filter((i) => i.source === source) : byTopic),
    [byTopic, source],
  );

  const { sorted, sort, sortProps } = useSortableRows(
    filtered, SORT_COLUMNS, { key: "when", dir: "desc" },
  );

  const showEmpty = !loading && items.length === 0;
  const rows = compact ? sorted.slice(0, COMPACT_LIMIT) : sorted;

  const pickSource = (s) => setSource((cur) => (cur === s ? null : s));

  return (
    <section className={styles.panel} id="news">
      <header className={styles.head}>
        {collapsible && <CollapseToggle collapsed={collapsed} onClick={onToggleCollapse} label="News" />}
        <div>
          <h2 className={styles.title}>News</h2>
          <p className={styles.subtitle}>
            Your portfolio&apos;s tape plus macro headlines, from GDELT and the X accounts you follow
          </p>
        </div>
        {compact && onViewAll && <ViewAll onClick={onViewAll} />}
      </header>

      {!collapsed && newsStale && (
        <p className={styles.staleNote}>
          <Icon name="info" size={13} /> News hasn’t responded in the last 24h — showing X&nbsp;Watch only.
        </p>
      )}

      {!collapsed && !compact && !showEmpty && (
        <>
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
            {tickers.map((t) => (
              <button key={t} className={styles.tab} role="tab" aria-selected={active === t}
                      data-active={active === t ? "yes" : "no"} onClick={() => setFilter(t)}>
                {t}
              </button>
            ))}
          </div>

          <div className={styles.sourceBar}>
            <div className={styles.sources} role="group" aria-label="Filter by source">
              <span className={styles.sourceLabel}>Source</span>
              <button
                type="button"
                className={styles.sourceChip}
                data-active={source === null ? "yes" : "no"}
                onClick={() => setSource(null)}
              >
                All <span className={styles.count}>{byTopic.length}</span>
              </button>
              {shownSources.map((s) => (
                <button
                  key={s.source}
                  type="button"
                  className={styles.sourceChip}
                  data-active={source === s.source ? "yes" : "no"}
                  data-kind={s.kind}
                  onClick={() => pickSource(s.source)}
                  title={s.kind === "x" ? `X account ${s.source}` : `Publisher ${s.source}`}
                >
                  {s.source} <span className={styles.count}>{s.count}</span>
                </button>
              ))}
              {hiddenSources > 0 && (
                <button
                  type="button"
                  className={styles.moreSources}
                  onClick={() => setAllSources((v) => !v)}
                >
                  {allSources ? "show fewer" : `+${hiddenSources} more`}
                </button>
              )}
            </div>

            <div className={styles.sortGroup} role="group" aria-label="Sort">
              <SortButton label="Source" sortKey="source" sort={sort} onSort={sortProps("source").onSort} />
              <SortButton label="Time" sortKey="when" sort={sort} onSort={sortProps("when").onSort} />
            </div>
          </div>
        </>
      )}

      {!collapsed && (showEmpty ? (
        <EmptyState icon="news" title="No news loaded yet" onRetry={onRefresh} busy={busy} />
      ) : (
        <motion.ul
          className={styles.list}
          variants={loading ? undefined : staggerContainer}
          initial={loading || prefersReducedMotion() ? false : "hidden"}
          animate="visible"
        >
          {loading ? (
            <SkeletonItems />
          ) : rows.length === 0 ? (
            <li className={styles.noMatch}>
              Nothing matches this filter yet — more arrives with the next refresh.
            </li>
          ) : (
            rows.map((it) => (
              <motion.li
                key={it.id}
                className={it.kind === "x" ? styles.xItem : styles.item}
                data-source={it.source}
                data-kind={it.kind}
                variants={staggerItem}
              >
                {it.kind === "x"
                  ? <XPostCard post={it.raw} compact />
                  : <Article a={it.raw} onPickSource={pickSource} />}
              </motion.li>
            ))
          )}
        </motion.ul>
      ))}
    </section>
  );
}
