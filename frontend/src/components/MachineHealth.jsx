import Stat from "./Stat";
import { formatBytes, formatRelativeTime } from "../lib/format";
import styles from "./MachineHealth.module.css";

// A Pi's SoC starts soft-throttling at 80 °C and hard-throttles at 85 °C.
const TEMP_WARN_C = 70;
const TEMP_HOT_C = 80;
const DISK_WARN_PCT = 80;
const DISK_FULL_PCT = 90;
const MEM_WARN_PCT = 90;
// The backup job runs nightly; older than this means a night was missed.
const BACKUP_STALE_HOURS = 36;

function percentTone(pct, warn, bad) {
  if (pct == null) return undefined;
  if (bad != null && pct >= bad) return "neg";
  return pct >= warn ? "caution" : undefined;
}

function power(throttled) {
  if (!throttled) return { value: "—", tip: "The firmware's power flags could not be read." };
  if (throttled.ok) return { value: "OK", tone: "pos", tip: `No under-voltage or throttling since boot (${throttled.raw}).` };
  const now = throttled.flags.some((f) => f.endsWith(" now"));
  return {
    value: now ? "problem now" : "problem since boot",
    tone: now ? "neg" : "caution",
    tip: `${throttled.flags.join(" · ")} (${throttled.raw}). Under-voltage means the power supply can't keep up — use the official supply.`,
  };
}

function usage(u) {
  return u ? `${formatBytes(u.used_bytes)} / ${formatBytes(u.total_bytes)}` : "—";
}

function backupStat(backup) {
  if (!backup) return { value: "none yet", tone: "caution", tip: "The nightly db_backup job hasn't written an archive yet." };
  const hours = (Date.now() - new Date(backup.at).getTime()) / 3.6e6;
  return {
    value: formatRelativeTime(backup.at),
    tone: hours > BACKUP_STALE_HOURS ? "caution" : "pos",
    tip: `${formatBytes(backup.size_bytes)} · ${backup.count} kept · ${backup.path}`,
  };
}

/**
 * The machine under the server: memory, disk, the last verified backup and
 * the network on every platform, and on a Raspberry Pi its power and heat.
 * Every value is what the server read, or "—" when it couldn't read it —
 * never a guess.
 */
export default function MachineHealth({ machine, network }) {
  if (!machine) return <p className={styles.muted}>Machine health unavailable.</p>;
  const pi = machine.kind === "pi";
  const temp = machine.cpu_temp_c;
  const pwr = power(machine.throttled);
  const bak = backupStat(machine.backup);

  return (
    <div className={styles.body}>
      <div className={styles.grid}>
        {pi && <Stat label="Power" value={pwr.value} tone={pwr.tone} tip={pwr.tip} />}
        {(pi || temp != null) && (
          <Stat
            label="CPU temp"
            value={temp != null ? `${temp.toFixed(1)} °C` : "—"}
            tone={temp == null ? undefined : temp >= TEMP_HOT_C ? "neg" : temp >= TEMP_WARN_C ? "caution" : "pos"}
          />
        )}
        <Stat label="Memory" value={usage(machine.memory)} tone={percentTone(machine.memory?.percent, MEM_WARN_PCT)} />
        <Stat label="Swap" value={usage(machine.swap)} />
        <Stat
          label="Disk"
          value={usage(machine.disk)}
          tone={percentTone(machine.disk?.percent, DISK_WARN_PCT, DISK_FULL_PCT)}
        />
        <Stat label="Last backup" value={bak.value} tone={bak.tone} tip={bak.tip} />
      </div>
      {network?.online === false && (
        <p className={styles.offline}>
          No connection to {network.hosts.join(" or ")}. Network sources are deferred and the
          minute jobs wait; everything deferred re-runs as soon as the network is back.
        </p>
      )}
    </div>
  );
}
