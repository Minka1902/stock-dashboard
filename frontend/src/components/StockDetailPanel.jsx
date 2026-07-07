import { useEffect, useState } from "react";
import Icon from "./Icon";
import ChartPro from "./ChartPro";
import Skeleton from "./Skeleton";
import { getAnalyze, analysisReportUrl } from "../api";
import styles from "./StockDetailPanel.module.css";

const DIRECTIVE_TONE = {
  Accumulate: "buy", Hold: "hold", Reduce: "warn", Avoid: "sell",
};
const FEAS_TONE = { base: "base", likely: "buy", possible: "hold", unlikely: "muted" };

function n(v, d = 2) {
  return v == null ? "—" : Number(v).toFixed(d);
}

function Pane({ caption, right, children }) {
  return (
    <section className={styles.pane}>
      <div className={styles.paneHead}>
        <span className="caption">{caption}</span>
        {right}
      </div>
      <div className={styles.paneBody}>{children}</div>
    </section>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue} data-tone={tone}>{value}</span>
    </div>
  );
}

export default function StockDetailPanel({ ticker, onBack, watchlist, onAddWatch }) {
  // Track which ticker the loaded payload belongs to: switching tickers
  // shows the skeleton again without any synchronous setState in the effect.
  const [result, setResult] = useState(null);
  const [watchBusy, setWatchBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getAnalyze(ticker)
      .then((d) => { if (alive) setResult({ ticker, data: d }); })
      .catch(() => { if (alive) setResult({ ticker, data: null }); });
    return () => { alive = false; };
  }, [ticker]);

  const loading = result?.ticker !== ticker;
  const data = result?.data;
  const a = data?.analysis;
  const watched = watchlist?.some((w) => w.ticker === ticker);
  const canWatch = Boolean(onAddWatch) && watchlist && !watched;

  const addToWatchlist = () => {
    setWatchBusy(true);
    Promise.resolve(onAddWatch(ticker, ""))
      .catch(() => {})
      .finally(() => setWatchBusy(false));
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.topbar}>
        <button className={styles.back} onClick={onBack}>
          <Icon name="arrowRight" size={14} /> <span>Back</span>
        </button>
        <h2 className={styles.ticker}>{ticker}</h2>
        {a && <span className={styles.directive} data-tone={DIRECTIVE_TONE[a.directive]}>{a.directive}</span>}
        {a && (
          <span className={styles.conviction}>
            <span className={styles.convLabel}>conviction</span>
            <span className={styles.convTrack}>
              <span className={styles.convFill} data-neg={a.conviction < 0 ? "yes" : "no"}
                    style={{ width: `${Math.min(100, Math.abs(a.conviction))}%` }} />
            </span>
            <span className={styles.convNum} data-neg={a.conviction < 0 ? "yes" : "no"}>{a.conviction}</span>
          </span>
        )}
        <span className={styles.spacer} />
        {canWatch && (
          <button
            type="button"
            className={styles.reportBtn}
            onClick={addToWatchlist}
            disabled={watchBusy}
            title="Track this stock: adds it to your watchlist so every signal source covers it"
          >
            <Icon name="star" size={13} /> {watchBusy ? "Adding…" : "Watch"}
          </button>
        )}
        {watched && watchlist && (
          <span className={styles.reportBtn} title="Already on your watchlist" aria-disabled="true">
            <Icon name="star" size={13} /> Watching
          </span>
        )}
        {a && (
          <span className={styles.reportBtns}>
            <a className={styles.reportBtn} href={analysisReportUrl(ticker)}
               title="Download the full analysis as a standalone HTML report">
              <Icon name="news" size={13} /> Report
            </a>
            <a className={styles.reportBtn} href={analysisReportUrl(ticker, { print: true })}
               target="_blank" rel="noreferrer"
               title="Open the report print-ready — use the browser dialog to save as PDF">
              PDF
            </a>
          </span>
        )}
        {a?.price != null && <span className={styles.price}>${n(a.price)}</span>}
      </div>

      {loading ? (
        <Skeleton w="100%" h="460px" />
      ) : (
        <>
          <Pane caption="Chart">
            <ChartPro ticker={ticker} analysis={a} />
          </Pane>

          {!a && (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>No analysis yet for {ticker}</p>
              <p className={styles.emptyText}>
                Price history is still loading, or there isn't enough of it yet —
                an honest read needs about 30 trading days. Try again in a minute.
              </p>
            </div>
          )}
        </>
      )}
      {!loading && a && (
        <>

          <div className={styles.grid}>
            <Pane caption="Trade plan" right={a.rr != null && <span className={styles.rr}>{a.rr}:1</span>}>
              {a.stop == null ? (
                <p className={styles.muted}>No valid stop below price yet — plan pending.</p>
              ) : (
                <>
                  <div className={styles.stats}>
                    <Stat label="Entry" value={`$${n(a.entry)}`} />
                    <Stat label={`Stop (${a.stop_basis})`} value={`$${n(a.stop)}`} tone="neg" />
                    <Stat label="Target 3R" value={`$${n(a.target)}`} tone="pos" />
                    <Stat label="Risk / share" value={`$${n(a.risk_per_share)}`} tone="neg" />
                    <Stat label="Reward / share" value={`$${n(a.reward_per_share)}`} tone="pos" />
                    <Stat label="Shares" value={a.suggested_shares ?? "—"} />
                  </div>
                  <div className={styles.stopNote}>
                    ATR stop ${n(a.stop_atr)} · structure stop ${n(a.stop_structure)} → using the tighter.
                  </div>
                  <div className={styles.ladder}>
                    {a.targets.map((t) => (
                      <div key={t.r} className={styles.rung} title={t.why}>
                        <span className={styles.rungR}>{t.r}:1</span>
                        <span className={styles.rungPrice}>${n(t.price)}</span>
                        <span className={styles.feas} data-tone={FEAS_TONE[t.feasibility]}>{t.feasibility}</span>
                        <span className={styles.rungWhy}>{t.why}</span>
                      </div>
                    ))}
                  </div>
                  {a.account_size && (
                    <p className={styles.sizeNote}>
                      Sized to {a.risk_pct}% of ${Number(a.account_size).toLocaleString()} account.
                    </p>
                  )}
                </>
              )}
            </Pane>

            <Pane caption="Structure">
              <div className={styles.stats}>
                <Stat label="Trend" value={a.trend} tone={a.trend === "up" ? "pos" : a.trend === "down" ? "neg" : ""} />
                <Stat label="MA stack" value={a.ma_alignment.replace("stacked_", "")} />
                <Stat label="ATR(14)" value={`$${n(a.atr14)}${a.atr_pct ? ` (${n(a.atr_pct)}%)` : ""}`} />
                <Stat label="MA20 / 50" value={`${n(a.ma20)} / ${n(a.ma50)}`} />
                <Stat label="MA150 / 200" value={`${n(a.ma150)} / ${n(a.ma200)}`} />
              </div>
              <div className={styles.levels}>
                <div>
                  <span className="caption">Resistance</span>
                  {a.resistance.length ? a.resistance.map((l, i) => (
                    <span key={i} className={styles.level} data-tone="neg">${n(l.price)} <em>{l.touches}×</em></span>
                  )) : <span className={styles.muted}>none above</span>}
                </div>
                <div>
                  <span className="caption">Support</span>
                  {a.support.length ? a.support.map((l, i) => (
                    <span key={i} className={styles.level} data-tone="pos">${n(l.price)} <em>{l.touches}×</em></span>
                  )) : <span className={styles.muted}>none below</span>}
                </div>
              </div>
              {a.gaps.filter((g) => !g.filled).length > 0 && (
                <div className={styles.gaps}>
                  <span className="caption">Unfilled gaps</span>
                  {a.gaps.filter((g) => !g.filled).map((g, i) => (
                    <span key={i} className={styles.level} data-tone={g.kind === "up" ? "pos" : "neg"}>
                      {g.kind} {n(g.pct)}% · {g.date}
                    </span>
                  ))}
                </div>
              )}
            </Pane>

            <Pane caption="Patterns">
              {a.patterns.length === 0 ? (
                <p className={styles.muted}>No classical pattern reads clearly right now.</p>
              ) : (
                <ul className={styles.patterns}>
                  {a.patterns.map((p, i) => (
                    <li key={i} className={styles.pattern}>
                      <span className={styles.patName}>{p.label}</span>
                      <span className={styles.patDir} data-tone={p.direction === "bullish" ? "pos" : p.direction === "bearish" ? "neg" : ""}>{p.direction}</span>
                      <span className={styles.patConf}>{Math.round(p.confidence * 100)}%</span>
                      {p.measured_move && <span className={styles.patMove}>→ ${n(p.measured_move)}</span>}
                      <span className={styles.patNote}>{p.note}</span>
                      <span className={styles.patPivots}>
                        {p.pivots.map((pv, j) => <em key={j}>{pv.role} ${n(pv.price)}</em>)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Pane>

            <Pane caption="Why — the read">
              <ul className={styles.reasons}>
                {a.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
              <p className={styles.disclaimer}>{a.disclaimer}</p>
            </Pane>
          </div>
        </>
      )}
    </div>
  );
}
