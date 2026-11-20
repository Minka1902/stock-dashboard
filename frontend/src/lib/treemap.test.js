import assert from "node:assert/strict";
import { test } from "node:test";
import { floorWeights, squarify } from "./treemap.js";

const area = (tiles) => tiles.reduce((a, t) => a + t.w * t.h, 0);
const inside = (t, w, h) => t.x >= -1e-9 && t.y >= -1e-9 && t.x + t.w <= w + 1e-9 && t.y + t.h <= h + 1e-9;

test("tiles fill the box exactly, each inside it, in the order given", () => {
  const items = [60, 30, 20, 8, 1].map((weight, i) => ({ key: `k${i}`, weight }));
  const tiles = squarify(items, 360, 400);
  assert.equal(tiles.length, 5);
  assert.ok(Math.abs(area(tiles) - 360 * 400) < 1e-6);
  assert.ok(tiles.every((t) => inside(t, 360, 400)));
  assert.deepEqual(tiles.map((t) => t.key), items.map((i) => i.key));
});

test("each tile's area follows its weight", () => {
  const tiles = squarify([{ key: "a", weight: 3 }, { key: "b", weight: 1 }], 400, 100);
  const [a, b] = tiles.map((t) => t.w * t.h);
  assert.ok(Math.abs(a / b - 3) < 1e-9);
});

test("equal weights come out close to square", () => {
  const tiles = squarify(Array.from({ length: 12 }, (_, i) => ({ key: i, weight: 1 })), 360, 420);
  const aspect = Math.max(...tiles.map((t) => Math.max(t.w / t.h, t.h / t.w)));
  assert.ok(aspect < 2.5, `worst aspect ${aspect}`);
});

test("nothing to lay out gives no tiles", () => {
  assert.deepEqual(squarify([], 100, 100), []);
  assert.deepEqual(squarify([{ key: "a", weight: 0 }], 100, 100), []);
  assert.deepEqual(squarify([{ key: "a", weight: 1 }], 0, 100), []);
});

test("a tiny position still gets a tile it can be tapped on", () => {
  const weights = floorWeights([1000, 500, 1, 0], 360 * 400, 72 * 72);
  const tiles = squarify(weights.map((weight, i) => ({ key: i, weight })), 360, 400);
  assert.ok(tiles.every((t) => t.w * t.h >= 72 * 72 - 1e-6));
  assert.ok(Math.min(...tiles.map((t) => Math.min(t.w, t.h))) >= 40);
  assert.ok(tiles[0].w * tiles[0].h > tiles[1].w * tiles[1].h, "the order of size is kept");
});

test("when the floor can't fit, every tile weighs the same", () => {
  assert.deepEqual(floorWeights([5, 1], 100, 60), [1, 1]);
});
