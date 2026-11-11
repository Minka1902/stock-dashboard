import { useState } from "react";
import Button from "./Button";
import DataTable from "./DataTable";
import ExitRuleDialog from "./ExitRuleDialog";
import { useExitRules } from "../hooks/useExitRules";
import { openTickerTab } from "../lib/nav";
import { formatMoney } from "../lib/format";
import styles from "./ExitRulesTable.module.css";

const KIND_LABEL = { stop: "stop", take_profit: "target", trailing: "trail" };
// Inside a narrow pane (a phone, or a side column) the rules are a list.
const CARDS_BELOW = 640;

function statusOf(item) {
  const r = item.rule;
  if (!r) return { tone: "none", text: "No rule" };
  if (!r.active) return { tone: "paused", text: "Paused" };
  if (r.fired.length) return { tone: "fired", text: `Alerted: ${r.fired.map((k) => KIND_LABEL[k] || k).join(", ")}` };
  return { tone: "watching", text: "Watching" };
}

/**
 * Every holding in one book with its exit rule: the levels in force, whether
 * each has alerted, and the plan's suggested stop where there's no stop yet.
 * Rows open ExitRuleDialog. Props: account ("manual" | "paper"), title,
 * emptyText (shown when the book holds nothing).
 */
export default function ExitRulesTable({ account = "manual", title = "Exit rules",
  emptyText = "No holdings in this book yet — add one on the Portfolio page." }) {
  const { items, loading, error, reload } = useExitRules(account);
  const [editing, setEditing] = useState(null);

  const held = items.filter((i) => i.held);
  const orphans = items.filter((i) => !i.held && i.rule);
  const money = (i) => (v) => (v == null ? "—" : formatMoney(v, i.currency));
  const columns = [
    { key: "ticker", label: "Ticker", phone: "title",
      render: (i) => (
        <button type="button" className={styles.symbol} onClick={() => openTickerTab(i.ticker)}>{i.ticker}</button>
      ) },
    { key: "price", label: "Price", className: styles.num, render: (i) => money(i)(i.price) },
    { key: "cost", label: "Avg cost", className: styles.num, render: (i) => money(i)(i.avg_cost) },
    { key: "stop", label: "Stop", className: styles.num,
      render: (i) => (i.levels?.stop != null ? money(i)(i.levels.stop) : i.suggested ? (
        <span className={styles.suggested} title={i.suggested.reason}>suggested {money(i)(i.suggested.stop_price)}</span>
      ) : "—") },
    { key: "target", label: "Target", className: styles.num, render: (i) => money(i)(i.levels?.take_profit) },
    { key: "trail", label: "Trail", className: styles.num,
      render: (i) => (i.rule?.trailing_pct != null ? `${i.rule.trailing_pct}% → ${money(i)(i.levels?.trailing)}` : "—") },
    { key: "status", label: "Status", phone: "subtitle",
      render: (i) => {
        const st = statusOf(i);
        return <span className={styles.status} data-tone={st.tone}>{st.text}</span>;
      } },
    { key: "actions", label: "", caption: "Rule", headProps: { "aria-label": "Actions" }, phone: "value",
      render: (i) => (
        <Button size="sm" variant={i.rule ? "quiet" : "ghost"} onClick={() => setEditing(i)}>
          {i.rule ? "Edit" : "Add rule"}
        </Button>
      ) },
  ];

  return (
    <section className={styles.root} aria-labelledby={`rules-${account}`}>
      <header className={styles.head}>
        <h3 id={`rules-${account}`} className={styles.title}>{title}</h3>
        <span className={styles.sub}>Stops, take-profits and trailing stops. They alert; they never sell.</span>
      </header>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {loading ? (
        <p className={styles.empty}>Loading rules…</p>
      ) : held.length === 0 ? (
        <p className={styles.empty}>{emptyText}</p>
      ) : (
        <DataTable
          columns={columns}
          rows={held}
          rowKey={(i) => i.ticker}
          cardsBelow={CARDS_BELOW}
          classes={{ wrap: styles.wrap, table: styles.table }}
        />
      )}
      {orphans.length > 0 && (
        <p className={styles.empty}>
          Rules kept for tickers you no longer hold (inactive until you buy again): {orphans.map((o) => o.ticker).join(", ")}
        </p>
      )}
      {editing && (
        <ExitRuleDialog ticker={editing.ticker} account={account} item={editing}
                        onSaved={reload} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}
