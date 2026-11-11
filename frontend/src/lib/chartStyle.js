import { useMemo } from "react";
import { useTypeSizes } from "./themeColors";

// Shared recharts styling: tokens, never hex, so every theme follows
// (recharts defaults its cursor to #ccc).

export const CHART_TOOLTIP = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  fontSize: "var(--fs-12)",
  color: "var(--text)",
  padding: "6px 10px",
};

export const CHART_CURSOR = { stroke: "var(--border-strong)" };

// Tick labels are SVG text that recharts lays out itself, so they take the
// token resolved to px rather than a var().
const AXIS_TYPE = { tick: "--fs-10" };

/** Recharts axis `tick` props at the current --fs-10, in `fill`. */
export function useAxisTick(fill = "var(--text-faint)") {
  const { tick } = useTypeSizes(AXIS_TYPE);
  return useMemo(() => ({ fontSize: tick, fill }), [tick, fill]);
}
