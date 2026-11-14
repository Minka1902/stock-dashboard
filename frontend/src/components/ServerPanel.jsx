import { useCallback, useEffect, useRef, useState } from "react";
import { animate } from "animejs";
import { AnimatePresence, motion } from "motion/react";
import AuditChainCheck from "./AuditChainCheck";
import DataTable from "./DataTable";
import Icon from "./Icon";
import { MenuItem } from "./MenuButton";
import PhoneFold from "./PhoneFold";
import SectionIndex from "./SectionIndex";
import ShowAll from "./ShowAll";
import Skeleton from "./Skeleton";
import SchedulerSection from "./SchedulerSection";
import SourceDrawer from "./SourceDrawer";
import SourceImport from "./SourceImport";
import { runScheduleNow } from "../api";
import { useCollapsedSections } from "../hooks/useCollapsedSections";
import { PHONE, useMediaQuery } from "../hooks/useMediaQuery";
import { usePhoneLimit } from "../hooks/usePhoneLimit";
import { useServerStatus } from "../hooks/useServerStatus";
import { useSourceImport } from "../hooks/useSourceImport";
import { formatRelativeTime, formatUntil } from "../lib/format";
import { prefersReducedMotion } from "../lib/motionConfig";
import { scrollToSection } from "../lib/sections";
import { SOURCE_META, STATE_TIP, sourceState } from "../lib/sources";
import Tooltip from "./Tooltip";
import styles from "./ServerPanel.module.css";
import Term from "./Term";

const TONE = { ok: "pos", error: "neg", deferred: "caution", never: "faint" };
// On a phone every section folds (the process health stays open) under an
// index; the activity log shows its newest rows until asked.
const SECTIONS = [
  { id: "process", label: "Process" },
  { id: "now", label: "Right now" },
  { id: "sources", label: "Sources" },
  { id: "scheduler", label: "Scheduler" },
  { id: "audit", label: "Audit" },
  { id: "activity", label: "Activity" },
];
const OPEN_ON_PHONE = ["process"];
const PHONE_EVENTS = 15;

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

/** A section's desktop pane: its caption, the `right` side of its header, then the body. */
function panelFrame(caption, right, tone) {
  return (body) => (
    <section className={styles.panel}>
      <div className={styles.head}>
        <span className="caption">{caption}</span>
        {right && <span className={styles.headRight} data-tone={tone}>{right}</span>}
      </div>
      {body}
    </section>
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
  const phone = useMediaQuery(PHONE);
  const sections = useCollapsedSections("server:", OPEN_ON_PHONE);
  const [filter, setFilter] = useState(readFilter);
  const [drawerName, setDrawerName] = useState(null);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState(null);
  const {
    overview, sources, events, schedules, setSchedules, error, loading, refresh,
  } = useServerStatus(true, filter?.kind ?? null, filter?.id ?? null);
  const importer = useSourceImport(refresh);
  const { limit, showAll } = usePhoneLimit(events.length, PHONE_EVENTS);

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
  const importNote = importer.source && (importer.busy ? `${importer.source}: importing…`
    : importer.error ? `${importer.source}: ${importer.error}` : `${importer.source}: ${importer.result}`);

  const showSimilar = (next) => {
    applyFilter(next);
    sections.setCollapsed(["activity"], false);
    requestAnimationFrame(() => scrollToSection("activity"));
  };
  const runNow = async (name) => {
    setNotice(`${name}: queuing…`);
    try {
      await runScheduleNow(name);
      setNotice(`${name}: queued on the refresh thread — runs late, not dropped`);
    } catch (e) {
      setNotice(`${name}: ${e.message || "run failed"}`);
    }
  };

  // A phone's row menus: what the desktop does from a row's own buttons.
  const sourceActions = (s, close) => {
    const sched = s.schedule?.source;
    const meta = SOURCE_META[s.source];
    const act = (fn) => () => { close(); fn(); };
    return (
      <>
        <MenuItem onSelect={act(() => openDrawer(s.source))}>Details</MenuItem>
        {sched && <MenuItem onSelect={act(() => runNow(sched))}>Run now</MenuItem>}
        {sched && <MenuItem onSelect={act(() => setEditing(sched))}>Edit schedule</MenuItem>}
        {s.importable && <MenuItem onSelect={act(() => importer.pick(s.source))}>Import file…</MenuItem>}
        {s.importable && meta?.url && (
          <MenuItem onSelect={act(() => window.open(meta.url, "_blank", "noreferrer"))}>{meta.provider} page ↗</MenuItem>
        )}
        <MenuItem onSelect={act(() => showSimilar({ kind: "source", id: s.source }))}>Show similar</MenuItem>
      </>
    );
  };
  const eventActions = (e, close) => {
    const current = filter && filter.kind === e.kind && filter.id === e.id;
    return (
      <>
        {e.kind === "source" && sourceNames.has(e.id) && (
          <MenuItem onSelect={() => { close(); openDrawer(e.id); }}>Details</MenuItem>
        )}
        {current
          ? <MenuItem onSelect={() => { close(); applyFilter(null); }}>Show all activity</MenuItem>
          : <MenuItem onSelect={() => { close(); applyFilter({ kind: e.kind, id: e.id }); }}>Show similar</MenuItem>}
      </>
    );
  };

  const sourceColumns = [
    { key: "source", label: "Source", cellClassName: styles.srcName, phone: "title",
      render: (s) => (
        <>
          {s.running_for_seconds != null && <span className={styles.pulse} />}
          {s.source}
          {s.importable && !phone && <SourceImport source={s.source} onImported={refresh} />}
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
      phone: "actions",
      render: (e) => !(filter && filter.kind === e.kind && filter.id === e.id) && (
        <Tooltip content={`Show only ${e.kind} ${e.id}`}>
          <button type="button" className={styles.similar} onClick={() => applyFilter({ kind: e.kind, id: e.id })}>
            Show similar
          </button>
        </Tooltip>
      ) },
  ];

  const processRight = (
    <>
      v{overview.version} · python {overview.python}
      <Tooltip content="Refresh now">
        <button type="button" className={styles.refresh} onClick={refresh} aria-label="Refresh now">
          <Icon name="refresh" size={12} />
        </button>
      </Tooltip>
    </>
  );
  const nowRight = <>{scheduledCount} scheduled · one refresh thread</>;
  const sourcesTone = failing.length ? "neg" : deferred.length ? "caution" : "pos";
  const sourcesRight = (
    <>
      {failing.length ? `${failing.length} failing` : "none failing"}
      {deferred.length ? ` · ${deferred.length} deferred` : ""}
    </>
  );
  const activityRight = (
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
  );
  const phoneRight = (right, tone) => <span className={styles.headRight} data-tone={tone}>{right}</span>;

  return (
    <div className={styles.wrap}>
      <SectionIndex sections={SECTIONS} onJump={(id) => sections.setCollapsed([id], false)} />

      {/* ---- what the process is right now ---- */}
      <PhoneFold id="process" caption="Process" right={phoneRight(processRight)} sections={sections}
                 frame={panelFrame("Process", processRight)}>
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
      </PhoneFold>

      {/* ---- what it's doing this second, and what is waiting its turn ---- */}
      <PhoneFold id="now" caption="Right now" right={phoneRight(nowRight)} sections={sections}
                 frame={panelFrame("Right now", nowRight)}>
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
      </PhoneFold>

      {/* ---- per-source health; a click opens the drawer with the full story ---- */}
      <PhoneFold id="sources" caption="Sources" right={phoneRight(sourcesRight, sourcesTone)} sections={sections}
                 frame={panelFrame("Sources", sourcesRight, sourcesTone)}>
        {phone && <input {...importer.inputProps} />}
        {phone && (notice || importNote) && (
          <p className={styles.notice} role="status">{importNote || notice}</p>
        )}
        <DataTable
          columns={sourceColumns}
          rows={sources}
          rowKey={(s) => s.source}
          rowActions={phone ? sourceActions : undefined}
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
      </PhoneFold>

      <SchedulerSection schedules={schedules} setSchedules={setSchedules} sections={sections}
                        editing={editing} onEdit={setEditing} />

      <PhoneFold id="audit" caption="Audit log integrity" sections={sections}
                 frame={panelFrame("Audit log integrity")}>
        <AuditChainCheck />
      </PhoneFold>

      {/* ---- the timeline: every run, deferral and job event ---- */}
      <PhoneFold id="activity" caption="Recent activity" right={phoneRight(activityRight)} sections={sections}
                 frame={panelFrame("Recent activity", activityRight)}>
        <DataTable
          columns={eventColumns}
          rows={events}
          rowKey={(e) => e.key}
          rowLabel={(e) => `${e.kind} ${e.id}`}
          rowActions={phone ? eventActions : undefined}
          limit={limit}
          empty={(
            <p className={styles.muted}>
              {filter ? `Nothing recorded for ${filter.kind} ${filter.id}.` : "Nothing recorded yet."}
            </p>
          )}
          classes={classes}
        />
        {showAll && <ShowAll {...showAll} noun="events" />}
      </PhoneFold>

      <SourceDrawer source={drawerRow} onClose={closeDrawer} />
    </div>
  );
}
