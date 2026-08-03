import { useEffect, useState } from "react";
import Icon from "./Icon";
import ChartPro from "./ChartPro";
import CompanyInfo from "./CompanyInfo";
import InsiderTrades from "./InsiderTrades";
import Skeleton from "./Skeleton";
import StockAlerts from "./StockAlerts";
import SuggestionHistoryStrip from "./SuggestionHistoryStrip";
import TickerLabel from "./TickerLabel";
import XPostCard from "./XPostCard";
import { getAnalyze, analysisReportUrl } from "../api";
import { useSettingsContext } from "../hooks/useSettingsContext";
import styles from "./StockDetailPanel.module.css";

const DIRECTIVE_TONE = {
  Accumulate: "buy", Hold: "hold", Reduce: "warn", Avoid: "sell",
};
const RECO_TONE = { buy: "buy", hold: "hold", sell: "sell" };
const FEAS_TONE = { base: "base", likely: "buy", possible: "hold", unlikely: "muted" };
const SIGNAL_TONE = { bullish: "pos", bearish: "neg", neutral: "" };
const BREAKOUT_TONE = {
  confirmed: "pos", approaching: "hold", broke_unconfirmed: "hold", failed: "neg",
};

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

export default function StockDetailPanel({ ticker, onBack, watchlist, onAddWatch, focusAlertKey = null }) {
  // Track which ticker the loaded payload belongs to: switching tickers
  // shows the skeleton again without any synchronous setState in the effect.
  const [result, setResult] = useState(null);
  const [watchBusy, setWatchBusy] = useState(false);
  const { settings } = useSettingsContext();

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
  const anchors = data?.seasonality_anchors || [];
  const xPosts = data?.x_posts || [];
  const company = data?.company || null;
  const insiderTrades = data?.insider_trades || [];
  const stockAlerts = data?.alerts || [];
  const companyInfo = settings.companyInfo || {};
  const lastClose = data?.daily?.length ? data.daily[data.daily.length - 1].close : null;
  const refPrice = a?.price ?? lastClose;
  // Day change, derived from the same daily bars the chart draws and with the
  // same bar-to-bar formula as ChartPro's legend, so the two can't disagree on
  // the same screen. Not taken from /api/quotes: that only covers watchlist and
  // portfolio tickers, so an unwatched symbol would silently have no change at
  // all. null when there aren't two closes to compare — rendered as "—" rather
  // than a fabricated 0.00%.
  const prevClose = data?.daily?.length >= 2 ? data.daily[data.daily.length - 2].close : null;
  const changePct = prevClose && lastClose != null
    ? ((lastClose - prevClose) / prevClose) * 100
    : null;
  // Membership comes from the server across ALL of the user's lists — the old
  // check only saw the default list, so a ticker on a second list still
  // offered "Watch" (Task 18). Falls back to the passed-in list while loading.
  const memberOf = data?.watchlists ?? null;
  const watched = memberOf
    ? memberOf.length > 0
    : Boolean(watchlist?.some((w) => w.ticker === ticker));
  // `watchlist` is initialised to [] (truthy), so gate on the loaded payload
  // instead — otherwise "Watch" flashes before we know the answer.
  const canWatch = Boolean(onAddWatch) && !loading && !watched;

  // Confirmed by default: forming shapes are context, not conclusions, and
  // leading with them would overstate what the chart has actually done.
  const [patternFilter, setPatternFilter] = useState("confirmed");
  const allPatterns = a?.patterns || [];
  const confirmedCount = allPatterns.filter((p) => p.status !== "forming").length;
  const formingCount = allPatterns.length - confirmedCount;
  const shownPatterns = patternFilter === "all"
    ? allPatterns
    : allPatterns.filter((p) => p.status !== "forming");

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
        {/* Ticker and price read as one unit: the name of the thing and what
            it costs. They used to sit at opposite ends of the flex row. */}
        <span className={styles.identity}>
          <TickerLabel ticker={ticker} className={styles.ticker} as="h2" />
          {refPrice != null && (
            <span className={styles.priceGroup}>
              <span className={styles.price}>${n(refPrice)}</span>
              <span
                className={styles.change}
                data-tone={changePct == null ? "flat" : changePct >= 0 ? "pos" : "neg"}
                title={changePct == null
                  ? "Not enough daily history to compute a change"
                  : "Change vs the previous daily close"}
              >
                {changePct == null
                  ? "—"
                  : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}
              </span>
            </span>
          )}
        </span>
        {a && a.recommendation && (
          <span className={styles.directive} data-tone={RECO_TONE[a.recommendation]}
                title="Buy / Sell / Hold — the headline call">{a.recommendation.toUpperCase()}</span>
        )}
        {a && <span className={styles.directive} data-tone={DIRECTIVE_TONE[a.directive]}
                    title="Finer-grained directive">{a.directive}</span>}
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
        {watched && (
          <span
            className={styles.watching}
            title={memberOf?.length
              ? `On your ${memberOf.join(", ")} watchlist${memberOf.length > 1 ? "s" : ""}`
              : "Already on your watchlist"}
          >
            <Icon name="star" size={13} /> Watching
            {memberOf?.length > 0 && (
              <span className={styles.watchLists}>
                {memberOf.map((name) => (
                  <span key={name} className={styles.watchList}>{name}</span>
                ))}
              </span>
            )}
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
      </div>

      {loading ? (
        <Skeleton w="100%" h="460px" />
      ) : (
        <>
          <section className={styles.chartPane}>
            <ChartPro ticker={ticker} analysis={a} />
          </section>

          {companyInfo.profile !== false && (
            <Pane caption="Company"
                  right={<span className={styles.muted}>who this is · who owns it</span>}>
              <CompanyInfo company={company} ticker={ticker} show={companyInfo} />
            </Pane>
          )}

          {companyInfo.insiders !== false && (
            <Pane caption="Insider trades"
                  right={<span className={styles.muted}>SEC Form 4 · newest first</span>}>
              <InsiderTrades trades={insiderTrades} ticker={ticker} />
            </Pane>
          )}

          <Pane caption="Alerts"
                right={<span className={styles.muted}>
                  {stockAlerts.length > 0
                    ? `${stockAlerts.length} fired · newest first`
                    : "nothing has tripped"}
                </span>}>
            <StockAlerts alerts={stockAlerts} ticker={ticker} focusKey={focusAlertKey} />
          </Pane>

          <Pane caption="Suggestion history"
                right={<span className={styles.muted}>what we said · what happened next</span>}>
            <SuggestionHistoryStrip ticker={ticker} daily={data?.daily || []} />
          </Pane>

          {anchors.length > 0 && (
            <Pane caption="This day in history"
                  right={<span className={styles.muted}>close on this date, past years</span>}>
              <div className={styles.anchors}>
                {anchors.map((an) => {
                  const delta = refPrice && an.close
                    ? (refPrice / an.close - 1) * 100
                    : null;
                  const label = an.years_ago === "max" ? "earliest" : `${an.years_ago}y ago`;
                  return (
                    <div key={`${an.years_ago}`} className={styles.anchor}>
                      <span className={styles.anchorLabel}>{label}</span>
                      <span className={styles.anchorDate}>{an.date}</span>
                      <span className={styles.anchorClose}>${n(an.close)}</span>
                      {delta != null && (
                        <span className={styles.anchorDelta} data-tone={delta >= 0 ? "pos" : "neg"}>
                          {delta >= 0 ? "+" : ""}{delta.toFixed(1)}% since
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </Pane>
          )}

          {xPosts.length > 0 && (
            <Pane caption="X Watch"
                  right={<span className={styles.muted}>tracked-account posts mentioning {ticker}</span>}>
              <div className={styles.xFeed}>
                {xPosts.map((p) => (
                  <XPostCard key={`${p.account}:${p.post_id}`} post={p} compact />
                ))}
              </div>
            </Pane>
          )}

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
            <Pane caption="Trade plan" right={a.rr != null && (
              <span className={styles.rr} data-tone={a.rr_pass ? "pos" : "neg"}
                    title={a.rr_pass ? "Meets the 3:1 professional threshold" : "Below 3:1 — a known skip"}>
                {a.rr}:1 {a.rr_pass ? "✓" : "✗ <3"}
              </span>
            )}>
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
                  {a.staging_note && <p className={styles.sizeNote}>{a.staging_note}</p>}
                </>
              )}
            </Pane>

            <Pane caption="Structure">
              <div className={styles.stats}>
                <Stat label="Trend" value={a.trend} tone={a.trend === "up" ? "pos" : a.trend === "down" ? "neg" : ""} />
                <Stat label="MA stack" value={a.ma_alignment.replace("stacked_", "")} />
                <Stat label="MA state" value={(a.ma_state || "mixed").replace(/_/g, " ")}
                      tone={a.ma_state === "healthy_uptrend" || a.ma_state === "reclaiming" ? "pos"
                            : a.ma_state === "topping" || a.ma_state === "breaking_down" ? "neg" : ""} />
                <Stat label="ATR(14)" value={`$${n(a.atr14)}${a.atr_pct ? ` (${n(a.atr_pct)}%)` : ""}`} />
                <Stat label="Ext (ATR from MA20)" value={a.ma_extension_atr != null ? `${n(a.ma_extension_atr)}×` : "—"} />
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

            <Pane
              caption="Patterns"
              right={formingCount > 0 && (
                <Segmented
                  ariaLabel="Pattern filter"
                  value={patternFilter}
                  onChange={setPatternFilter}
                  options={[
                    { value: "confirmed", label: "Confirmed", badge: confirmedCount,
                      title: "Patterns that have actually triggered" },
                    { value: "all", label: "Incl. forming", badge: a.patterns.length,
                      title: "Also show shapes that are on the chart but haven't triggered yet" },
                  ]}
                />
              )}
            >
              {shownPatterns.length === 0 ? (
                <p className={styles.muted}>
                  {a.patterns.length === 0
                    ? "No classical pattern reads clearly right now."
                    : "Nothing confirmed — switch to “Incl. forming” for the shapes still developing."}
                </p>
              ) : (
                <ul className={styles.patterns}>
                  {shownPatterns.map((p, i) => (
                    <li key={i} className={styles.pattern} data-status={p.status}>
                      <span className={styles.patName}>{p.label}</span>
                      <span className={styles.patDir} data-tone={p.direction === "bullish" ? "pos" : p.direction === "bearish" ? "neg" : ""}>{p.direction}</span>
                      <span className={styles.patConf}>{Math.round(p.confidence * 100)}%</span>
                      {p.status === "forming" && (
                        <span className={styles.patForming} title="The shape is there; the trigger hasn't happened">
                          forming
                        </span>
                      )}
                      {p.measured_move && <span className={styles.patMove}>→ ${n(p.measured_move)}</span>}
                      <span className={styles.patNote}>{p.note}</span>
                      {/* What's still outstanding. Showing why it isn't a pattern
                          yet is the honest version of "what it's heading towards". */}
                      {p.criteria?.length > 0 && (
                        <span className={styles.patCriteria}>
                          {p.criteria.map((c, j) => (
                            <em key={j} data-met={c.met ? "yes" : "no"}>
                              {c.met ? "✓" : "○"} {c.name}
                              {c.detail ? ` (${c.detail})` : ""}
                            </em>
                          ))}
                        </span>
                      )}
                      <span className={styles.patPivots}>
                        {p.pivots.map((pv, j) => <em key={j}>{pv.role} ${n(pv.price)}</em>)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Pane>

            {/* Trendlines were computed on every analysis and rendered nowhere. */}
            <Pane caption="Trendlines"
                  right={<span className={styles.muted}>diagonal support &amp; resistance</span>}>
              {(a.trendlines || []).length === 0 ? (
                <p className={styles.muted}>No trendline has enough touches to be worth drawing.</p>
              ) : (
                <ul className={styles.patterns}>
                  {a.trendlines.map((t, i) => (
                    <li key={i} className={styles.pattern}>
                      <span className={styles.patName}>{t.kind === "support" ? "Rising support" : "Falling resistance"}</span>
                      <span className={styles.patDir} data-tone={t.kind === "support" ? "pos" : "neg"}>{t.kind}</span>
                      <span className={styles.patConf}>{t.touches} touches</span>
                      <span className={styles.patMove}>now ≈ ${n(t.current_value)}</span>
                      {t.broken && <span className={styles.patForming}>broken</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Pane>

            <Pane caption="Breakout / breakdown"
                  right={a.breakout && <span className={styles.rr} data-tone={BREAKOUT_TONE[a.breakout.status]}>{a.breakout.status.replace(/_/g, " ")}</span>}>
              {a.breakout ? (
                <>
                  <div className={styles.stats}>
                    <Stat label="Direction" value={a.breakout.direction}
                          tone={a.breakout.direction === "up" ? "pos" : "neg"} />
                    <Stat label="Level" value={`$${n(a.breakout.level)}`} />
                    <Stat label="From" value={a.breakout.level_source} />
                    <Stat label="Volume" value={a.breakout.volume_confirmed ? "confirmed" : "unconfirmed"}
                          tone={a.breakout.volume_confirmed ? "pos" : ""} />
                  </div>
                  <p className={styles.muted}>{a.breakout.note}</p>
                </>
              ) : (
                <p className={styles.muted}>No level in play within striking distance right now.</p>
              )}
            </Pane>

            <Pane caption="Candles & volume">
              {a.volume ? (
                <div className={styles.stats}>
                  <Stat label="Vol vs 20d" value={`${n(a.volume.ratio)}×`}
                        tone={a.volume.ratio >= 1.3 ? "pos" : ""} />
                  <Stat label="Close streak" value={a.volume.streak}
                        tone={a.volume.streak > 0 ? "pos" : a.volume.streak < 0 ? "neg" : ""} />
                  <Stat label="Volume state" value={a.volume.state} />
                </div>
              ) : (
                <p className={styles.muted}>No real volume in the data for this ticker.</p>
              )}
              {a.candles && a.candles.length > 0 ? (
                <ul className={styles.patterns}>
                  {a.candles.slice(-4).reverse().map((c, i) => (
                    <li key={i} className={styles.pattern}>
                      <span className={styles.patName}>{c.label}</span>
                      <span className={styles.patDir} data-tone={SIGNAL_TONE[c.direction]}>{c.direction}</span>
                      <span className={styles.patConf}>{c.date}</span>
                      <span className={styles.patNote}>{c.note}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>No notable candlestick signals recently.</p>
              )}
            </Pane>

            <Pane caption="Why — the read">
              <ul className={styles.reasons}>
                {(a.evidence && a.evidence.length
                  ? a.evidence
                  : a.reasons.map((r) => ({ detail: r, component: "", signal: "neutral" }))
                ).map((e, i) => (
                  <li key={i} data-tone={SIGNAL_TONE[e.signal]}>
                    {e.component && <strong className={styles.evComp}>{e.component}</strong>} {e.detail}
                  </li>
                ))}
              </ul>
              <p className={styles.disclaimer}>{a.disclaimer}</p>
            </Pane>
          </div>
        </>
      )}
    </div>
  );
}
