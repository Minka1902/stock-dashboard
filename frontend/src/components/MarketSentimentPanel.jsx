import {
  Area,
  AreaChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import Icon from "./Icon";
import Skeleton from "./Skeleton";
import styles from "./MarketSentimentPanel.module.css";

const TOOLTIP_STYLE = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  fontSize: "12px",
  color: "var(--text)",
  padding: "6px 10px",
};

const SIGNAL_LABELS = {
  BUY: "Buy",
  SELL: "Sell",
  ALERT: "Alert",
  EXTREME: "Extreme",
  NEUTRAL: "Neutral",
  NO_DATA: "No data",
};

function SignalBadge({ signal }) {
  const sig = signal || "NO_DATA";
  return (
    <span className={styles.badge} data-signal={sig}>
      {SIGNAL_LABELS[sig] || sig}
    </span>
  );
}

function Card({ title, threshold, signal, value, sub, note, children }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h3 className={styles.cardTitle}>{title}</h3>
          <span className={styles.threshold}>{threshold}</span>
        </div>
        <SignalBadge signal={signal} />
      </div>
      <div className={styles.valueRow}>
        <span className={styles.value}>{value ?? "—"}</span>
        {sub && <span className={styles.valueSub}>{sub}</span>}
      </div>
      {note && <p className={styles.note}>{note}</p>}
      <div className={styles.chartWrap}>{children}</div>
    </div>
  );
}

function NoData() {
  return <p className={styles.noData}>No data yet — refresh to fetch.</p>;
}

export default function MarketSentimentPanel({
  sentiment, fearGreed, vix, aaii, putCall, loading, busy, onRefresh,
}) {
  const ind = sentiment?.indicators || {};
  const lean = sentiment?.overall?.lean || "NEUTRAL";
  const hasAny =
    fearGreed.length > 0 || vix.length > 0 || aaii.length > 0 || putCall.length > 0;

  const fgData = fearGreed.map((s) => ({
    date: s.captured_at.slice(0, 10), score: s.score, rating: s.rating,
  }));
  const vixData = vix.map((p) => ({ date: p.date, close: p.close }));
  const aaiiData = aaii.map((s) => ({
    date: s.week_ending, bullish: s.bullish, neutral: s.neutral, bearish: s.bearish,
  }));
  const pcData = putCall.map((p) => ({ date: p.date, ratio: p.ratio }));

  return (
    <section className={styles.panel} id="market-sentiment">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Market Sentiment</h2>
          <p className={styles.subtitle}>
            Four contrarian crash/rally indicators — extremes mark the turning points
          </p>
        </div>
        {sentiment && (
          <div className={styles.lean}>
            <span className={styles.leanLabel}>Overall lean</span>
            <SignalBadge signal={lean} />
          </div>
        )}
      </header>

      {loading ? (
        <div className={styles.loadWrap}>
          <Skeleton w="100%" h="120px" />
          <Skeleton w="100%" h="120px" />
        </div>
      ) : !hasAny ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="sun" size={24} /></span>
          <p className={styles.emptyTitle}>No sentiment data loaded yet</p>
          <button className={styles.emptyBtn} onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      ) : (
        <div className={styles.grid}>
          <Card
            title="Fear & Greed"
            threshold="≤25 buy · ≥75 sell"
            signal={ind.fear_greed?.signal}
            value={ind.fear_greed?.value != null ? Math.round(ind.fear_greed.value) : null}
            sub={ind.fear_greed?.rating || "CNN composite"}
          >
            {fgData.length === 0 ? <NoData /> : (
              <ResponsiveContainer width="100%" height={72}>
                <AreaChart data={fgData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                  <defs>
                    <linearGradient id="msFg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone" dataKey="score" dot={false} strokeWidth={2}
                    stroke="var(--accent)" fill="url(#msFg)" isAnimationActive={false}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v, _n, props) => [
                      `${Math.round(v)} — ${props.payload?.rating ?? ""}`,
                      "Score",
                    ]}
                    labelFormatter={(_l, pts) => pts?.[0]?.payload?.date ?? ""}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card
            title="VIX"
            threshold="≥19 alert · ≥30 extreme"
            signal={ind.vix?.signal}
            value={ind.vix?.value != null ? ind.vix.value.toFixed(1) : null}
            sub={ind.vix?.as_of}
            note={ind.vix?.crossed_19 ? "Crossed above 19 — a market move is starting." : null}
          >
            {vixData.length === 0 ? <NoData /> : (
              <ResponsiveContainer width="100%" height={72}>
                <AreaChart data={vixData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                  <defs>
                    <linearGradient id="msVix" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone" dataKey="close" dot={false} strokeWidth={2}
                    stroke="var(--accent)" fill="url(#msVix)" isAnimationActive={false}
                  />
                  <ReferenceLine y={19} stroke="var(--text-faint)" strokeDasharray="4 3" />
                  <ReferenceLine y={30} stroke="var(--negative)" strokeDasharray="4 3" />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v) => [v.toFixed(2), "VIX close"]}
                    labelFormatter={(_l, pts) => pts?.[0]?.payload?.date ?? ""}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card
            title="AAII Survey"
            threshold="crowd bearish → buy · bullish → sell"
            signal={ind.aaii?.signal}
            value={
              ind.aaii?.value
                ? `${Math.round(ind.aaii.value.bearish)}% bearish`
                : null
            }
            sub={
              ind.aaii?.value
                ? `${Math.round(ind.aaii.value.bullish)}% bullish · week of ${ind.aaii.as_of}`
                : "weekly investor survey"
            }
          >
            {aaiiData.length === 0 ? <NoData /> : (
              <>
                <ResponsiveContainer width="100%" height={72}>
                  <LineChart data={aaiiData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                    <Line
                      type="monotone" dataKey="bullish" dot={false} strokeWidth={2}
                      stroke="var(--positive)" isAnimationActive={false}
                    />
                    <Line
                      type="monotone" dataKey="neutral" dot={false} strokeWidth={2}
                      stroke="var(--text-faint)" isAnimationActive={false}
                    />
                    <Line
                      type="monotone" dataKey="bearish" dot={false} strokeWidth={2}
                      stroke="var(--negative)" isAnimationActive={false}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(v, name) => [`${v.toFixed(1)}%`, name]}
                      labelFormatter={(_l, pts) => pts?.[0]?.payload?.date ?? ""}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <div className={styles.legend}>
                  <span className={styles.legendItem}>
                    <i className={styles.swatch} style={{ background: "var(--positive)" }} />bullish
                  </span>
                  <span className={styles.legendItem}>
                    <i className={styles.swatch} style={{ background: "var(--text-faint)" }} />neutral
                  </span>
                  <span className={styles.legendItem}>
                    <i className={styles.swatch} style={{ background: "var(--negative)" }} />bearish
                  </span>
                </div>
              </>
            )}
          </Card>

          <Card
            title="Put/Call Ratio"
            threshold="≥1.00 buy · ≤0.80 sell"
            signal={ind.put_call?.signal}
            value={ind.put_call?.value != null ? ind.put_call.value.toFixed(2) : null}
            sub={ind.put_call?.as_of ? `5-day avg · ${ind.put_call.as_of}` : "5-day average"}
          >
            {pcData.length === 0 ? <NoData /> : (
              <ResponsiveContainer width="100%" height={72}>
                <AreaChart data={pcData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                  <defs>
                    <linearGradient id="msPc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone" dataKey="ratio" dot={false} strokeWidth={2}
                    stroke="var(--accent)" fill="url(#msPc)" isAnimationActive={false}
                  />
                  <ReferenceLine y={1.0} stroke="var(--positive)" strokeDasharray="4 3" />
                  <ReferenceLine y={0.8} stroke="var(--negative)" strokeDasharray="4 3" />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v) => [v.toFixed(2), "Put/Call"]}
                    labelFormatter={(_l, pts) => pts?.[0]?.payload?.date ?? ""}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>
      )}
    </section>
  );
}
