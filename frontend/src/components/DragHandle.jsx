import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import Tooltip from "./Tooltip";
import { useMediaQuery } from "../hooks/useMediaQuery";
import styles from "./DragHandle.module.css";

// A touch press becomes a drag only once it has been held this still for
// this long; a swipe that merely starts on the handle scrolls the page.
const HOLD_MS = 350;
const HOLD_SLOP_PX = 8;

/**
 * The grip that picks a row of a motion Reorder list up, by mouse, touch or
 * keyboard. `controls` is the row's useDragControls(); `label` its accessible
 * name (say how to use the arrow keys); `onMove(-1 | 1)` moves the row one
 * place from the keyboard.
 *
 * A mouse or pen drags at once. A finger has to hold still for HOLD_MS first
 * (the grip lights up), because the handle sits where a thumb scrolls the
 * page; until then it is `touch-action: pan-y` and scrolls like the rest of
 * the row (STC-107). Quiet until its row is hovered, except on touch.
 */
export default function DragHandle({ controls, label, onMove, className = "" }) {
  const coarse = useMediaQuery("(pointer: coarse)");
  const ref = useRef(null);
  // The touch press in progress: where it started, its timer, whether it armed.
  const hold = useRef(null);
  const [armed, setArmed] = useState(false);

  // An armed hold owns the finger: its moves drag the row instead of the page.
  // Non-passive, so it has to be a native listener.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onTouchMove = (e) => {
      if (hold.current?.active) e.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("touchmove", onTouchMove);
      clearTimeout(hold.current?.timer);
    };
  }, []);

  const release = () => {
    clearTimeout(hold.current?.timer);
    hold.current = null;
    setArmed(false);
  };

  return (
    <Tooltip disabled={coarse} content="Drag to reorder — or focus it and use the arrow keys" shortcut={[["↑"], ["↓"]]}>
      <button
        ref={ref}
        type="button"
        className={`${styles.handle} ${className}`}
        data-armed={armed ? "yes" : "no"}
        aria-label={label}
        onPointerDown={(e) => {
          if (e.pointerType === "touch") {
            const origin = e;
            hold.current = {
              x: e.clientX,
              y: e.clientY,
              active: false,
              timer: setTimeout(() => {
                hold.current.active = true;
                setArmed(true);
                controls.start(origin);
              }, HOLD_MS),
            };
            return;
          }
          e.preventDefault(); // don't start a text selection while dragging
          // preventDefault on pointerdown also suppresses the browser's default
          // focus step, which would silently break the keyboard path below.
          e.currentTarget.focus();
          controls.start(e);
        }}
        onPointerMove={(e) => {
          const h = hold.current;
          if (h && !h.active && Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP_PX) release();
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") { e.preventDefault(); onMove(-1); }
          if (e.key === "ArrowDown") { e.preventDefault(); onMove(1); }
        }}
      >
        <Icon name="grip" size={14} />
      </button>
    </Tooltip>
  );
}
