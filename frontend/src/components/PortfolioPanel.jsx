import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Icon from "./Icon";
import AnimatedNumber from "./AnimatedNumber";
import ExtHoursBadge from "./ExtHoursBadge";
import Sparkline from "./Sparkline";
import SparkRange from "./SparkRange";
import { useSparklines } from "../hooks/useSparklines";
import { openTickerTab } from "../lib/nav";
import { prefersReducedMotion, staggerContainer, staggerItem } from "../lib/motionConfig";
import { formatCurrencyCompact } from "../lib/format";
import styles from "./PortfolioPanel.module.css";

const DIRECTIVE_TONE = { Accumulate: "buy", Hold: "hold", Reduce: "warn", Avoid: "sell" };

// Mirrors backend/app/themes.py THEMES (validated server-side too).
const THEMES = [
  "AI", "Semiconductors", "Medicine", "Space", "Defense", "Energy",
  "Finance", "Crypto", "Consumer", "Tech", "Other",
];

const money = (v) => formatCurrencyCompact(v);
const signedMoney = (v) => `${v >= 0 ? "+" : "−"}${formatCurrencyCompact(Math.abs(v))}`;
const signedPct = (v, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;

export default function PortfolioPanel({
  portfolio, signals, quotes = {}, analyses = [],
  onAdd, onEdit, onSetCategory, onRemove,
}) {
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [mergeNote, setMergeNote] = useState(null);

  // Inline edit: which ticker is being edited + its draft values.
  const [editing, setEditing] = useState(null);
  const [editShares, setEditShares] = useState("");
  const [editCost, setEditCost] = useState("");
  const [range, setRange] = useState("1m");
  const { series: sparks } = useSparklines(portfolio.map((h) => h.ticker), range);

  const analysisByTicker = Object.fromEntries(analyses.map((a) => [a.ticker, a]));

  // ticker -> current price, for P/L: live quote first, signal price fallback.
  const priceOf = (t) => {
    const q = quotes[t];
    if (q && q.price != null) return q.price;
    const sig = signals.find((s) => s.ticker === t);
    return sig && sig.price != null ? sig.price : null;
  };

  // Book totals: market value, total P/L vs cost, and today's P/L.
  const totals = portfolio.reduce((acc, h) => {
    const price = priceOf(h.ticker);
    if (price == null) return acc;
    const q = quotes[h.ticker];
    acc.value += price * h.shares;
    acc.cost += h.avg_cost * h.shares;
    if (q && q.previous_close != null) {
      acc.day += (price - q.previous_close) * h.shares;
      acc.dayKnown = true;
    }
    return acc;
  }, { value: 0, cost: 0, day: 0, dayKnown: false });
  const totalPl = totals.cost > 0 ? ((totals.value - totals.cost) / totals.cost) * 100 : null;
  const totalPlAbs = totals.value - totals.cost;

  // Group rows by theme category, with per-group subtotals.
  const groups = useMemo(() => {
    const byCat = new Map();
    for (const h of portfolio) {
      const cat = h.category || "Other";
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(h);
    }
    const order = [...THEMES, ...[...byCat.keys()].filter((c) => !THEMES.includes(c))];
    return order
      .filter((c) => byCat.has(c))
      .map((cat) => {
        const rows = byCat.get(cat);
        const sub = rows.reduce((acc, h) => {
          const price = priceOf(h.ticker);
          if (price != null) { acc.value += price * h.shares; acc.cost += h.avg_cost * h.shares; }
          return acc;
        }, { value: 0, cost: 0 });
        const plPct = sub.cost > 0 ? ((sub.value - sub.cost) / sub.cost) * 100 : null;
        return { cat, rows, value: sub.value, plPct };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio, quotes, signals]);

  async function submit(e) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    const sh = parseFloat(shares);
    const ac = parseFloat(avgCost);
    if (!t || !(sh > 0) || !(ac >= 0)) {
      setError("Enter a ticker, positive shares, and a non-negative average cost.");
      return;
    }
    setPending(true);
    const existing = portfolio.find((h) => h.ticker === t);
    try {
      const updated = await onAdd(t, sh, ac);
      // onAdd stores the returned list in the hook; also read it here for the merge note.
      const after = Array.isArray(updated) ? updated.find((h) => h.ticker === t) : null;
      if (existing && after) {
        setMergeNote(`Merged into existing ${t} — now ${after.shares} sh @ ${money(after.avg_cost)}`);
      } else {
        setMergeNote(null);
      }
      setTicker(""); setShares(""); setAvgCost("");
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  function startEdit(h) {
    setEditing(h.ticker);
    setEditShares(String(h.shares));
    setEditCost(String(h.avg_cost));
  }
  async function saveEdit(t) {
    const sh = parseFloat(editShares);
    const ac = parseFloat(editCost);
    if (!(sh > 0) || !(ac >= 0)) return;
    await onEdit(t, sh, ac);
    setEditing(null);
  }

  const showEmpty = portfolio.length === 0;
  const cards = [
    { label: "Total value", value: totals.value, tone: "flat", fmt: money },
    { label: "Day P/L", value: totals.dayKnown ? totals.day : null, tone: totals.day >= 0 ? "pos" : "neg", fmt: signedMoney },
    { label: "Total P/L", value: totalPl != null ? totalPlAbs : null, tone: totalPlAbs >= 0 ? "pos" : "neg", fmt: signedMoney, pct: totalPl },
  ];

  return (
    <section className={styles.panel} id="portfolio">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Portfolio</h2>
          <p className={styles.subtitle}>
            Holdings the daily suggestions are tailored to. P/L uses live quotes
            (incl. pre/post-market) when available, otherwise the latest signal price.
          </p>
        </div>
        {!showEmpty && <SparkRange value={range} onChange={setRange} />}
      </header>

      {!showEmpty && (
        <div className={styles.summary}>
          {cards.map((c) => (
            <div key={c.label} className={styles.card} data-tone={c.tone}>
              <span className={styles.cardLabel}>{c.label}</span>
              {c.value == null ? (
                <span className={styles.cardValue}>—</span>
              ) : (
                <span className={styles.cardValue}>
                  <AnimatedNumber value={c.value} format={c.fmt} />
                  {c.pct != null && <em className={styles.cardPct}>{signedPct(c.pct)}</em>}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <form className={styles.form} onSubmit={submit} data-tour="add-form">
        <input className={styles.ticker} placeholder="Ticker" value={ticker} maxLength={12}
               onChange={(e) => setTicker(e.target.value.toUpperCase())} />
        <input className={styles.num} placeholder="Shares" value={shares} type="number" min="0" step="any"
               onChange={(e) => setShares(e.target.value)} />
        <input className={styles.num} placeholder="Avg cost" value={avgCost} type="number" min="0" step="any"
               onChange={(e) => setAvgCost(e.target.value)} />
        <button className={styles.add} disabled={pending || !ticker.trim()}>
          {pending ? "Adding…" : "Add"}
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
      {mergeNote && <p className={styles.mergeNote}><Icon name="info" size={13} /> {mergeNote}</p>}

      {showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="wallet" size={24} /></span>
          <p className={styles.emptyTitle}>No holdings yet</p>
          <p className={styles.emptyText}>Add a position above so suggestions can account for it.</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Ticker</th>
                <th className={styles.numCol}>Shares</th>
                <th className={styles.numCol}>Avg Cost</th>
                <th className={styles.numCol}>Price</th>
                <th className={styles.numCol}>Day</th>
                <th className={styles.numCol}>Mkt Value</th>
                <th className={styles.numCol}>P/L</th>
                <th>Advice</th>
                <th className={styles.numCol}>Trend</th>
                <th></th>
              </tr>
            </thead>
            {groups.map((g) => (
              <motion.tbody
                key={g.cat}
                variants={staggerContainer}
                initial={prefersReducedMotion() ? false : "hidden"}
                animate="visible"
              >
                <tr className={styles.groupRow}>
                  <td colSpan={5}><span className={styles.groupName}>{g.cat}</span></td>
                  <td className={styles.numCol}>{g.value > 0 ? money(g.value) : "—"}</td>
                  <td className={styles.numCol}>
                    {g.plPct != null && (
                      <span className={styles.pl} data-tone={g.plPct >= 0 ? "pos" : "neg"}>{signedPct(g.plPct)}</span>
                    )}
                  </td>
                  <td colSpan={3}></td>
                </tr>
                <AnimatePresence initial={false}>
                  {g.rows.map((h) => {
                    const price = priceOf(h.ticker);
                    const q = quotes[h.ticker];
                    const value = price != null ? price * h.shares : null;
                    const plPct = price != null && h.avg_cost > 0
                      ? (price - h.avg_cost) / h.avg_cost * 100 : null;
                    const dayPct = q && q.change_pct != null ? q.change_pct : null;
                    const tone = plPct == null ? "flat" : plPct >= 0 ? "pos" : "neg";
                    const dayTone = dayPct == null ? "flat" : dayPct >= 0 ? "pos" : "neg";
                    const an = analysisByTicker[h.ticker];
                    const isEditing = editing === h.ticker;
                    return (
                      <motion.tr
                        key={h.ticker}
                        className={styles.row}
                        variants={staggerItem}
                        exit={prefersReducedMotion() ? { opacity: 0 } : { opacity: 0, x: -12 }}
                        layout={!prefersReducedMotion()}
                      >
                        <td>
                          <button className={styles.symbolBtn} onClick={() => openTickerTab(h.ticker)}
                                  title={`Analyze ${h.ticker} in a new tab`}>
                            <span className={styles.symbol}>{h.ticker}</span>
                          </button>
                          <CategorySelect
                            ticker={h.ticker}
                            category={h.category || "Other"}
                            source={h.category_source}
                            onSetCategory={onSetCategory}
                          />
                        </td>
                        {isEditing ? (
                          <>
                            <td className={styles.numCol}>
                              <input className={styles.editInput} type="number" min="0" step="any"
                                     value={editShares} onChange={(e) => setEditShares(e.target.value)} autoFocus />
                            </td>
                            <td className={styles.numCol}>
                              <input className={styles.editInput} type="number" min="0" step="any"
                                     value={editCost} onChange={(e) => setEditCost(e.target.value)}
                                     onKeyDown={(e) => { if (e.key === "Escape") setEditing(null); if (e.key === "Enter") saveEdit(h.ticker); }} />
                            </td>
                          </>
                        ) : (
                          <>
                            <td className={styles.numCol}>{h.shares}</td>
                            <td className={styles.numCol}>{money(h.avg_cost)}</td>
                          </>
                        )}
                        <td className={styles.numCol}>
                          {price != null ? (
                            <span className={styles.priceCell}>
                              <span key={price} className={styles.tick} data-tone={dayTone}>{money(price)}</span>
                              <ExtHoursBadge quote={q} />
                            </span>
                          ) : "—"}
                        </td>
                        <td className={styles.numCol}>
                          <span className={styles.pl} data-tone={dayTone}>
                            {dayPct != null ? signedPct(dayPct, 2) : "—"}
                          </span>
                        </td>
                        <td className={styles.numCol}>{value != null ? money(value) : "—"}</td>
                        <td className={styles.numCol}>
                          <span className={styles.pl} data-tone={tone}>
                            {plPct != null ? signedPct(plPct) : "—"}
                          </span>
                        </td>
                        <td>
                          {an ? (
                            <span className={styles.advice} data-tone={DIRECTIVE_TONE[an.directive]}>
                              {an.directive}
                              <em className={styles.conv}>{an.conviction > 0 ? "+" : ""}{an.conviction}</em>
                            </span>
                          ) : (
                            <span className={styles.advicePending}>analyzing…</span>
                          )}
                        </td>
                        <td className={styles.numCol}>
                          <Sparkline
                            closes={sparks[h.ticker]?.closes}
                            changePct={sparks[h.ticker]?.change_pct}
                            error={sparks[h.ticker]?.error}
                            loading={!sparks[h.ticker]}
                            range={range}
                            width={80}
                          />
                        </td>
                        <td className={styles.actionsCol}>
                          {isEditing ? (
                            <span className={styles.editActions}>
                              <button className={styles.iconAction} onClick={() => saveEdit(h.ticker)}
                                      title="Save" aria-label={`Save ${h.ticker}`}>✓</button>
                              <button className={styles.iconAction} onClick={() => setEditing(null)}
                                      title="Cancel" aria-label="Cancel edit">×</button>
                            </span>
                          ) : (
                            <span className={styles.rowActions}>
                              <button className={styles.iconAction} onClick={() => startEdit(h)}
                                      title={`Edit ${h.ticker}`} aria-label={`Edit ${h.ticker}`}>✎</button>
                              <button className={styles.remove} onClick={() => onRemove(h.ticker)}
                                      title={`Remove ${h.ticker}`} aria-label={`Remove ${h.ticker}`}>×</button>
                            </span>
                          )}
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </motion.tbody>
            ))}
            <tfoot>
              <tr className={styles.totals}>
                <td>Total</td>
                <td className={styles.numCol}></td>
                <td className={styles.numCol}></td>
                <td className={styles.numCol}></td>
                <td className={styles.numCol}>
                  {totals.dayKnown ? (
                    <span className={styles.pl} data-tone={totals.day >= 0 ? "pos" : "neg"}>{signedMoney(totals.day)}</span>
                  ) : "—"}
                </td>
                <td className={styles.numCol}>{totals.value > 0 ? money(totals.value) : "—"}</td>
                <td className={styles.numCol}>
                  {totalPl != null ? (
                    <span className={styles.pl} data-tone={totalPl >= 0 ? "pos" : "neg"}>{signedPct(totalPl)}</span>
                  ) : "—"}
                </td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

// Category chip + inline theme override dropdown.
function CategorySelect({ ticker, category, source, onSetCategory }) {
  const change = (e) => {
    const v = e.target.value;
    onSetCategory(ticker, v === "__auto__" ? null : v);
  };
  return (
    <span className={styles.catWrap}>
      <select
        className={styles.catSelect}
        value={source === "manual" ? category : "__auto__"}
        onChange={change}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Theme for ${ticker}`}
        title={source === "manual" ? "Manual theme override" : `Auto: ${category}`}
        data-source={source}
      >
        <option value="__auto__">{`Auto · ${category}`}</option>
        {THEMES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    </span>
  );
}
