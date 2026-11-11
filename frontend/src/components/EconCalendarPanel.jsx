import { useMemo, useState } from "react";
import DataTable from "./DataTable";
import Icon from "./Icon";
import SuggestionHistoryPreview from "./SuggestionHistoryPreview";
import { formatDate } from "../lib/format";
import styles from "./EconCalendarPanel.module.css";
import Tooltip from "./Tooltip";

const IMPORTANCE_LABEL = { high: "High impact", medium: "Medium impact", low: "Low impact" };

// Rows arrive sorted by date then time; each date is a group.
const COLUMNS = [
  { key: "time", label: "Time", cellClassName: styles.time, phone: "subtitle", skeleton: "48px",
    render: (ev) => ev.time || "—" },
  { key: "impact", label: "", caption: "Impact", headProps: { "aria-label": "Impact" }, phone: "subtitle",
    skeleton: "14px",
    render: (ev) => (
      <Tooltip content={IMPORTANCE_LABEL[ev.importance] || ev.importance}>
        <span className={styles.dot} data-impact={ev.importance} role="img"
              aria-label={IMPORTANCE_LABEL[ev.importance] || ev.importance} />
      </Tooltip>
    ) },
  { key: "event", label: "Event", cellClassName: styles.event, phone: "title", skeleton: "200px",
    render: (ev) => (
      <>
        <Tooltip truncate><span className={styles.eventName}>{ev.event}</span></Tooltip>
        {ev.country && <span className={styles.country}>{ev.country}</span>}
      </>
    ) },
  { key: "actual", label: "Actual", className: styles.num, cellClassName: (ev) => (ev.actual ? styles.actual : ""),
    phone: "value", skeleton: "56px", render: (ev) => ev.actual || "—" },
  { key: "forecast", label: "Forecast", className: styles.num, skeleton: "56px", render: (ev) => ev.forecast || "—" },
  { key: "previous", label: "Previous", className: styles.num, cellClassName: styles.muted, skeleton: "56px",
    render: (ev) => ev.previous || "—" },
];

export default function EconCalendarPanel({ data = [], loading, busy, onRefresh, onNavigate }) {
  const [highOnly, setHighOnly] = useState(false);

  const filtered = useMemo(
    () => (highOnly ? data.filter((e) => e.importance === "high") : data),
    [data, highOnly],
  );

  // Impact ratings are uniform per fetch: official from FMP, or our curated read.
  const curated = data.length > 0 && data.every((e) => e.importance_source === "curated");
  const showEmpty = !loading && filtered.length === 0;

  return (
    <>
    {/* What we suggested and how it turned out, above the macro schedule: the
        calendar answers "what's coming", this answers "how did the last two
        weeks of calls actually go". */}
    <SuggestionHistoryPreview onOpenFull={() => onNavigate?.("suggestion-history")} />

    <section className={styles.panel} id="econ-calendar">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Economic Calendar</h2>
          <p className={styles.subtitle}>
            Upcoming macro releases · CPI, FOMC, payrolls &amp; more ·{" "}
            {curated
              ? "impact estimated by SIGNAL from the event name"
              : "official impact ratings"}
          </p>
        </div>
        <div className={styles.controls}>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={highOnly}
              onChange={(e) => setHighOnly(e.target.checked)}
            />
            High impact only
          </label>
        </div>
      </header>

      {showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name="calendar" size={24} /></span>
          <p className={styles.emptyTitle}>
            {highOnly && data.length > 0
              ? "No high-impact events in this window"
              : "No economic events loaded yet"}
          </p>
          <button className={styles.emptyBtn} onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={filtered}
          rowKey={(ev) => ev.event_id}
          rowLabel={(ev) => ev.event}
          loading={loading}
          groupBy={(ev) => ev.date}
          groupHeader={(date) => ({ time: formatDate(date) })}
          classes={{ wrap: styles.tableWrap, table: styles.table, groupRow: styles.dateRow }}
        />
      )}
    </section>
    </>
  );
}
