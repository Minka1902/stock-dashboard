import { readJson, writeJson } from "./files.mjs";
import { flatten, fold } from "./report.mjs";

// Known violations, per view: { gate, element, widths, count, px, sample,
// reason }. A violation is known when its view, gate, element and width match
// an entry; anything else fails the run. `--baseline-known` rewrites the
// entries of the views and widths it visited, keeping each surviving entry's
// reason, so fixed items drop out and later phases only fail on new ones.
const EMPTY = { views: {} };

const keyOf = (v) => `${v.gate} ${v.element}`;

export function loadAllowlist(path) {
  const data = readJson(path, EMPTY);
  const index = new Map(Object.entries(data.views).map(([view, entries]) =>
    [view, new Map(entries.map((e) => [keyOf(e), e]))]));
  return {
    data,
    isKnown: (view, violation, width) => Boolean(index.get(view)?.get(keyOf(violation))?.widths.includes(width)),
    entry: (view, violation) => index.get(view)?.get(keyOf(violation)),
  };
}

/** Per view, one entry per (gate, element): widths, occurrences, worst px and a sample. */
function groupByView(results) {
  const views = {};
  for (const g of fold(flatten(results))) {
    const entry = { ...g };
    delete entry.view;
    delete entry.width;
    (views[g.view] ||= []).push(entry);
  }
  return views;
}

/** Entries for visited views/widths that no longer occur: fixed, or renamed. */
export function staleEntries(allow, results) {
  const seen = new Set(results.flatMap((r) => r.violations.map((v) => `${r.view} ${r.width} ${keyOf(v)}`)));
  const visited = new Set(results.map((r) => `${r.view} ${r.width}`));
  return Object.entries(allow.data.views).flatMap(([view, entries]) => entries.flatMap((e) =>
    e.widths.filter((w) => visited.has(`${view} ${w}`) && !seen.has(`${view} ${w} ${keyOf(e)}`))
      .map((width) => ({ view, width, gate: e.gate, element: e.element }))));
}

export function writeKnownBaseline(path, allow, results, summary, reason) {
  const grouped = groupByView(results);
  const visited = new Map();
  for (const r of results) visited.set(r.view, [...(visited.get(r.view) || []), r.width]);
  const views = { ...allow.data.views };
  for (const [view, widths] of visited) {
    const current = (grouped[view] || []).map((g) => {
      const old = allow.entry(view, g);
      const kept = (old?.widths || []).filter((w) => !widths.includes(w));
      return { ...g, widths: [...new Set([...kept, ...g.widths])].sort(), reason: old?.reason || reason };
    });
    const leftovers = (allow.data.views[view] || [])
      .filter((e) => !current.some((c) => keyOf(c) === keyOf(e)))
      .map((e) => ({ ...e, widths: e.widths.filter((w) => !widths.includes(w)) }))
      .filter((e) => e.widths.length);
    const entries = [...current, ...leftovers].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
    if (entries.length) views[view] = entries;
    else delete views[view];
  }
  writeJson(path, { summary, views });
}
