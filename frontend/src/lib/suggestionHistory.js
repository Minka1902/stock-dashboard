/** Shared formatting for suggestion outcomes (calendar view + analysis strip). */

/** Outcome → tone, with a dead band so noise doesn't read as a win or a loss. */
export function outcomeTone(pct) {
  if (pct == null) return "pending";
  if (pct >= 2) return "up";
  if (pct <= -2) return "down";
  return "flat";
}

export function pctLabel(pct) {
  if (pct == null) return "pending";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/** Dot colours for the recharts markers, which can't read CSS custom properties. */
export const TONE_COLOR = {
  up: "#4fd6a0", down: "#e5544b", flat: "#8f887e", pending: "#b7b0a6",
};
