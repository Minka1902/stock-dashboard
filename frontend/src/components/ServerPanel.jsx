import { useEffect, useRef } from "react";
import { animate } from "animejs";
import Icon from "./Icon";
import Skeleton from "./Skeleton";
import { useServerStatus } from "../hooks/useServerStatus";
import { formatRelativeTime, formatUntil } from "../lib/format";
import { prefersReducedMotion } from "../lib/motionConfig";
import styles from "./ServerPanel.module.css";

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
  return (
    <span className={styles.meter} title={`${label}: ${value == null ? "—" : `${value.toFixed(0)}%`}`}>
      <span ref={ref} className={styles.meterFill} data-hot={(value ?? 0) > 85 ? "yes" : "no"} />
    </span>
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
  const { overview, sources, events, error, loading, refresh } = useServerStatus(true);

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
  const failing = sources.filter((s) => String(s.status).startsWith("error"));
  const running = Object.entries(overview.running_sources || {});

  return (
    <div className={styles.wrap}>
      {/* ---- what the process is right now ---- */}
      <section className={styles.panel}>
        <div className={styles.head}>
          <span className="caption">Process</span>
          <span className={styles.headRight}>
            v{overview.version} · python {overview.python}
            <button type="button" className={styles.refresh} onClick={refresh} title="Refresh now">
              <Icon name="refresh" size={12} />
            </button>
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

      {/* ---- what it's doing this second ---- */}
      <section className={styles.panel}>
        <div className={styles.head}>
          <span className="caption">Right now</span>
          <span className={styles.headRight}>
            refresh every {overview.refresh_interval_seconds}s
          </span>
        </div>
        <div className={styles.body}>
          {running.length === 0 ? (
            <p className={styles.muted}>Idle — no source is fetching.</p>
          ) : (
            <ul className={styles.running}>
              {running.map(([name, secs]) => (
                <li key={name} className={styles.runningItem}>
                  <span className={styles.pulse} />
                  <span className={styles.runName}>{name}</span>
                  <span className={styles.runFor}>fetching for {secs.toFixed(1)}s</span>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.jobs}>
            {(overview.scheduler?.jobs || []).map((j) => (
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

      {/* ---- per-source health: this replaces hunting through the Info page ---- */}
      <section className={styles.panel}>
        <div className={styles.head}>
          <span className="caption">Sources</span>
          <span className={styles.headRight} data-tone={failing.length ? "neg" : "pos"}>
            {failing.length ? `${failing.length} failing` : "all ok"}
          </span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Source</th><th>Status</th><th>Last success</th><th>Last try</th>
                <th className={styles.num}>Last</th><th className={styles.num}>Avg</th>
                <th className={styles.num}>ok/err/skip</th><th>Next eligible</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const failed = String(s.status).startsWith("error");
                return (
                  <tr key={s.source} data-failed={failed ? "yes" : "no"}>
                    <td className={styles.srcName}>
                      {s.running_for_seconds != null && <span className={styles.pulse} />}
                      {s.source}
                    </td>
                    <td className={styles.status} title={s.error_detail || s.status}>
                      <span data-tone={failed ? "neg" : "pos"}>{s.status}</span>
                    </td>
                    <td>{s.last_success_at ? formatRelativeTime(s.last_success_at) : <em className={styles.never}>never</em>}</td>
                    <td>{s.last_refreshed_at ? formatRelativeTime(s.last_refreshed_at) : "—"}</td>
                    <td className={styles.num}>{ms(s.last_duration_ms)}</td>
                    <td className={styles.num}>{ms(s.avg_duration_ms)}</td>
                    <td className={styles.num}>
                      {(s.runs_ok ?? 0)}/{(s.runs_error ?? 0)}/{(s.runs_skipped ?? 0)}
                    </td>
                    <td>
                      {s.eligible_now
                        ? <span data-tone="pos">now</span>
                        : (s.next_eligible_at ? formatUntil(s.next_eligible_at) : "—")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- errors and tracebacks live here now ---- */}
      {failing.length > 0 && (
        <section className={styles.panel}>
          <div className={styles.head}><span className="caption">Errors</span></div>
          <div className={styles.body}>
            {failing.map((s) => (
              <details key={s.source} className={styles.errBlock}>
                <summary>
                  <span className={styles.errName}>{s.source}</span>
                  <span className={styles.errMsg}>{s.status}</span>
                </summary>
                <pre className={styles.trace}>{s.error_detail || "No traceback recorded."}</pre>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* ---- the timeline, including the skips that used to be invisible ---- */}
      <section className={styles.panel}>
        <div className={styles.head}>
          <span className="caption">Recent activity</span>
          <span className={styles.headRight}>source runs &amp; scheduler jobs</span>
        </div>
        <div className={styles.tableWrap}>
          {events.length === 0 ? (
            <p className={styles.muted}>Nothing recorded yet.</p>
          ) : (
            <table className={styles.table}>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i}>
                    <td className={styles.evKind} data-kind={e.kind}>{e.kind}</td>
                    <td className={styles.srcName}>{e.id}</td>
                    <td><span className={styles.outcome} data-outcome={e.outcome}>{e.outcome}</span></td>
                    <td className={styles.num}>{ms(e.duration_ms)}</td>
                    <td className={styles.num}>{e.record_count ?? ""}</td>
                    <td className={styles.evDetail} title={e.detail || ""}>{e.detail || ""}</td>
                    <td className={styles.evTime}>{formatRelativeTime(e.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
