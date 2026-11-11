import { useEffect, useState } from "react";
import DataTable from "./DataTable";
import HitRateCell from "./HitRateCell";
import Segmented from "./Segmented";
import Skeleton from "./Skeleton";
import VersionPicker from "./VersionPicker";
import { getSignalReplay, getTrackRecord } from "../api";
import styles from "./BacktestPanels.module.css";
import Term from "./Term";

const BASIS_OPTIONS = [
  { value: "net", label: "Net", title: "After paying the cost model on the way in and out" },
  { value: "gross", label: "Gross", title: "The raw price move, before costs" },
];

const medianTone = (median) => (median == null ? "" : median >= 0 ? "pos" : "neg");
const CLASSES = { wrap: styles.tableWrap, table: styles.table };

/** null means "we don't know", and must never render as 0. */
function num(v, suffix = "") {
  return v == null ? <span className={styles.unknown}>—</span> : `${v}${suffix}`;
}

/**
 * The outcome columns both tables share. `stats(row)` gives the scored count
 * `n`, the `pending` count and the hit/median stats `h` for the chosen
 * window and basis.
 */
function outcomeColumns(stats) {
  return [
    { key: "scored", caption: "Scored", className: styles.num, render: (r) => stats(r).n,
      label: <Term tip="Entries whose forward window has ended, so a price change can be measured">Scored</Term> },
    { key: "pending", caption: "Pending", className: styles.num,
      label: <Term tip="Entries whose window has not ended yet — counted neither as hits nor as misses">Pending</Term>,
      cellProps: (r) => ({ "data-pending": stats(r).pending > 0 ? "yes" : "no" }),
      render: (r) => (stats(r).pending > 0 ? stats(r).pending : "—") },
    { key: "hit", caption: "Hit rate", className: styles.num, phone: "value",
      label: <Term tip="Share of scored entries whose price was higher at the end of the window, with its 95% interval. It does not look at which way the suggestion pointed. Fewer than 30 outcomes show as not enough data.">Hit rate</Term>,
      render: (r) => <HitRateCell stats={stats(r).h} /> },
    { key: "median", caption: "Median", className: styles.num, phone: "value",
      label: <Term tip="Median price change over the window, across scored entries">Median</Term>,
      cellProps: (r) => ({ "data-tone": medianTone(stats(r).h.median) }),
      tone: (r) => medianTone(stats(r).h.median) || null,
      render: (r) => num(stats(r).h.median, "%") },
  ];
}

function Coverage({ coverage, caveat }) {
  const days = coverage?.distinct_days ?? 0;
  return (
    <div className={styles.coverage}>
      <span className={styles.covMain}>
        {days === 0
          ? "No history recorded yet"
          : `${days} day${days === 1 ? "" : "s"} of history · ${coverage.first_date} → ${coverage.last_date}`}
      </span>
      {/* The caveat ships with the numbers rather than being implied by them. */}
      <span className={styles.covNote}>{caveat}</span>
    </div>
  );
}

function TrackRecord() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [horizon, setHorizon] = useState(7);
  const [groupBy, setGroupBy] = useState("action");
  const [basis, setBasis] = useState("net");
  const [version, setVersion] = useState(null);

  useEffect(() => {
    let alive = true;
    getTrackRecord(12, version)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [version]);

  if (error) return <p className={styles.error}>Couldn&apos;t load the track record: {error}</p>;
  if (!data) return <Skeleton w="100%" h="260px" />;

  // Three groupings of the same rows. "By stock" answers the first question
  // the aggregates provoke — which company is this actually about.
  const named = (list) => (list || []).filter((b) => b.label !== "(none)");
  const GROUPS = {
    action: [data.overall, ...named(data.by_action)],
    kind: [data.overall, ...named(data.by_kind)],
    ticker: named(data.by_ticker),
  };
  const buckets = GROUPS[groupBy] || GROUPS.action;
  const stat = (b) => b[`d${horizon}${basis === "net" ? "_net" : ""}`] || {};
  const columns = [
    { key: "label", label: groupBy === "ticker" ? "Stock" : "Bucket", cellClassName: styles.label, phone: "title",
      render: (b) => b.label },
    { key: "total", label: "Total", className: styles.num, phone: "subtitle", render: (b) => b.n,
      phoneRender: (b) => `${b.n} total` },
    ...outcomeColumns((b) => ({ n: stat(b).n ?? 0, pending: b[`d${horizon}_pending`] ?? 0, h: stat(b) })),
    { key: "best", label: "Best", className: styles.num, render: (b) => num(stat(b).best, "%") },
    { key: "worst", label: "Worst", className: styles.num, render: (b) => num(stat(b).worst, "%") },
  ];

  return (
    <div className={styles.body}>
      <Coverage coverage={data.coverage} caveat={data.caveat} />

      <div className={styles.controls}>
        <VersionPicker versions={data.versions} value={data.model_version} onChange={setVersion} />
        <Segmented
          ariaLabel="Horizon"
          value={String(horizon)}
          onChange={(v) => setHorizon(Number(v))}
          options={[
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
          ]}
        />
        <Segmented ariaLabel="Gross or net of costs" value={basis} onChange={setBasis} options={BASIS_OPTIONS} />
        <Segmented
          ariaLabel="Group by"
          value={groupBy}
          onChange={setGroupBy}
          options={[
            { value: "action", label: "By action" },
            { value: "kind", label: "By kind" },
            { value: "ticker", label: "By stock" },
          ]}
        />
        <span className={styles.benchmark}>
          {data.benchmark?.available
            ? `SPY over the same window: ${data.benchmark.return_pct >= 0 ? "+" : ""}${data.benchmark.return_pct}%`
            : `No benchmark — ${data.benchmark?.reason || "unavailable"}`}
        </span>
      </div>

      {data.overall.n === 0 ? (
        <p className={styles.empty}>
          Nothing to score yet. Suggestions are recorded from the first daily run
          onwards; there is no backfill, because reconstructing calls that were
          never made would be inventing them.
        </p>
      ) : (
        <DataTable columns={columns} rows={buckets} rowKey={(b) => b.label} classes={CLASSES} />
      )}
    </div>
  );
}

function SignalReplay() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [horizon, setHorizon] = useState(7);
  const [basis, setBasis] = useState("net");
  const [version, setVersion] = useState(null);

  useEffect(() => {
    let alive = true;
    getSignalReplay({ horizon, months: 12, version })
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [horizon, version]);

  if (error) return <p className={styles.error}>Couldn&apos;t run the replay: {error}</p>;
  if (!data) return <Skeleton w="100%" h="260px" />;

  const max = Math.max(1, ...data.thresholds.map((t) => t.crossings));
  const columns = [
    { key: "threshold", label: "Threshold", cellClassName: styles.label, phone: "title", render: (t) => <>≥ {t.threshold}</> },
    { key: "crossings", label: "Crossings", className: styles.num, phone: "subtitle", render: (t) => t.crossings,
      phoneRender: (t) => `${t.crossings} crossings` },
    ...outcomeColumns((t) => ({ n: t.n, pending: t.pending, h: basis === "net" ? t.net : t })),
    // Bar width is sample size, so a 100% hit rate off two crossings
    // visibly isn't the same as off forty.
    { key: "sample", label: "Sample",
      render: (t) => (
        <span className={styles.bar}>
          <span className={styles.barFill} style={{ width: `${(t.crossings / max) * 100}%` }} />
        </span>
      ) },
  ];

  return (
    <div className={styles.body}>
      <Coverage coverage={data.coverage} caveat={data.caveat} />

      <div className={styles.controls}>
        <VersionPicker versions={data.versions} value={data.model_version} onChange={setVersion} />
        <Segmented
          ariaLabel="Forward window"
          value={String(horizon)}
          onChange={(v) => setHorizon(Number(v))}
          options={[
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
          ]}
        />
        <Segmented ariaLabel="Gross or net of costs" value={basis} onChange={setBasis} options={BASIS_OPTIONS} />
        <span className={styles.benchmark}>
          Where does the boom score become useful? Each row is every upward
          crossing of that level, and what price did next.
        </span>
      </div>

      {data.thresholds.every((t) => t.crossings === 0) ? (
        <p className={styles.empty}>
          No threshold crossings recorded in this window yet. Boom-score history
          builds up as the scorer runs.
        </p>
      ) : (
        <DataTable columns={columns} rows={data.thresholds} rowKey={(t) => t.threshold} classes={CLASSES} />
      )}
    </div>
  );
}

/** Track record + signal replay, shown under the History calendar. */
export default function BacktestPanels() {
  const [tab, setTab] = useState("track");
  return (
    <section className={styles.panel} id="backtest">
      <div className={styles.head}>
        <span className="caption">Did it work?</span>
        <Segmented
          ariaLabel="Backtest view"
          value={tab}
          onChange={setTab}
          options={[
            { value: "track", label: "Track record", title: "What we suggested, and what happened" },
            { value: "replay", label: "Signal replay", title: "Boom-score crossings vs the move that followed" },
          ]}
        />
      </div>
      {tab === "track" ? <TrackRecord /> : <SignalReplay />}
    </section>
  );
}
