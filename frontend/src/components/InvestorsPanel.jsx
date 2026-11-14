import CollapseToggle from "./CollapseToggle";
import CollapsibleSection from "./CollapsibleSection";
import DataTable from "./DataTable";
import EmptyState from "./EmptyState";
import PanelInfo from "./PanelInfo";
import ShowAll from "./ShowAll";
import Tooltip from "./Tooltip";
import ViewAll from "./ViewAll";
import { useCollapsedSections } from "../hooks/useCollapsedSections";
import { PHONE, useMediaQuery } from "../hooks/useMediaQuery";
import { usePhoneLimit } from "../hooks/usePhoneLimit";
import { formatCurrencyCompact, formatDate } from "../lib/format";
import { openTickerTab } from "../lib/nav";
import styles from "./InvestorsPanel.module.css";

const COMPACT_LIMIT = 8;
const PHONE_LIMIT = 10;
// The blurb, around the number of funds.
const BLURB_HEAD = "Quarter-end holdings of ";
const BLURB_TAIL = "from SEC 13F filings — filed up to 45 days after the quarter, long US positions only.";
const MOVE_TONE = { NEW: "buy", ADDED: "buy", TRIMMED: "sell", "SOLD OUT": "sell" };
const EDGAR = (f) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${f.cik}&type=13F-HR`;

const COLUMNS = [
  { key: "filer", label: "Investor", phone: "subtitle", sort: (m) => m.filer,
    render: (m) => <Tooltip content={m.person}><span className={styles.filer}>{m.filer}</span></Tooltip> },
  { key: "move", label: "Move", phone: "subtitle", sort: (m) => m.status,
    render: (m) => <span className={styles.badge} data-tone={MOVE_TONE[m.status]}>{m.status.toLowerCase()}</span> },
  { key: "ticker", label: "Stock", phone: "title", sort: (m) => m.ticker || m.issuer,
    render: (m) => (m.ticker ? (
      <button type="button" className={styles.ticker} onClick={() => openTickerTab(m.ticker)}
              title={`${m.issuer} · ticker matched by ${m.ticker_source}`}>{m.ticker}</button>
    ) : <span className={styles.muted} title="no ticker matched">{m.issuer}</span>) },
  { key: "change", label: "Change", cellClassName: styles.muted, sort: (m) => m.change_pct,
    render: changeText },
  { key: "value", label: "Value", className: styles.num, phone: "value", sort: (m) => Math.max(m.value, m.prev_value),
    render: (m) => formatCurrencyCompact(Math.max(m.value, m.prev_value)) },
  { key: "pct", label: "% of 13F", className: styles.num, phone: "value", sort: (m) => m.pct, render: pctText },
  { key: "period", label: "As of", cellClassName: styles.muted, phone: "subtitle", render: (m) => formatDate(m.period) },
];

function pctText(m) {
  if (m.status === "SOLD OUT") return "—";
  return m.pct === 0 && m.value > 0 ? "<0.01%" : `${m.pct.toFixed(2)}%`;
}

function changeText(m) {
  if (m.status === "NEW") return "new";
  if (m.status === "SOLD OUT") return "sold out";
  return m.change_pct == null ? "—" : `${m.change_pct > 0 ? "+" : ""}${m.change_pct.toFixed(1)}% shares`;
}

/**
 * Famous investors' 13F filings: what each tracked fund bought, added,
 * trimmed and sold out of in its latest quarter. Every row says the quarter
 * it's as of — a 13F is filed up to 45 days after the quarter ends. Props:
 * data ({filers, moves}), loading, busy, onRefresh, compact (top moves and
 * no filer list), onViewAll, collapsible / collapsed / onToggleCollapse.
 * On a phone the moves stop at ten until Show all, and the fund list is a
 * section of its own, folded until opened.
 */
export default function InvestorsPanel({ data, loading, busy, onRefresh, compact = false, onViewAll,
  collapsible = false, collapsed = false, onToggleCollapse }) {
  const phone = useMediaQuery(PHONE);
  const sections = useCollapsedSections("investors:");
  const moves = data?.moves || [];
  const filers = data?.filers || [];
  const { limit, showAll } = usePhoneLimit(compact ? 0 : moves.length, PHONE_LIMIT);
  const funds = filers.length ? `${filers.length} fund${filers.length === 1 ? "" : "s"}` : "well-known funds";
  const filerList = (
    <ul className={styles.filers}>
      {filers.map((f) => (
        <li key={f.cik}>
          <a href={EDGAR(f)} target="_blank" rel="noreferrer" className={styles.filerLink}>{f.filer}</a>
          <span className={styles.muted}>
            {f.person} · as of {formatDate(f.period)}, filed {formatDate(f.filed)} · {f.positions} positions ·
            {" "}{formatCurrencyCompact(f.total_value)}
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <section className={styles.panel} id="investors">
      <header className={styles.head}>
        {collapsible && <CollapseToggle collapsed={collapsed} onClick={onToggleCollapse} label="Famous investors" />}
        <div>
          <h2 className={styles.title}>
            Famous investors (13F)<PanelInfo label="Famous investors" blurb={`${BLURB_HEAD}${funds} ${BLURB_TAIL}`} />
          </h2>
          <p className={styles.subtitle}>{BLURB_HEAD}{funds}{" "}{BLURB_TAIL}</p>
        </div>
        {compact && onViewAll && <ViewAll onClick={onViewAll} />}
      </header>

      {!collapsed && (!loading && moves.length === 0 ? (
        <EmptyState icon="layers" title="No 13F filings loaded yet" onRetry={onRefresh} busy={busy} />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={moves}
            rowKey={(m) => `${m.cik}:${m.cusip}`}
            rowLabel={(m) => `${m.filer}: ${m.ticker || m.issuer}`}
            limit={compact ? COMPACT_LIMIT : limit}
            classes={{ wrap: styles.tableWrap, table: styles.table }}
          />
          {showAll && <ShowAll {...showAll} noun="moves" />}
          {!compact && filers.length > 0 && (phone ? (
            <CollapsibleSection
              className={styles.funds}
              caption={`Funds tracked · ${filers.length}`}
              collapsed={sections.isCollapsed("funds")}
              onToggle={() => sections.setCollapsed(["funds"], !sections.isCollapsed("funds"))}
            >
              {filerList}
            </CollapsibleSection>
          ) : filerList)}
        </>
      ))}
    </section>
  );
}
