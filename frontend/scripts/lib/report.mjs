// Console summary for the phone pass: a count table per gate and width, the
// worst offenders, and every violation that is not in the allowlist. Repeats
// (one per watchlist row, one per width) are folded into one line with a count.
export const GATES = ["overflow", "clip", "hit", "first", "error"];
const WORST = 10;
const MAX_NEW_LINES = 60;

const UNIT = {
  overflow: (v) => `${v.px}px past the edge`,
  clip: (v) => `${v.px}px clipped by ${v.by}`,
  hit: (v) => `${v.size} (${v.px}px short)`,
  first: (v) => (v.px ? `${v.px}px below the first screen` : "not on the page"),
  error: () => "",
};

function pad(value, width) {
  return String(value).padEnd(width);
}

/** One entry per (view, gate, element): widths, occurrences and the worst case. */
export function fold(violations) {
  const groups = new Map();
  for (const v of violations) {
    const key = `${v.view} ${v.gate} ${v.element}`;
    const g = groups.get(key) || { ...v, widths: [], count: 0 };
    if (!g.widths.includes(v.width)) g.widths.push(v.width);
    g.count += 1;
    groups.set(key, v.px > g.px ? { ...v, widths: g.widths, count: g.count } : g);
  }
  return [...groups.values()];
}

function describe(g) {
  const sample = g.sample ? ` "${g.sample}"` : "";
  const times = g.count > 1 ? `  x${g.count}` : "";
  return `${pad(g.gate, 9)}${pad(`${g.view} @${g.widths.sort().join("/")}`, 34)}`
    + `${g.element}${sample}  ${UNIT[g.gate](g)}${times}`;
}

/** Page errors and a blank #root become violations of the `error` gate. */
export function errorViolations({ errors, blank }) {
  return [
    ...errors.map((message) => ({ gate: "error", element: `pageerror: ${message.replace(/\d+/g, "#").slice(0, 120)}`, sample: "", px: 0 })),
    ...(blank ? [{ gate: "error", element: "#root is blank", sample: "", px: 0 }] : []),
  ];
}

export function flatten(results, keep = () => true) {
  return results.flatMap((r) => r.violations.filter((v) => keep(r, v))
    .map((v) => ({ ...v, view: r.view, width: r.width })));
}

/** Occurrences per gate and width, new ones per gate, and page height in screens per view. */
export function countSummary(results, isNew) {
  const widths = [...new Set(results.map((r) => r.width))].sort();
  const gates = Object.fromEntries(GATES.map((g) => [g, Object.fromEntries(widths.map((w) => [w, 0]))]));
  const fresh = Object.fromEntries(GATES.map((g) => [g, 0]));
  const screens = {};
  for (const r of results) {
    (screens[r.view] ||= {})[r.width] = r.screens;
    for (const v of r.violations) {
      gates[v.gate][r.width] += 1;
      if (isNew(r, v)) fresh[v.gate] += 1;
    }
  }
  return { gates, new: fresh, screens };
}

export function worstOffenders(results) {
  return fold(flatten(results, (r, v) => v.gate !== "error"))
    .sort((a, b) => b.px - a.px)
    .slice(0, WORST);
}

export function printSummary({ summary, worst, fresh, stale, header }) {
  const widths = Object.keys(summary.gates[GATES[0]]);
  console.log(`\n${header}\n`);
  console.log(`${pad("gate", 10)}${widths.map((w) => pad(w, 8)).join("")}new`);
  for (const gate of GATES) {
    console.log(`${pad(gate, 10)}${widths.map((w) => pad(summary.gates[gate][w], 8)).join("")}${summary.new[gate]}`);
  }
  if (worst.length) {
    console.log("\nWorst offenders:");
    for (const g of worst) console.log(`  ${describe(g)}`);
  }
  if (stale.length) {
    console.log(`\n${stale.length} allowlist entries no longer occur (fixed?); --baseline-known prunes them.`);
  }
  const groups = fold(fresh);
  if (groups.length) {
    console.log(`\nNEW violations (${fresh.length} in ${groups.length} groups), not in the allowlist:`);
    for (const g of groups.slice(0, MAX_NEW_LINES)) console.log(`  ${describe(g)}`);
    if (groups.length > MAX_NEW_LINES) console.log(`  ...and ${groups.length - MAX_NEW_LINES} more groups in the report`);
  }
}
