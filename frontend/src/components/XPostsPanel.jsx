import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Icon from "./Icon";
import { openTickerTab } from "../lib/nav";
import { initialsFor, gradientFor } from "../lib/avatar";
import { sourceState, sourceNote } from "../lib/sources";
import { formatRelativeTime } from "../lib/format";
import { staggerContainer, staggerItem, prefersReducedMotion } from "../lib/motionConfig";
import styles from "./XPostsPanel.module.css";

const CASHTAG_SPLIT_RE = /(\$[A-Za-z]{1,5})\b/g;
const CASHTAG_TEST_RE = /^\$[A-Za-z]{1,5}$/;

// Render post text with clickable $TICKER chips.
function PostText({ text, onTicker }) {
  const parts = text.split(CASHTAG_SPLIT_RE);
  return (
    <p className={styles.text}>
      {parts.map((part, i) => {
        if (CASHTAG_TEST_RE.test(part)) {
          const t = part.slice(1).toUpperCase();
          return (
            <button
              key={i}
              type="button"
              className={styles.cashtag}
              onClick={() => onTicker(t)}
              title={`Analyze ${t} in a new tab`}
            >
              {part}
            </button>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
  );
}

/**
 * X (Twitter) watch feed. Renders stored posts from the monitored accounts with
 * clickable cashtags. When no official X API key is configured the source is
 * flagged as an unofficial mirror (its status is stamped as an error upstream),
 * which we surface as a caveat tag without hiding the real data.
 */
export default function XPostsPanel({ data = [], sources = [], loading, busy, onRefresh }) {
  const [account, setAccount] = useState("all");

  const status = sources.find((s) => s.source === "x_posts");
  const isDegraded = status && sourceState(status.status) === "error" && data.length > 0;
  const mirrorNote = status ? sourceNote(status.status) || status.status.replace(/^error:\s*/, "") : null;

  const accounts = useMemo(
    () => Array.from(new Set(data.map((p) => p.account))),
    [data],
  );
  const posts = account === "all" ? data : data.filter((p) => p.account === account);
  const showEmpty = !loading && data.length === 0;

  return (
    <section className={styles.panel} id="x">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>X Watch</h2>
          <p className={styles.subtitle}>
            Recent posts from monitored accounts, with detected cashtags. Signals, not predictions.
          </p>
        </div>
        <button className={styles.refresh} onClick={onRefresh} disabled={busy} title="Refresh">
          <Icon name="refresh" size={15} /> {busy ? "…" : "Refresh"}
        </button>
      </header>

      {isDegraded && (
        <p className={styles.degraded} title={mirrorNote || undefined}>
          <Icon name="info" size={13} /> Unofficial mirror — set <code>STOCKS_X_BEARER</code> for the
          official X API. Data shown is real but its provenance is unverified.
        </p>
      )}

      {accounts.length > 1 && (
        <div className={styles.tabs} role="tablist" aria-label="Filter by account">
          <button
            className={styles.tab} data-active={account === "all" ? "yes" : "no"}
            role="tab" aria-selected={account === "all"} onClick={() => setAccount("all")}
          >
            All
          </button>
          {accounts.map((a) => (
            <button
              key={a} className={styles.tab} data-active={account === a ? "yes" : "no"}
              role="tab" aria-selected={account === a} onClick={() => setAccount(a)}
            >
              @{a}
            </button>
          ))}
        </div>
      )}

      {showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="x" size={22} /></span>
          <p className={styles.emptyTitle}>No posts loaded yet</p>
          <button className={styles.emptyBtn} onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      ) : (
        <motion.ul
          className={styles.feed}
          variants={staggerContainer}
          initial={prefersReducedMotion() ? false : "hidden"}
          animate="visible"
        >
          <AnimatePresence initial={false}>
            {posts.map((p) => (
              <motion.li
                key={`${p.account}:${p.post_id}`}
                className={styles.post}
                variants={staggerItem}
                layout={!prefersReducedMotion()}
              >
                <span
                  className={styles.avatar}
                  style={{ background: gradientFor(p.account) }}
                  aria-hidden="true"
                >
                  {initialsFor(p.account)}
                </span>
                <div className={styles.postBody}>
                  <div className={styles.postHead}>
                    <span className={styles.handle}>@{p.account}</span>
                    {p.posted_at && (
                      <span className={styles.time}>{formatRelativeTime(p.posted_at)}</span>
                    )}
                    {p.url && (
                      <a
                        className={styles.link}
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open original post"
                      >
                        <Icon name="arrowRight" size={13} />
                      </a>
                    )}
                  </div>
                  <PostText text={p.text} onTicker={openTickerTab} />
                  {p.tickers && (
                    <div className={styles.tickerRow}>
                      {p.tickers.split(",").filter(Boolean).map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={styles.tickerChip}
                          onClick={() => openTickerTab(t)}
                          title={`Analyze ${t} in a new tab`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
    </section>
  );
}
