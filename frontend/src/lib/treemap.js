// Squarified treemap (Bruls, Huizing & van Wijk): tiles with areas proportional
// to their weights, laid out in rows that keep each tile as close to square as
// it can. Pure, so it is unit-testable without a browser.

const MIN_FLOOR_PASSES = 4;

function worst(row, side) {
  // The most elongated tile if `row` (areas) is laid along a side of length `side`.
  const sum = row.reduce((a, b) => a + b, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  const s2 = side * side;
  return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min));
}

function layoutRow(row, rect, out) {
  const sum = row.reduce((a, b) => a + b.area, 0);
  const horizontal = rect.w >= rect.h; // lay the row down the shorter side
  const thickness = horizontal ? sum / rect.h : sum / rect.w;
  let offset = 0;
  for (const tile of row) {
    const length = tile.area / thickness;
    out.push(horizontal
      ? { key: tile.key, x: rect.x, y: rect.y + offset, w: thickness, h: length }
      : { key: tile.key, x: rect.x + offset, y: rect.y, w: length, h: thickness });
    offset += length;
  }
  return horizontal
    ? { x: rect.x + thickness, y: rect.y, w: rect.w - thickness, h: rect.h }
    : { x: rect.x, y: rect.y + thickness, w: rect.w, h: rect.h - thickness };
}

/**
 * Weights raised so that no tile's share of `area` is below `minArea`, taking
 * the space from the larger ones. A position worth a rounding error still gets
 * a tile big enough to tap and to read.
 */
export function floorWeights(weights, area, minArea) {
  const n = weights.length;
  if (!n) return [];
  if (minArea * n >= area) return weights.map(() => 1);
  let w = weights.map((v) => Math.max(0, v || 0));
  const minShare = minArea / area;
  for (let pass = 0; pass < MIN_FLOOR_PASSES; pass++) {
    const total = w.reduce((a, b) => a + b, 0) || 1;
    const small = w.map((v) => v / total < minShare);
    const smallCount = small.filter(Boolean).length;
    if (!smallCount) break;
    const bigTotal = w.reduce((a, v, i) => (small[i] ? a : a + v), 0);
    const bigShare = 1 - smallCount * minShare;
    w = w.map((v, i) => (small[i] ? minShare : bigTotal > 0 ? (v / bigTotal) * bigShare : minShare));
  }
  return w;
}

/**
 * Lay `items` ({ key, weight }) into a `width` x `height` box. Returns
 * [{ key, x, y, w, h }] in the order given; heaviest first reads best.
 */
export function squarify(items, width, height) {
  const total = items.reduce((a, b) => a + b.weight, 0);
  if (!items.length || total <= 0 || width <= 0 || height <= 0) return [];
  const scale = (width * height) / total;
  const tiles = items.map((it) => ({ key: it.key, area: it.weight * scale }));
  const out = [];
  let rect = { x: 0, y: 0, w: width, h: height };
  let row = [];
  for (const tile of tiles) {
    const side = Math.min(rect.w, rect.h);
    const areas = row.map((t) => t.area);
    if (!row.length || worst([...areas, tile.area], side) <= worst(areas, side)) {
      row.push(tile);
    } else {
      rect = layoutRow(row, rect, out);
      row = [tile];
    }
  }
  if (row.length) layoutRow(row, rect, out);
  const order = new Map(items.map((it, i) => [it.key, i]));
  return out.sort((a, b) => order.get(a.key) - order.get(b.key));
}
