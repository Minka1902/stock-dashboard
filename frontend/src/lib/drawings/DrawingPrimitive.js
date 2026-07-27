/**
 * A lightweight-charts v5 series primitive that renders user-drawn annotations.
 *
 * Shapes are anchored to (time, price) rather than pixels, so they stay pinned
 * to the data through pan, zoom and timeframe changes. Times snap to bar times,
 * which is both stable across data refreshes and what you want for a trendline.
 *
 * Shape shape:
 *   { id, kind: "trendline"|"ray"|"zone"|"text", points: [{time, price}], text? }
 */

const ACCENT = "#f0b429";
const SELECTED = "#57a5e0";
const ZONE_FILL = "rgba(240, 180, 41, 0.12)";
const HANDLE_R = 4;
export const HIT_TOLERANCE = 7; // px — generous enough for a trackpad

/** Distance from point p to segment ab, in pixels. */
function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export class DrawingPrimitive {
  constructor() {
    this._shapes = [];
    this._selectedId = null;
    this._draft = null;      // in-progress shape while drawing
    this._series = null;
    this._chart = null;
    this._requestUpdate = null;
    // IPrimitivePaneView: `renderer` and `zOrder` are methods, not properties.
    // The array identity is kept stable — the library caches on it.
    const renderer = { draw: (target) => this._draw(target) };
    this._paneViews = [{
      renderer: () => renderer,
      zOrder: () => "top",
    }];
  }

  // --- ISeriesPrimitive ---
  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
    this._dead = false;
  }

  detached() {
    // Everything below bails on this flag. ChartPro rebuilds its series on any
    // pref change, and lightweight-charts throws "Object is disposed" the
    // moment a removed chart or series is touched — including from a render
    // pass still in flight when the teardown happens.
    this._dead = true;
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  paneViews() { return this._paneViews; }

  updateAllViews() { /* geometry is derived at draw time */ }

  // --- state ---
  setShapes(shapes) { this._shapes = shapes || []; this.redraw(); }
  setSelected(id) { this._selectedId = id; this.redraw(); }
  setDraft(shape) { this._draft = shape; this.redraw(); }
  redraw() {
    if (this._dead) return;
    try { this._requestUpdate?.(); } catch { this._dead = true; }
  }

  /** Called by the host when it tears down a series we may still be bound to. */
  kill() { this._dead = true; }

  /** (time, price) -> screen px. Null when off-data, or after disposal. */
  toScreen(pt) {
    if (this._dead || !this._chart || !this._series) return null;
    try {
      const x = this._chart.timeScale().timeToCoordinate(pt.time);
      const y = this._series.priceToCoordinate(pt.price);
      if (x == null || y == null) return null;
      return { x, y };
    } catch {
      return null; // chart or series disposed mid-flight
    }
  }

  /**
   * The shape whose outline is within tolerance of (x, y), topmost first, plus
   * which endpoint was hit (for dragging).
   */
  hitTest(x, y) {
    if (this._dead) return null;
    const p = { x, y };
    for (let i = this._shapes.length - 1; i >= 0; i -= 1) {
      const shape = this._shapes[i];
      const pts = shape.points.map((pt) => this.toScreen(pt));
      if (pts.some((q) => q == null)) continue;

      // an endpoint takes precedence, so dragging a handle reshapes
      for (let h = 0; h < pts.length; h += 1) {
        if (Math.hypot(p.x - pts[h].x, p.y - pts[h].y) <= HIT_TOLERANCE + 2) {
          return { shape, handle: h };
        }
      }

      if (shape.kind === "trendline" && pts.length === 2) {
        if (distToSegment(p, pts[0], pts[1]) <= HIT_TOLERANCE) return { shape, handle: null };
      } else if (shape.kind === "ray") {
        if (Math.abs(p.y - pts[0].y) <= HIT_TOLERANCE && p.x >= pts[0].x - HIT_TOLERANCE) {
          return { shape, handle: null };
        }
      } else if (shape.kind === "zone" && pts.length === 2) {
        const [x1, x2] = [Math.min(pts[0].x, pts[1].x), Math.max(pts[0].x, pts[1].x)];
        const [y1, y2] = [Math.min(pts[0].y, pts[1].y), Math.max(pts[0].y, pts[1].y)];
        if (p.x >= x1 - HIT_TOLERANCE && p.x <= x2 + HIT_TOLERANCE
          && p.y >= y1 - HIT_TOLERANCE && p.y <= y2 + HIT_TOLERANCE) {
          return { shape, handle: null };
        }
      } else if (shape.kind === "text") {
        if (Math.abs(p.x - pts[0].x) <= 90 && Math.abs(p.y - pts[0].y) <= 12) {
          return { shape, handle: null };
        }
      }
    }
    return null;
  }

  // --- rendering ---
  _draw(target) {
    if (this._dead) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const all = this._draft ? [...this._shapes, this._draft] : this._shapes;
      for (const shape of all) {
        const pts = shape.points.map((pt) => this.toScreen(pt));
        if (!pts.length || pts.some((p) => p == null)) continue;
        const selected = shape.id === this._selectedId;
        const color = shape.color || ACCENT;
        const stroke = selected ? SELECTED : color;

        ctx.save();
        ctx.lineWidth = selected ? 2.5 : 1.8;
        ctx.strokeStyle = stroke;
        ctx.fillStyle = stroke;
        ctx.setLineDash(shape === this._draft ? [4, 4] : []);

        if (shape.kind === "trendline" && pts.length === 2) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[1].x, pts[1].y);
          ctx.stroke();
        } else if (shape.kind === "ray") {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(mediaSize.width, pts[0].y);
          ctx.stroke();
          // price tag so the level is readable without the crosshair
          const label = shape.points[0].price.toFixed(2);
          ctx.font = "11px ui-monospace, monospace";
          const w = ctx.measureText(label).width + 10;
          ctx.globalAlpha = 0.9;
          ctx.fillRect(pts[0].x, pts[0].y - 8, w, 16);
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#10131a";
          ctx.fillText(label, pts[0].x + 5, pts[0].y + 3.5);
        } else if (shape.kind === "zone" && pts.length === 2) {
          const x = Math.min(pts[0].x, pts[1].x);
          const y = Math.min(pts[0].y, pts[1].y);
          const w = Math.abs(pts[1].x - pts[0].x);
          const h = Math.abs(pts[1].y - pts[0].y);
          ctx.fillStyle = shape.fill || ZONE_FILL;
          ctx.fillRect(x, y, w, h);
          ctx.strokeRect(x, y, w, h);
        } else if (shape.kind === "text") {
          ctx.font = "600 12px ui-monospace, monospace";
          ctx.fillText(shape.text || "", pts[0].x + 6, pts[0].y - 4);
          ctx.beginPath();
          ctx.arc(pts[0].x, pts[0].y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // endpoint handles, only while selected
        if (selected && shape.kind !== "text") {
          ctx.setLineDash([]);
          ctx.fillStyle = SELECTED;
          for (const q of pts) {
            ctx.beginPath();
            ctx.arc(q.x, q.y, HANDLE_R, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    });
  }
}
