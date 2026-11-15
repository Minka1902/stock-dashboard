/** How far a finger may move and still have tapped rather than scrolled. */
const TAP_SLOP = 10;

/**
 * Calls `onTap(e)` when a finger or pen press on `node` lifts without having
 * moved past TAP_SLOP: a tap, not the start of a scroll, a pan or a pinch.
 * `accept(e)` decides on the press whether it counts. Mouse presses never
 * do; a hover-capable pointer has its own events. Returns the cleanup.
 */
export function listenTaps(node, { onTap, accept = () => true, capture = false }) {
  let tap = null;
  const onDown = (e) => {
    tap = e.pointerType !== "mouse" && e.isPrimary && accept(e) ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
  };
  const onMove = (e) => {
    if (tap?.id === e.pointerId && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP) tap = null;
  };
  const onCancel = () => { tap = null; };
  const onUp = (e) => {
    if (tap?.id !== e.pointerId) return;
    tap = null;
    onTap(e);
  };
  const events = [["pointerdown", onDown], ["pointermove", onMove], ["pointercancel", onCancel], ["pointerup", onUp]];
  for (const [type, fn] of events) node.addEventListener(type, fn, capture);
  return () => {
    for (const [type, fn] of events) node.removeEventListener(type, fn, capture);
  };
}
