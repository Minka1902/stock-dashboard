import { useCallback, useEffect, useRef, useState } from "react";
import { DrawingPrimitive } from "./DrawingPrimitive";
import { loadDrawings, persistDrawings } from "./storage";

/** How many points each tool needs before the shape is finished. */
const POINTS_NEEDED = { trendline: 2, ray: 1, zone: 2, text: 1 };

const newId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// A stable empty array so "no drawings" never invalidates a downstream memo.
const EMPTY = [];

/**
 * Drawing state and pointer handling for ChartPro.
 *
 * Owns the primitive, the shape list, the active tool, selection and dragging.
 * Nothing here touches the chart's own series — drawings live in their own
 * primitive layer, so they're unaffected by indicator toggles or the PLAN
 * overlay, and survive the series rebuild that every pref change triggers.
 */
export function useDrawings({ ticker, chartRef, elRef, mainSeriesRef, seriesEpoch, enabled }) {
  const [tool, setTool] = useState(null);        // null = select/pan
  // Stamped with the ticker its shapes belong to, so switching stocks shows an
  // empty chart immediately without a synchronous reset inside an effect.
  const [loaded, setLoaded] = useState({ ticker: null, shapes: EMPTY, synced: true });
  const [selectedId, setSelectedId] = useState(null);

  const shapes = loaded.ticker === ticker ? loaded.shapes : EMPTY;
  const synced = loaded.ticker === ticker ? loaded.synced : true;

  const primitiveRef = useRef(null);
  const shapesRef = useRef(EMPTY);
  const toolRef = useRef(null);
  const pendingRef = useRef(null);   // first click of a two-point shape
  const dragRef = useRef(null);      // { id, handle, moved, last }

  useEffect(() => { shapesRef.current = shapes; }, [shapes]);
  useEffect(() => { toolRef.current = tool; }, [tool]);

  // --- load: newest copy wins, a local copy survives a failed push ---
  useEffect(() => {
    let alive = true;
    loadDrawings(ticker).then((res) => {
      if (!alive) return;
      setLoaded({ ticker, shapes: res.shapes, synced: res.synced });
    });
    return () => { alive = false; };
  }, [ticker]);

  const setShapes = useCallback((next) => {
    setLoaded((cur) => ({ ...cur, ticker, shapes: next }));
  }, [ticker]);

  const commit = useCallback((next) => {
    setShapes(next);
    persistDrawings(ticker, next).then(
      (ok) => setLoaded((cur) => ({ ...cur, ticker, shapes: next, synced: ok })),
    );
  }, [ticker, setShapes]);

  // --- attach the primitive to whatever the current main series is ---
  useEffect(() => {
    const series = mainSeriesRef.current;
    if (!enabled || !series) return undefined;
    const primitive = new DrawingPrimitive();
    primitiveRef.current = primitive;
    series.attachPrimitive(primitive);
    primitive.setShapes(shapesRef.current);
    return () => {
      try { series.detachPrimitive?.(primitive); } catch { /* series already gone */ }
      if (primitiveRef.current === primitive) primitiveRef.current = null;
    };
    // ChartPro tears down and rebuilds its series on every pref change, so the
    // primitive has to re-attach to the new one — `seriesEpoch` is bumped there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, seriesEpoch, ticker]);

  useEffect(() => { primitiveRef.current?.setShapes(shapes); }, [shapes]);
  useEffect(() => { primitiveRef.current?.setSelected(selectedId); }, [selectedId]);

  /** Screen px -> the nearest (time, price) anchor. */
  const toPoint = useCallback((clientX, clientY) => {
    const chart = chartRef.current;
    const el = elRef.current;
    const series = mainSeriesRef.current;
    if (!chart || !el || !series) return null;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const time = chart.timeScale().coordinateToTime(x);
    const price = series.coordinateToPrice(y);
    if (time == null || price == null) return null;
    return { time, price };
  }, [chartRef, elRef, mainSeriesRef]);

  const localXY = useCallback((e) => {
    const rect = elRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, [elRef]);

  // --- pointer handling ---
  useEffect(() => {
    const el = elRef.current;
    if (!enabled || !el) return undefined;

    const onPointerDown = (e) => {
      const primitive = primitiveRef.current;
      if (!primitive || e.button !== 0) return;
      const activeTool = toolRef.current;

      if (!activeTool) {
        // select / drag existing
        const { x, y } = localXY(e);
        const hit = primitive.hitTest(x, y);
        if (hit) {
          e.preventDefault();
          e.stopPropagation();
          setSelectedId(hit.shape.id);
          dragRef.current = { id: hit.shape.id, handle: hit.handle, moved: false, last: toPoint(e.clientX, e.clientY) };
          el.setPointerCapture?.(e.pointerId);
        } else {
          setSelectedId(null);
        }
        return;
      }

      // drawing: consume the click so the chart doesn't pan
      e.preventDefault();
      e.stopPropagation();
      const pt = toPoint(e.clientX, e.clientY);
      if (!pt) return;
      const need = POINTS_NEEDED[activeTool] || 2;

      if (need === 1) {
        if (activeTool === "text") {
          const text = window.prompt("Label text");
          if (!text) { setTool(null); return; }
          commit([...shapesRef.current, { id: newId(), kind: "text", points: [pt], text }]);
        } else {
          commit([...shapesRef.current, { id: newId(), kind: activeTool, points: [pt] }]);
        }
        setTool(null);
        return;
      }

      if (!pendingRef.current) {
        pendingRef.current = { id: newId(), kind: activeTool, points: [pt] };
        primitive.setDraft({ ...pendingRef.current, points: [pt, pt] });
      } else {
        const shape = { ...pendingRef.current, points: [pendingRef.current.points[0], pt] };
        pendingRef.current = null;
        primitive.setDraft(null);
        commit([...shapesRef.current, shape]);
        setTool(null);
      }
    };

    const onPointerMove = (e) => {
      const primitive = primitiveRef.current;
      if (!primitive) return;

      // live preview of the second point
      if (pendingRef.current) {
        const pt = toPoint(e.clientX, e.clientY);
        if (pt) primitive.setDraft({ ...pendingRef.current, points: [pendingRef.current.points[0], pt] });
        return;
      }

      const drag = dragRef.current;
      if (!drag) {
        // cursor affordance over an existing shape
        const { x, y } = localXY(e);
        el.style.cursor = toolRef.current ? "crosshair" : (primitive.hitTest(x, y) ? "pointer" : "");
        return;
      }

      const pt = toPoint(e.clientX, e.clientY);
      if (!pt) return;
      e.preventDefault();
      e.stopPropagation();
      drag.moved = true;
      const next = shapesRef.current.map((s) => {
        if (s.id !== drag.id) return s;
        if (drag.handle != null) {
          const points = s.points.slice();
          points[drag.handle] = pt;
          return { ...s, points };
        }
        // whole-shape move: shift every point by the pointer delta
        const dPrice = pt.price - (drag.last?.price ?? pt.price);
        return {
          ...s,
          points: s.points.map((p) => ({ time: p.time, price: p.price + dPrice })),
        };
      });
      drag.last = pt;
      setShapes(next);
      primitive.setShapes(next);
    };

    const onPointerUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag?.moved) commit(shapesRef.current);
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        pendingRef.current = null;
        primitiveRef.current?.setDraft(null);
        setTool(null);
        setSelectedId(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        const target = e.target;
        if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
        e.preventDefault();
        commit(shapesRef.current.filter((s) => s.id !== selectedId));
        setSelectedId(null);
      }
    };

    el.addEventListener("pointerdown", onPointerDown, { capture: true });
    el.addEventListener("pointermove", onPointerMove, { capture: true });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown, { capture: true });
      el.removeEventListener("pointermove", onPointerMove, { capture: true });
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled, elRef, toPoint, localXY, commit, setShapes, selectedId]);

  const clearAll = useCallback(() => {
    setSelectedId(null);
    commit([]);
  }, [commit]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    commit(shapesRef.current.filter((s) => s.id !== selectedId));
    setSelectedId(null);
  }, [commit, selectedId]);

  return {
    tool,
    setTool: (t) => {
      pendingRef.current = null;
      primitiveRef.current?.setDraft(null);
      setTool((cur) => (cur === t ? null : t));
    },
    shapes,
    selectedId,
    synced,
    clearAll,
    deleteSelected,
  };
}
