import {
  Area, AreaChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip,
} from "recharts";
import { AnimatePresence, motion } from "motion/react";
import Skeleton from "./Skeleton";
import AnimatedNumber from "./AnimatedNumber";
import EmptyState from "./EmptyState";
import { prefersReducedMotion, staggerContainer, staggerItem } from "../lib/motionConfig";
import styles from "./MarketSentimentPanel.module.css";

const TOOLTIP_STYLE = {
  background: "var(--surface-3)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--r-sm)",
  fontFamily: "var(--mono)",
  fontSize: "11px",
  color: "var(--text)",
  padding: "5px 9px",
};

const SIGNAL_LABEL = {
  BUY: "Buy", SELL: "Sell", ALERT: "Alert", EXTREME: "Extreme",
  NEUTRAL: "Neutral", NO_DATA: "No data",
};
const LEAN_LABEL = {
  GREEDY: "Greedy", FEARFUL: "Fearful", NEUTRAL: "Neutral",
  RISK_ON: "Risk on", RISK_OFF: "Risk off",
};
// A one-line, plain-language read per composite lean.
const LEAN_READ = {
  GREEDY: "Crowd is greedy. Historically a time to trim, not chase.",
  FEARFUL: "Crowd is fearful. Historically where opportunities hide.",
  NEUTRAL: "No strong crowd extreme. Nothing forcing a move today.",
  RISK_ON: "Risk appetite is on. Momentum has the tailwind.",
  RISK_OFF: "Risk is coming off. Defense over offense.",
};

function Chip({ signal }) {
  const s = signal || "NO_DATA";
  return <span className={styles.chip} data-signal={s}>{SIGNAL_LABEL[s] || s}</span>;
}

function formatBalance(millions) {
  if (millions == null) return null;
  return millions >= 1_000_000 ? `$${(millions / 1_000_000).toFixed(2)}T` : `$${Math.round(millions / 1000)}B`;
}

/* --- Fear & Greed gauge: custom SVG semicircle + animated amber needle --- */
function Gauge({ score, rating }) {
  const has = score != null;
  const v = has ? Math.max(0, Math.min(100, score)) : 50;
  const deg = (v - 50) * 1.8; // -90 (fear) .. +90 (greed)
  return (
    <div className={styles.gauge}>
      <svg viewBox="0 0 300 168" className={styles.gaugeSvg} role="img"
           aria-label={has ? `Fear and Greed ${Math.round(v)}, ${rating || ""}` : "Fear and Greed, no data"}>
        <defs>
          {/* Fear (left) → Greed (right): red → amber → green, matching the
              score tone and the horizontal Fear & Greed bar. */}
          <linearGradient id="fgArc" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--negative)" />
            <stop offset="50%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--positive)" />
          </linearGradient>
        </defs>
        <path d="M 30 150 A 120 120 0 0 1 270 150" fill="none" stroke="var(--surface-3)" strokeWidth="16" strokeLinecap="round" />
        <path d="M 30 150 A 120 120 0 0 1 270 150" fill="none" stroke="url(#fgArc)" strokeWidth="14"
              strokeLinecap="round" opacity={has ? 1 : 0.28} />
        {/* ticks */}
        {[0, 25, 50, 75, 100].map((t) => {
          const a = (Math.PI * (100 - t)) / 100;
          const x1 = 150 + Math.cos(a) * 132, y1 = 150 - Math.sin(a) * 132;
          const x2 = 150 + Math.cos(a) * 120, y2 = 150 - Math.sin(a) * 120;
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--grid)" strokeWidth="2" />;
        })}
        {has && (
          <motion.g
            className={styles.needle}
            animate={{ rotate: deg }}
            transition={prefersReducedMotion()
              ? { duration: 0 }
              : { type: "spring", stiffness: 55, damping: 13 }}
          >
            <line x1="150" y1="150" x2="150" y2="42" stroke="var(--accent)" strokeWidth="3.5" strokeLinecap="round" />
            <circle cx="150" cy="42" r="4" fill="var(--accent)" />
          </motion.g>
        )}
        <circle cx="150" cy="150" r="8" fill="var(--surface-3)" stroke="var(--accent)" strokeWidth="2" />
      </svg>
      <div className={styles.gaugeScore}>
        <span className={styles.gaugeNum}>
          {has ? <AnimatedNumber value={Math.round(v)} duration={1100} /> : "--"}
        </span>
        <span className={styles.gaugeRating}>{has ? (rating || "") : "no data"}</span>
      </div>
      <div className={styles.gaugeEnds}>
        <span>Extreme fear</span><span>Extreme greed</span>
      </div>
    </div>
  );
}

function Pane({ caption, right, className, children }) {
  return (
    <section className={`${styles.pane} ${className || ""}`}>
      <div className={styles.paneHead}>
        <span className="caption">{caption}</span>
        {right}
      </div>
      {children}
    </section>
  );
}

// Shared sparkline. Single-series renders a filled area; pass `lines`
// (an array of {dataKey, color}) for a multi-series line variant so every
// indicator pane shares identical chart geometry.
function Sparkline({ data, dataKey, id, refs = [], lines }) {
  if (!data || data.length === 0) return <div className={styles.noData}>No data yet</div>;
  return (
    <div className={styles.spark}>
      <ResponsiveContainer width="100%" height={64}>
        {lines ? (
          <LineChart data={data} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
            {refs.map((r, i) => (
              <ReferenceLine key={i} y={r.y} stroke={r.color} strokeDasharray="3 3" strokeWidth={1} />
            ))}
            {lines.map((ln) => (
              <Line key={ln.dataKey} type="monotone" dataKey={ln.dataKey} stroke={ln.color}
                    strokeWidth={1.6} dot={false} isAnimationActive={false} />
            ))}
            <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(_l, p) => p?.[0]?.payload?.date ?? ""} />
          </LineChart>
        ) : (
          <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.32} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            {refs.map((r, i) => (
              <ReferenceLine key={i} y={r.y} stroke={r.color} strokeDasharray="3 3" strokeWidth={1} />
            ))}
            <Area type="monotone" dataKey={dataKey} stroke="var(--accent)" strokeWidth={1.8}
                  fill={`url(#${id})`} dot={false} isAnimationActive={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(_l, p) => p?.[0]?.payload?.date ?? ""} />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function Indicator({ caption, threshold, signal, value, sub, note, stale, children }) {
  return (
    <Pane caption={caption} right={<Chip signal={signal} />} className={styles.indicator}>
      <div className={styles.valRow}>
        <span className={styles.val}>{value ?? "--"}</span>
        {sub && <span className={styles.sub}>{sub}</span>}
      </div>
      <span className={styles.threshold}>{threshold}</span>
      {stale && (
        <span className={styles.staleBadge} data-warn={stale.warn ? "yes" : "no"}>
          {stale.text}
        </span>
      )}
      {note && <p className={styles.note}>{note}</p>}
      {children}
    </Pane>
  );
}

// Honest data-age badge for slow-cadence sources: shows the period the latest
// datum covers and flags it when it's older than the expected release rhythm.
function staleness(latestIso, { warnDays, label }) {
  if (!latestIso) return null;
  const then = new Date(latestIso);
  if (Number.isNaN(then.getTime())) return null;
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  return {
    text: `${label} ${latestIso}${days > 0 ? ` · ${days}d ago` : ""}`,
    warn: days > warnDays,
  };
}

export default function MarketSentimentPanel({
  sentiment, fearGreed, vix, aaii, putCall, marginDebt, loading, busy, onRefresh,
}) {
  const ind = sentiment?.indicators || {};
  const lean = sentiment?.overall?.lean || "NEUTRAL";
  const hasAny = fearGreed.length + vix.length + aaii.length + putCall.length + marginDebt.length > 0;

  const fgScore = ind.fear_greed?.value != null ? Math.round(ind.fear_greed.value) : null;

  const vixData = vix.map((p) => ({ date: p.date, close: p.close }));
  const aaiiData = aaii.map((s) => ({ date: s.week_ending, bullish: s.bullish, neutral: s.neutral, bearish: s.bearish }));
  const pcData = putCall.map((p) => ({ date: p.date, ratio: p.ratio }));
  const mdData = marginDebt.filter((p) => p.yoy_pct != null).map((p) => ({ date: p.month, yoy: p.yoy_pct }));

  // Data-age badges: AAII is weekly (warn >10 days), FINRA margin debt is
  // monthly with a ~1-month publication lag (warn >45 days).
  const aaiiLatest = aaii.reduce((m, s) => (s.week_ending > m ? s.week_ending : m), "");
  const mdLatest = marginDebt.reduce((m, p) => (p.month > m ? p.month : m), "");
  const aaiiStale = staleness(aaiiLatest, { warnDays: 10, label: "week ending" });
  const mdStale = staleness(mdLatest ? `${mdLatest}-01` : null, { warnDays: 75, label: "data for" });
  if (mdStale) mdStale.text = `data for ${mdLatest} (monthly)${mdStale.warn ? " · stale" : ""}`;

  // Composite ledger: the five indicators + their signals.
  const ledger = [
    { key: "fear_greed", label: "Fear & Greed", sig: ind.fear_greed?.signal, val: fgScore },
    { key: "vix", label: "VIX", sig: ind.vix?.signal, val: ind.vix?.value != null ? ind.vix.value.toFixed(1) : null },
    { key: "aaii", label: "AAII survey", sig: ind.aaii?.signal, val: ind.aaii?.value ? `${Math.round(ind.aaii.value.bearish)}% bear` : null },
    { key: "put_call", label: "Put / Call", sig: ind.put_call?.signal, val: ind.put_call?.value != null ? ind.put_call.value.toFixed(2) : null },
    { key: "margin_debt", label: "Margin debt", sig: ind.margin_debt?.signal, val: ind.margin_debt?.value != null ? `${ind.margin_debt.value >= 0 ? "+" : ""}${ind.margin_debt.value.toFixed(0)}%` : null },
  ];

  if (loading) {
    return (
      <div className={styles.wrap}>
        <div className={styles.hero}>
          <Skeleton w="100%" h="230px" />
          <Skeleton w="100%" h="230px" />
        </div>
      </div>
    );
  }

  if (!hasAny) {
    return (
      <EmptyState
        icon="gauge"
        title="No sentiment data loaded yet"
        text="Pull the market indicators to read the crowd."
        onRetry={onRefresh}
        busy={busy}
      />
    );
  }

  return (
    <div className={styles.wrap} id="sentiment">
      <div className={styles.hero} data-tour="sentiment-hero">
        <Pane caption="Fear & Greed Index" right={<span className={styles.paneMeta}>CNN composite</span>} className={styles.gaugePane}>
          <Gauge score={fgScore} rating={ind.fear_greed?.rating} />
        </Pane>

        <Pane caption="Composite read" right={<Chip signal={lean === "GREEDY" || lean === "RISK_OFF" ? "SELL" : lean === "FEARFUL" || lean === "RISK_ON" ? "BUY" : "NEUTRAL"} />}>
          <div className={styles.leanRow}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={lean}
                className={styles.leanWord}
                data-lean={lean}
                initial={prefersReducedMotion() ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion() ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={prefersReducedMotion() ? { duration: 0 } : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                {LEAN_LABEL[lean] || lean}
              </motion.span>
            </AnimatePresence>
          </div>
          <p className={styles.leanRead}>{LEAN_READ[lean] || ""}</p>
          <ul className={styles.ledger}>
            {ledger.map((row) => (
              <li key={row.key} className={styles.ledgerRow}>
                <span className={styles.ledgerLabel}>{row.label}</span>
                <span className={styles.ledgerVal}>{row.val ?? "--"}</span>
                <Chip signal={row.sig} />
              </li>
            ))}
          </ul>
        </Pane>
      </div>

      <motion.div
        className={styles.grid}
        variants={staggerContainer}
        initial={prefersReducedMotion() ? false : "hidden"}
        animate="visible"
      >
       <motion.div variants={staggerItem}>
        <Indicator
          caption="VIX · Volatility"
          threshold="≥19 alert · ≥30 extreme"
          signal={ind.vix?.signal}
          value={ind.vix?.value != null ? ind.vix.value.toFixed(1) : null}
          sub={ind.vix?.as_of}
          note={ind.vix?.crossed_19 ? "Crossed above 19 — a move is starting." : null}
        >
          <Sparkline data={vixData} dataKey="close" id="spVix"
            refs={[{ y: 19, color: "var(--text-faint)" }, { y: 30, color: "var(--negative)" }]} />
        </Indicator>
       </motion.div>

       <motion.div variants={staggerItem}>
        <Indicator
          caption="AAII · Retail survey"
          threshold="crowd bearish → buy"
          signal={ind.aaii?.signal}
          value={ind.aaii?.value ? `${Math.round(ind.aaii.value.bearish)}%` : null}
          sub={ind.aaii?.value ? `bearish · ${Math.round(ind.aaii.value.bullish)}% bull` : "weekly"}
          stale={aaiiStale}
        >
          <Sparkline data={aaiiData} id="spAaii" lines={[
            { dataKey: "bullish", color: "var(--positive)" },
            { dataKey: "bearish", color: "var(--negative)" },
          ]} />
        </Indicator>
       </motion.div>

       <motion.div variants={staggerItem}>
        <Indicator
          caption="Put / Call ratio"
          threshold="≥1.00 buy · ≤0.80 sell"
          signal={ind.put_call?.signal}
          value={ind.put_call?.value != null ? ind.put_call.value.toFixed(2) : null}
          sub={ind.put_call?.as_of ? `5d avg · ${ind.put_call.as_of}` : "5-day avg"}
        >
          <Sparkline data={pcData} dataKey="ratio" id="spPc"
            refs={[{ y: 1.0, color: "var(--positive)" }, { y: 0.8, color: "var(--negative)" }]} />
        </Indicator>
       </motion.div>

       <motion.div variants={staggerItem}>
        <Indicator
          caption="Margin debt · leverage"
          threshold="≥45% sell · ≤−20% buy"
          signal={ind.margin_debt?.signal}
          value={ind.margin_debt?.value != null ? `${ind.margin_debt.value >= 0 ? "+" : ""}${ind.margin_debt.value.toFixed(0)}%` : null}
          sub={ind.margin_debt?.value != null ? `YoY · ${formatBalance(ind.margin_debt.debit_balances)}` : "FINRA %YoY"}
          stale={mdStale}
        >
          <Sparkline data={mdData} dataKey="yoy" id="spMd"
            refs={[{ y: 45, color: "var(--text-faint)" }, { y: -20, color: "var(--positive)" }]} />
        </Indicator>
       </motion.div>
      </motion.div>
    </div>
  );
}
