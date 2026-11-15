// Desktop baseline diff. Rows are [key, fontSize, x, y, width, height]; the key
// is a short selector plus the text with digits masked, numbered when it
// repeats. A whole region shifting (a strip added above it) shows as one
// "moved" line per distinct offset instead of a line per text node.
const TOLERANCE = 0.5;
const LINES_PER_VIEW = 16;

const differs = (a, b) => Math.abs(a - b) > TOLERANCE;
const signed = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n))}`;

function diffView(before, after) {
  const was = new Map(before.map((row) => [row[0], row]));
  const now = new Map(after.map((row) => [row[0], row]));
  const out = { font: [], size: [], moved: new Map(), added: [], removed: [] };
  for (const [key, [, fs, x, y, w, h]] of now) {
    const old = was.get(key);
    if (!old) {
      out.added.push(key);
      continue;
    }
    const [, ofs, ox, oy, ow, oh] = old;
    if (ofs !== fs) out.font.push(`${key}  ${ofs}px → ${fs}px`);
    else if (differs(ow, w) || differs(oh, h)) out.size.push(`${key}  ${ow}×${oh} → ${w}×${h}`);
    else if (differs(ox, x) || differs(oy, y)) {
      const offset = `(${signed(x - ox)}, ${signed(y - oy)})`;
      out.moved.set(offset, [...(out.moved.get(offset) || []), key]);
    }
  }
  for (const key of was.keys()) if (!now.has(key)) out.removed.push(key);
  return out;
}

function changeCount(d) {
  return d.font.length + d.size.length + d.added.length + d.removed.length
    + [...d.moved.values()].reduce((n, keys) => n + keys.length, 0);
}

function viewLines(d) {
  const moved = [...d.moved.entries()].sort((a, b) => b[1].length - a[1].length)
    .map(([offset, keys]) => `moved    ${keys.length} by ${offset}, e.g. ${keys[0]}`);
  return [
    ...d.font.map((l) => `font     ${l}`),
    ...d.size.map((l) => `size     ${l}`),
    ...moved,
    ...d.added.map((l) => `added    ${l}`),
    ...d.removed.map((l) => `removed  ${l}`),
  ];
}

/** `{ changed, text }`: the views that differ, and a readable report. */
export function diffBaseline(baseline, current) {
  const lines = [];
  let changed = 0;
  for (const [view, rows] of Object.entries(current)) {
    const d = diffView(baseline[view] || [], rows);
    const count = changeCount(d);
    if (!count) continue;
    changed += 1;
    const all = viewLines(d);
    lines.push(`  ${view}: ${d.font.length} font-size, ${d.size.length} size, `
      + `${count - d.font.length - d.size.length - d.added.length - d.removed.length} moved, `
      + `${d.added.length} added, ${d.removed.length} removed`);
    lines.push(...all.slice(0, LINES_PER_VIEW).map((l) => `    ${l}`));
    if (all.length > LINES_PER_VIEW) lines.push(`    ...and ${all.length - LINES_PER_VIEW} more`);
  }
  return { changed, text: lines.join("\n") };
}
