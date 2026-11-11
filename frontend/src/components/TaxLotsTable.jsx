import { useState } from "react";
import DataTable from "./DataTable";
import { formatDate, formatMoney } from "../lib/format";
import styles from "./TaxLotsTable.module.css";

const tone = (v) => (v > 0 ? "up" : v < 0 ? "down" : "flat");
const CARD_TONE = { up: "pos", down: "neg" };

function approx(l) {
  return !l.exact && (
    <span className={styles.approx} title="an edit set this position; when these shares were bought isn't known"> ≈</span>
  );
}

function bought(l) {
  return `bought ${formatDate(l.acquired)}${l.term === "short" ? ` · long term after ${formatDate(l.long_term_from)}` : ""}`;
}

/**
 * Every position with its unrealized gain split short / long term, each
 * expandable to its lots (acquired, size, cost, gain, term, the day it turns
 * long term). An approximate lot — one an edit set — is marked. Props:
 * positions (GET /api/portfolio/lots), emptyText.
 */
export default function TaxLotsTable({ positions, emptyText = "No positions in this account." }) {
  const [open, setOpen] = useState({});
  const money = (p) => (v) => (v == null ? "—" : formatMoney(v, p.currency));

  const columns = [
    { key: "ticker", label: "Ticker", cellClassName: styles.ticker, phone: "title", render: (p) => p.ticker },
    { key: "qty", label: "Shares", className: styles.num, phone: "subtitle", render: (p) => +p.qty.toFixed(4),
      phoneRender: (p) => `${+p.qty.toFixed(4)} sh` },
    { key: "price", label: "Price", className: styles.num, cellProps: (p) => ({ title: p.price_source || "no price" }),
      render: (p) => money(p)(p.price) },
    { key: "short", label: "Short-term", className: styles.num, phone: "value",
      cellProps: (p) => ({ "data-tone": tone(p.unrealized.short) }), tone: (p) => CARD_TONE[tone(p.unrealized.short)],
      render: (p) => money(p)(p.unrealized.short) },
    { key: "long", label: "Long-term", className: styles.num, phone: "value",
      cellProps: (p) => ({ "data-tone": tone(p.unrealized.long) }), tone: (p) => CARD_TONE[tone(p.unrealized.long)],
      render: (p) => money(p)(p.unrealized.long) },
    { key: "lots", label: "Lots", phone: "hidden",
      render: (p) => (
        <button type="button" className={styles.toggle} aria-expanded={!!open[p.ticker]}
                onClick={() => setOpen({ ...open, [p.ticker]: !open[p.ticker] })}>
          {p.lots.length} lot{p.lots.length === 1 ? "" : "s"} {open[p.ticker] ? "▴" : "▾"}
        </button>
      ) },
  ];

  const lots = (p, layout) => {
    const m = money(p);
    if (layout === "cards") {
      return (
        <ul className={styles.lotList} aria-label={`Lots of ${p.ticker}`}>
          {p.lots.map((l) => (
            <li key={l.id} data-tone={tone(l.gain)}>
              <span>{l.id}{approx(l)} · {+l.qty.toFixed(4)} @ {m(l.per_share)}</span>
              <span className={styles.gain}>{m(l.gain)} <span className={styles.faint}>{l.term}</span></span>
              <span className={styles.faint}>{bought(l)}</span>
            </li>
          ))}
        </ul>
      );
    }
    return open[p.ticker] && p.lots.map((l) => (
      <tr key={l.id} className={styles.lot}>
        <td>{l.id}{approx(l)}</td>
        <td className={styles.num}>{+l.qty.toFixed(4)}</td>
        <td className={styles.num}>{m(l.per_share)}</td>
        <td className={styles.num} colSpan={2} data-tone={tone(l.gain)}>
          {m(l.gain)} <span className={styles.faint}>{l.term}</span>
        </td>
        <td className={styles.faint}>{bought(l)}</td>
      </tr>
    ));
  };

  return (
    <DataTable
      columns={columns}
      rows={positions}
      rowKey={(p) => p.ticker}
      rowAfter={lots}
      dense
      empty={<p className={styles.empty}>{emptyText}</p>}
    />
  );
}
