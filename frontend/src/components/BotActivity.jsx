import DataTable from "./DataTable";
import { formatMoney, formatRelativeTime } from "../lib/format";
import styles from "./BotActivity.module.css";

const KIND_LABEL = { buy: "Buy", sell: "Sell", skip: "Skip", error: "Error", info: "Info" };
const KIND_TONE = { buy: "pos", sell: "neg" };
// A bot card is narrow even on a desktop; there the log is a list too.
const CARDS_BELOW = 560;

/**
 * A bot's decision log: every fill and every skip worth explaining, with the
 * reason in words. Newest first, sortable; rows become cards whenever the
 * log itself is narrow (a phone, or a bot card).
 * Props: events [{at, kind, ticker, qty, price, reason}], currency, empty text.
 */
export default function BotActivity({ events, currency, emptyText = "Nothing yet — the bot acts while its market is open." }) {
  const columns = [
    { key: "at", label: "When", phone: "subtitle", sort: (e) => e.at, cellProps: (e) => ({ title: e.at }),
      render: (e) => formatRelativeTime(e.at) },
    { key: "kind", label: "Action", phone: "title", sort: (e) => e.kind,
      render: (e) => <span className={styles.kind} data-kind={e.kind}>{KIND_LABEL[e.kind] || e.kind}</span> },
    { key: "ticker", label: "Ticker", phone: "title", sort: (e) => e.ticker, render: (e) => e.ticker || "—" },
    { key: "qty", label: "Qty", className: styles.num, phone: "value", render: (e) => (e.qty != null ? e.qty : "—") },
    { key: "price", label: "Price", className: styles.num, phone: "value", tone: (e) => KIND_TONE[e.kind],
      render: (e) => (e.price != null ? formatMoney(e.price, currency) : "—") },
    { key: "reason", label: "Why", cellClassName: styles.reason, phone: "subtitle", render: (e) => e.reason },
  ];

  return (
    <DataTable
      columns={columns}
      rows={events}
      rowKey={(e) => e.id}
      rowLabel={(e) => `${KIND_LABEL[e.kind] || e.kind} ${e.ticker || ""}`.trim()}
      cardsBelow={CARDS_BELOW}
      empty={<p className={styles.empty}>{emptyText}</p>}
      classes={{ wrap: styles.wrap, table: styles.table }}
    />
  );
}
