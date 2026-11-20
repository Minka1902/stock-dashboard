import { useMemo } from "react";
import { useElementWidth } from "../hooks/useElementWidth";
import { floorWeights, squarify } from "../lib/treemap";
import styles from "./Heatmap.module.css";

// Smallest tile edge we aim for: room for the ticker and its signed number,
// and comfortably over the 40px touch target.
const MIN_TILE = 72;
// Height as a share of the width, and the floor, before tiles need more room.
const ASPECT = 0.5;
const PHONE_ASPECT = 1.1;
const MIN_HEIGHT = 240;
const PHONE_WIDTH = 640;
// Tiles shorter than this show the number beside the label instead of under it.
const TWO_LINE_HEIGHT = 52;

/**
 * A treemap of tiles, sized by `weight` and coloured by `value`.
 *
 * `items`: [{ key, label, weight, value, display, detail? }]. `value` sets the
 * colour (positive green, negative red, deeper the further from zero, full at
 * `domain`); `display` is the text printed on the tile, so the colour is never
 * the only signal. `value: null` is a neutral tile that prints `display` as is
 * ("no quote"), never an invented number. Each tile is a button calling
 * `onOpen(key)`. Tiles come out in the order given (heaviest first reads best).
 */
export default function Heatmap({ items, domain, onOpen, ariaLabel }) {
  const [ref, width] = useElementWidth();

  const height = useMemo(() => {
    if (!width) return MIN_HEIGHT;
    const aspect = width <= PHONE_WIDTH ? PHONE_ASPECT : ASPECT;
    const needed = Math.ceil((items.length * MIN_TILE * MIN_TILE * 1.25) / width);
    return Math.max(MIN_HEIGHT, Math.round(width * aspect), needed);
  }, [width, items.length]);

  const tiles = useMemo(() => {
    if (!width) return [];
    const weights = floorWeights(items.map((i) => i.weight), width * height, MIN_TILE * MIN_TILE);
    const byKey = new Map(items.map((i) => [i.key, i]));
    return squarify(items.map((i, n) => ({ key: i.key, weight: weights[n] })), width, height)
      .map((t) => ({ ...t, item: byKey.get(t.key) }));
  }, [items, width, height]);

  return (
    <div ref={ref} className={styles.map} style={{ height }} role="group" aria-label={ariaLabel}>
      {tiles.map(({ key, x, y, w, h, item }) => {
        const known = item.value != null && Number.isFinite(item.value);
        const heat = known ? Math.min(1, Math.abs(item.value) / domain) : 0;
        return (
          <button
            key={key}
            type="button"
            className={styles.tile}
            data-tone={!known ? "none" : item.value > 0 ? "pos" : item.value < 0 ? "neg" : "flat"}
            data-lines={h >= TWO_LINE_HEIGHT ? "two" : "one"}
            style={{ left: x, top: y, width: w, height: h, "--heat": heat }}
            onClick={() => onOpen(key)}
            aria-label={`${item.label}: ${item.display}${item.detail ? `, ${item.detail}` : ""}`}
            title={item.detail}
          >
            <span className={styles.label}>{item.label}</span>
            <span className={styles.value}>{item.display}</span>
          </button>
        );
      })}
    </div>
  );
}
