import { useState } from "react";
import Icon from "./Icon";
import { openTickerTab } from "../lib/nav";
import { formatCurrencyCompact } from "../lib/format";
import styles from "./PortfolioPanel.module.css";

const DIRECTIVE_TONE = { Accumulate: "buy", Hold: "hold", Reduce: "warn", Avoid: "sell" };

export default function PortfolioPanel({ portfolio, signals, quotes = {}, analyses = [], onAdd, onRemove }) {
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const analysisByTicker = Object.fromEntries(analyses.map((a) => [a.ticker, a]));

  // ticker -> current price, for P/L: live quote first, signal price fallback.
  const priceOf = (t) => {
    const q = quotes[t];
    if (q && q.price != null) return q.price;
    const sig = signals.find((s) => s.ticker === t);
    return sig && sig.price != null ? sig.price : null;
  };

  // Book totals: market value, total P/L vs cost, and today's P/L (from the
  // live quote's previous close). Partial data stays partial — no guessing.
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
    try {
      await onAdd(t, sh, ac);
      setTicker(""); setShares(""); setAvgCost("");
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

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
      </header>

      <form className={styles.form} onSubmit={submit} data-tour="add-form">
        <input
          className={styles.ticker}
          placeholder="Ticker"
          value={ticker}
          maxLength={12}
          onChange={(e) => setTicker(e.target.value)}
        />
        <input
          className={styles.num}
          placeholder="Shares"
          value={shares}
          type="number"
          min="0"
          step="any"
          onChange={(e) => setShares(e.target.value)}
        />
        <input
          className={styles.num}
          placeholder="Avg cost"
          value={avgCost}
          type="number"
          min="0"
          step="any"
          onChange={(e) => setAvgCost(e.target.value)}
        />
        <button className={styles.add} disabled={pending || !ticker.trim()}>
          {pending ? "Adding…" : "Add"}
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}

      {portfolio.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="star" size={24} /></span>
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {portfolio.map((h) => {
                const price = priceOf(h.ticker);
                const q = quotes[h.ticker];
                const value = price != null ? price * h.shares : null;
                const plPct = price != null && h.avg_cost > 0
                  ? (price - h.avg_cost) / h.avg_cost * 100 : null;
                const dayPct = q && q.change_pct != null ? q.change_pct : null;
                const tone = plPct == null ? "flat" : plPct >= 0 ? "pos" : "neg";
                const dayTone = dayPct == null ? "flat" : dayPct >= 0 ? "pos" : "neg";
                const an = analysisByTicker[h.ticker];
                return (
                  <tr key={h.ticker} className={styles.row} onClick={() => openTickerTab(h.ticker)}
                      title={`Analyze ${h.ticker} in a new tab`}>
                    <td><span className={styles.symbol}>{h.ticker}</span></td>
                    <td className={styles.numCol}>{h.shares}</td>
                    <td className={styles.numCol}>{formatCurrencyCompact(h.avg_cost)}</td>
                    <td className={styles.numCol}>
                      {/* keyed by price so a 30s tick re-triggers the flash */}
                      {price != null
                        ? <span key={price} className={styles.tick} data-tone={dayTone}>{formatCurrencyCompact(price)}</span>
                        : "—"}
                    </td>
                    <td className={styles.numCol}>
                      <span className={styles.pl} data-tone={dayTone}>
                        {dayPct != null ? `${dayPct >= 0 ? "+" : ""}${dayPct.toFixed(2)}%` : "—"}
                      </span>
                    </td>
                    <td className={styles.numCol}>{value != null ? formatCurrencyCompact(value) : "—"}</td>
                    <td className={styles.numCol}>
                      <span className={styles.pl} data-tone={tone}>
                        {plPct != null ? `${plPct >= 0 ? "+" : ""}${plPct.toFixed(1)}%` : "—"}
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
                      <button
                        className={styles.remove}
                        onClick={(e) => { e.stopPropagation(); onRemove(h.ticker); }}
                        title={`Remove ${h.ticker}`}
                        aria-label={`Remove ${h.ticker}`}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className={styles.totals}>
                <td>Total</td>
                <td className={styles.numCol}></td>
                <td className={styles.numCol}></td>
                <td className={styles.numCol}></td>
                <td className={styles.numCol}>
                  {totals.dayKnown ? (
                    <span className={styles.pl} data-tone={totals.day >= 0 ? "pos" : "neg"}>
                      {totals.day >= 0 ? "+" : "−"}{formatCurrencyCompact(Math.abs(totals.day))}
                    </span>
                  ) : "—"}
                </td>
                <td className={styles.numCol}>{totals.value > 0 ? formatCurrencyCompact(totals.value) : "—"}</td>
                <td className={styles.numCol}>
                  {totalPl != null ? (
                    <span className={styles.pl} data-tone={totalPl >= 0 ? "pos" : "neg"}>
                      {totalPl >= 0 ? "+" : ""}{totalPl.toFixed(1)}%
                    </span>
                  ) : "—"}
                </td>
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
