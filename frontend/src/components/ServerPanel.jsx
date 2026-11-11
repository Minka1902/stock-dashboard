import { useCallback, useEffect, useRef, useState } from "react";
import { animate } from "animejs";
import { AnimatePresence, motion } from "motion/react";
import AuditChainCheck from "./AuditChainCheck";
import DataTable from "./DataTable";
import Icon from "./Icon";
import Skeleton from "./Skeleton";
import SchedulerSection from "./SchedulerSection";
import SourceDrawer from "./SourceDrawer";
import SourceImport from "./SourceImport";
import { useServerStatus } from "../hooks/useServerStatus";
import { formatRelativeTime, formatUntil } from "../lib/format";
import { prefersReducedMotion } from "../lib/motionConfig";
import { STATE_TIP, sourceState } from "../lib/sources";
import Tooltip from "./Tooltip";
import styles from "./ServerPanel.module.css";
import Term from "./Term";

const TONE = { ok: "pos", error: "neg", deferred: "caution", never: "faint" };

function stateOf(s) {
  return s.never_run || !s.status ? "never" : sourceState(s.status);
}

/** Next-run cell: says *why* a source is not running, never just a blank. */
function nextRunLabel(s) {
  if (s.running_for_seconds != null) return "running now";
  if (s.queued) return "queued — runs late, not dropped";
  if (s.schedule && !s.schedule.enabled) return "paused";
  if (s.next_attempt_at) return `retry ${formatUntil(s.next_attempt_at)}`;
  if (s.never_run) return s.next_run_at ? `never run · next ${formatUntil(s.next_run_at)}` : "never run";
  return s.next_run_at ? formatUntil(s.next_run_at) : "—";
}

// The "Show similar" filter lives in the URL query (?kind=&id=) so a reload
// or a shared link keeps it.
function readFilter() {
  const q = new URLSearchParams(window.location.search);
  const kind = q.get("kind");
  const id = q.get("id");
  return (kind === "source" || kind === "job") && id ? { kind, id } : null;
}

function writeFilter(filter) {
  const url = new URL(window.location.href);
  if (filter) {
    url.searchParams.set("kind", filter.kind);
    url.searchParams.set("id", filter.id);
  } else {
    url.searchParams.delete("kind");
    url.searchParams.delete("id");
  }
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

function bytes(n) {
  if (n == null) return "—";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function duration(seconds) {
  if (seconds == null) return "—";
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

function ms(v) {
  if (v == null) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
}

/** A CPU meter whose width eases to its value (animejs, reduced-motion aware). */
function Meter({ value, label }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const pct = Math.max(0, Math.min(100, value ?? 0));
    if (prefersReducedMotion()) { el.style.width = `${pct}%`; return undefined; }
    const anim = animate(el, { width: `${pct}%`, duration: 420, ease: "outQuad" });
    return () => anim.pause();
  }, [value]);
  const text = `${label}: ${value == null ? "—" : `${value.toFixed(0)}%`}`;
  return (
    <Tooltip content={text}>
      <span className={styles.meter} role="img" aria-label={text}>
        <span ref={ref} className={styles.meterFill} data-hot={(value ?? 0) > 85 ? "yes" : "no"} />
      </span>
    </Tooltip>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue} data-tone={tone}>{value}</span>
    </div>
  );
}

export default function ServerPanel() {
  const [filter, setFilter] = useState(readFilter);
  const [drawerName, setDrawerName] = useState(null);
  const {
    overview, sources, events, schedules, setSchedules, error, loading, refresh,
  } = useServerStatus(true, filter?.kind ?? null, filter?.id ?? null);

  const applyFilter = useCallback((next) => {
    writeFilter(next);
    setFilter(next);
  }, []);
  const openDrawer = useCallback((name) => setDrawerName(name), []);
  const closeDrawer = useCallback(() => setDrawerName(null), []);

  if (error) {
    return (
      <section className={styles.panel}>
        <p className={styles.error}>
          <Icon name="bell" size={14} /> Couldn&apos;t read server state: {error}
        </p>
      </section>
    );
  }
  if (loading || !overview) return <Skeleton w="100%" h="420px" />;

  const proc = overview.process || {};
  const sys = proc.system || {};
  const failing = sources.filter((s) => stateOf(s) === "error");
  const deferred = sources.filter((s) => stateOf(s) === "deferred");
  const running = Object.entries(overview.running_sources || {});
  const queued = overview.queued || [];
  const jobs = overview.scheduler?.jobs || [];
  const scheduledCount = jobs.filter((j) => j.id.startsWith("src:")).length;
  const otherJobs = jobs.filter((j) => !j.id.startsWith("src:"));
  const drawerRow = drawerName ? sources.find((s) => s.source === drawerName) || null : null;
  const sourceNames = new Set(sources.map((s) => s.source));
  const reduced = prefersReducedMotion();
  const classes = { wrap: styles.tableWrap, table: styles.table };

  const sourceColumns = [
    { key: "source", label: "Source", cellClassName: styles.srcName, phone: "title",
      render: (s) => (
        <>
          {s.running_for_seconds != null && <span className={styles.pulse} />}
          {s.source}
          {s.importable && <SourceImport source={s.source} onImported={refresh} />}
        </>
      ) },
    { key: "status", label: "Status", cellClassName: styles.status, phone: "value",
      render: (s) => {
        const state = stateOf(s);
        return (
          <Tooltip content={(
            <>
              <strong>{s.never_run ? "never run" : s.status}</strong>
              <p>{STATE_TIP[state]}</p>
              <p>Click for run history and details.</p>
            </>
          )}>
            <button type="button" className={styles.badge} data-tone={TONE[state]}
                    onClick={(e) => { e.stopPropagation(); openDrawer(s.source); }}>
              {s.never_run ? "never run" : s.status}
            </button>
          </Tooltip>
        );
      } },
    { key: "success", label: "Last success",
      render: (s) => (s.last_success_at ? formatRelativeTime(s.last_success_at) : <em className={styles.never}>never</em>) },
    { key: "try", label: "Last try", render: (s) => (s.last_refreshed_at ? formatRelativeTime(s.last_refreshed_at) : "—") },
    { key: "last", label: "Last", className: styles.num, render: (s) => ms(s.last_duration_ms) },
    { key: "avg", label: "Avg", className: styles.num, render: (s) => ms(s.avg_duration_ms) },
    { key: "runs", caption: "Runs ok/err/def", className: styles.num,
      label: <Term tip="Count of runs that ended ok / in error / deferred (waiting on a rate limit)">ok/err/def</Term>,
      render: (s) => <>{s.runs_ok ?? 0}/{s.runs_error ?? 0}/{s.runs_deferred ?? 0}</> },
    { key: "schedule", label: "Schedule", cellClassName: styles.sched,
      render: (s) => (s.schedule
        ? `${s.schedule.source !== s.source ? `${s.schedule.source}: ` : ""}${s.schedule.description}`
        : "—") },
    { key: "next", label: "Next run", cellClassName: styles.nextCell, phone: "subtitle", render: nextRunLabel },
  ];

  const eventColumns = [
    { key: "when", label: "When", cellClassName: styles.evTime, phone: "subtitle",
      render: (e) => (
        <Tooltip content={new Date(e.at).toLocaleString()}>
          <span>{formatRelativeTime(e.at)}</span>
        </Tooltip>
      ) },
    { key: "kind", label: "Kind", cellClassName: styles.evKind, phone: "subtitle",
      cellProps: (e) => ({ "data-kind": e.kind }), render: (e) => e.kind },
    { key: "name", label: "Name", cellClassName: styles.srcName, phone: "title", render: (e) => e.id },
    { key: "outcome", label: "Outcome", phone: "value",
      render: (e) => (e.kind === "source" && sourceNames.has(e.id) ? (
        <Tooltip content="Open this source's details">
          <button type="button" className={styles.outcome} data-outcome={e.outcome} onClick={() => openDrawer(e.id)}>
            {e.outcome}
          </button>
        </Tooltip>
      ) : (
        <span className={styles.outcome} data-outcome={e.outcome}>{e.outcome}</span>
      )) },
    { key: "duration", label: "Duration", className: styles.num, render: (e) => ms(e.duration_ms) },
    { key: "records", label: "Records", className: styles.num, render: (e) => e.record_count ?? "" },
    { key: "detail", label: "Detail", cellClassName: styles.evDetail, truncate: true,
      render: (e) => (
        <>{e.detail || ""}{e.next_attempt_at ? ` · next attempt ${formatUntil(e.next_attempt_at)}` : ""}</>
      ) },
    { key: "actions", label: <span className={styles.srOnly}>Actions</span>, caption: "Actions", cellClassName: styles.evAct,
      render: (e) => !(filter && filter.kind === e.kind && filter.id === e.id) && (
        <Tooltip content={`Show only ${e.kind} ${e.id}`}>
          <button type="button" className={styles.similar} onClick={() => applyFilter({ kind: e.kind, id: e.id })}>
            Show similar
          </button>
        </Tooltip>
      ) },
  ];

  return (
    <div className={styles.wrap}>
      {/* ---- what the process is right now ---- */}
      <section className={styles.panel}>
        <div className={styles.head}>
          <span className="caption">Process</span>
          <span className={styles.headRight}>
            v{overview.version} · python {overview.python}
            <Tooltip content="Refresh now">
              <button type="button" className={styles.refresh} onClick={refresh} aria-label="Refresh now">
                <Icon name="refresh" size={12} />
              </button>
            </Tooltip>
          </span>
        </div>
        <div className={styles.body}>
          <div className={styles.stats}>
            <Stat label="Uptime" value={duration(overview.uptime_seconds)} />
            <Stat
              label="Scheduler"
              value={overview.scheduler?.running ? "running" : "stopped"}
              tone={overview.scheduler?.running ? "pos" : "neg"}
            />
            <Stat label="Database" value={bytes(overview.db?.size_bytes)} />
            <Stat
              label="WAL"
              value={bytes(overview.db?.wal_bytes)}
              tone={overview.db?.wal_bytes > 50 * 1024 * 1024 ? "neg" : undefined}
            />
          </div>

          {proc.available ? (
            <div className={styles.stats}>
              <Stat label="Memory (RSS)" value={bytes(proc.rss_bytes)} />
              <Stat label="Threads" value={proc.num_threads} />
              <Stat label="Open files" value={proc.open_files} />
              <Stat label="System memory" value={sys.mem_percent != null ? `${sys.mem_percent.toFixed(0)}%` : "—"} />
            </div>
          ) : (
            // Never zeros: an unavailable metric says so, because 0% CPU and
            // "no data" look identical otherwise.
            <p className={styles.muted}>
              Process metrics unavailable — {proc.reason || "unknown reason"}.
            </p>
          )}

          {proc.available && sys.per_cpu?.length > 0 && (
            <div className={styles.cpus}>
              <span className={styles.statLabel}>CPU {sys.cpu_percent?.toFixed(0)}%</span>
              <div className={styles.cpuGrid}>
                {sys.per_cpu.map((v, i) => (
                  <Meter key={i} value={v} label={`core ${i}`} />
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ---- what it's doing this second, and what is waiting its turn ---- */}
      <section className={styles.panel}>
        <div className={styles.head}>
          <span className="caption">Right now</span>
          <span className={styles.headRight}>
            {scheduledCount} scheduled · one refresh thread
          </span>
        </div>
        <div className={styles.body}>
          {running.length === 0 && queued.length === 0 ? (
            <p className={styles.muted}>Idle — nothing fetching, nothing waiting.</p>
          ) : (
            <ul className={styles.running}>
              {running.map(([name, secs]) => (
                <li key={`run:${name}`} className={styles.runningItem}>
                  <span className={styles.pulse} />
                  <span className={styles.runName}>{name}</span>
                  <span className={styles.runFor}>fetching for {secs.toFixed(1)}s</span>
                </li>
              ))}
              {queued.map((q) => (
                <li key={q.id} className={styles.runningItem}>
                  <span className={styles.waitDot} />
                  <span className={styles.runName}>{q.source}</span>
                  <span className={styles.runFor}>
                    queued ({q.trigger}) · waiting {Math.round(q.waiting_seconds)}s — runs late, not dropped
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.jobs}>
            {otherJobs.map((j) => (
              <span key={j.id} className={styles.job}>
                <span className={styles.jobId}>{j.id}</span>
                <span className={styles.jobNext}>
                  {j.next_run_at ? `next ${formatUntil(j.next_run_at)}` : "not scheduled"}
                </span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ---- per-source health; a click opens the drawer with the full story ---- */}
      <section className={styles.panel}>
        <div className={styles.head}>
          <span className="caption">Sources</span>
          <span className={styles.headRight} data-tone={failing.length ? "neg" : deferred.length ? "caution" : "pos"}>
            {failing.length ? `${failing.length} failing` : "none failing"}
            {deferred.length ? ` · ${deferred.length} deferred` : ""}
          </span>
        </div>
        <DataTable
          columns={sourceColumns}
          rows={sources}
          rowKey={(s) => s.source}
          rowProps={(s) => {
            const state = stateOf(s);
            const clickable = state === "error" || state === "deferred";
            return {
              "data-state": state,
              "data-clickable": clickable ? "yes" : "no",
              // A row isn't focusable; hand focus to its status button so
              // closing the drawer returns there, not to <body>.
              onClick: clickable ? (e) => {
                e.currentTarget.querySelector("button")?.focus();
                openDrawer(s.source);
              } : undefined,
            };
          }}
          classes={classes}
        />
      </section>

      <SchedulerSection schedules={schedules} setSchedules={setSchedules} />

      <section className={styles.panel}>
        <div className={styles.head}><span className="caption">Audit log integrity</span></div>
        <AuditChainCheck />
      </section>

      {/* ---- the timeline: every run, deferral and job event ---- */}
      <section className={styles.panel}>
        <div className={styles.head}>
          <span className="caption">Recent activity</span>
          <span className={styles.headRight}>
            <AnimatePresence initial={false} mode="popLayout">
              {filter ? (
                <motion.span
                  key={`${filter.kind}:${filter.id}`}
                  className={styles.filterChip}
                  initial={reduced ? false : { opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
                  transition={{ duration: reduced ? 0 : 0.16 }}
                >
                  {filter.kind} · {filter.id}
                  <Tooltip content="Clear filter — show all activity">
                    <button
                      type="button"
                      className={styles.chipX}
                      onClick={() => applyFilter(null)}
                      aria-label="Clear filter: show all activity"
                    >
                      ×
                    </button>
                  </Tooltip>
                </motion.span>
              ) : (
                <motion.span key="all" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  source runs &amp; scheduler jobs
                </motion.span>
              )}
            </AnimatePresence>
          </span>
        </div>
        <DataTable
          columns={eventColumns}
          rows={events}
          rowKey={(e) => e.key}
          rowLabel={(e) => `${e.kind} ${e.id}`}
          empty={(
            <p className={styles.muted}>
              {filter ? `Nothing recorded for ${filter.kind} ${filter.id}.` : "Nothing recorded yet."}
            </p>
          )}
          classes={classes}
        />
      </section>

      <SourceDrawer source={drawerRow} onClose={closeDrawer} />
    </div>
  );
}
