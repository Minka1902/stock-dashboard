import { useLayoutEffect, useRef, useState } from "react";
import Button from "./Button";
import Dialog from "./Dialog";
import Icon from "./Icon";
import Tooltip from "./Tooltip";
import { sourceIcon, sourceLabel, sourceState } from "../lib/sources";
import styles from "./SourceHealth.module.css";

// The flex gap between the caption and the glyphs (.health in the module).
const GAP = 6;

/** A failing source's glyph: a soft red pulse, or solid red with ▲ under reduced motion. */
function failingGlyph(name, size) {
  return (
    <>
      <Icon name={name} size={size} className={styles.pulse} />
      <span className={styles.flag} aria-hidden="true">▲</span>
    </>
  );
}

/**
 * How many glyphs fit beside the caption in `room` px, the "+N" included when
 * some are left over; 0 when not even one does.
 */
function glyphsThatFit(room, sizes, total, max) {
  const need = (k) => sizes.caption + k * (sizes.chip + GAP) + (k < total ? sizes.more + GAP : 0);
  let k = Math.min(max, total);
  while (k > 0 && need(k) > room) k -= 1;
  return k;
}

/**
 * The data sources that are not responding, for the top bar (STC-87/88).
 * Renders nothing while every source is healthy. Each failing source shows
 * its own glyph (lib/sources.js), and the glyphs always sit next to text (the
 * caption or a count), so the pulse is never the only signal.
 *
 * `variant` "inline" fills the width its flex parent leaves it: a "Not
 *   responding" caption and one glyph per source, up to `max` and as many as
 *   fit, then "+N"; when not even one fits beside the caption it shows the
 *   compact button instead. A glyph's tooltip names the source and its
 *   recorded error, and a click opens the details.
 * `variant` "compact": one glyph and the count.
 * "+N" and the compact button open a sheet listing every failing source with
 * its error. `onOpenDetails()` leads to the full diagnostics.
 */
export default function SourceHealth({ sources, variant = "inline", max = 6, onOpenDetails }) {
  const [open, setOpen] = useState(false);
  const [fit, setFit] = useState(max);
  const boxRef = useRef(null);
  // Widest caption, glyph and "+N" seen so far: the ones not rendered right
  // now still count when the room changes.
  const sizes = useRef({ caption: 0, chip: 0, more: 0 });
  const failing = (sources || []).filter((s) => sourceState(s.status) === "error");
  const total = failing.length;

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (variant !== "inline" || !box) return undefined;
    const ro = new ResizeObserver(() => {
      const s = sizes.current;
      for (const el of box.children) {
        const kind = el.dataset.kind;
        if (kind) s[kind] = Math.max(s[kind], el.offsetWidth);
      }
      if (!s.caption || !s.chip) return;
      setFit(glyphsThatFit(box.clientWidth, { ...s, more: s.more || s.chip }, total, max));
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [variant, max, total]);

  if (!total) return null;

  const showCompact = variant === "compact" || fit === 0;
  const shown = showCompact ? [] : failing.slice(0, fit);
  const hidden = failing.slice(shown.length);
  const count = `${total} data source${total === 1 ? "" : "s"} not responding`;
  const openDetails = () => {
    setOpen(false);
    onOpenDetails?.();
  };

  return (
    <div className={styles.health} data-variant={variant} ref={boxRef}>
      {showCompact ? (
        <Tooltip side="bottom" content={count}>
          <button type="button" className={`${styles.chip} ${styles.compact}`} onClick={() => setOpen(true)}
                  aria-haspopup="dialog" aria-label={count}>
            {failingGlyph(total === 1 ? sourceIcon(failing[0].source) : "database", 17)}
            <span className={styles.count}>{total}</span>
          </button>
        </Tooltip>
      ) : (
        <>
          <span className={styles.caption} data-kind="caption">Not responding</span>
          {shown.map((s) => (
            <Tooltip key={s.source} side="bottom" content={(
              <>
                <strong>{sourceLabel(s.source)} did not respond</strong>
                <p>{s.status}</p>
                <p>Click for the full error.</p>
              </>
            )}>
              <button type="button" className={styles.chip} data-kind="chip" onClick={openDetails}
                      aria-label={`${sourceLabel(s.source)} not responding`}>
                {failingGlyph(sourceIcon(s.source), 15)}
              </button>
            </Tooltip>
          ))}
          {hidden.length > 0 && (
            <Tooltip side="bottom" content={`Also not responding: ${hidden.map((s) => sourceLabel(s.source)).join(", ")}`}>
              <button type="button" className={styles.chip} data-kind="more" onClick={() => setOpen(true)}
                      aria-haspopup="dialog" aria-label={`${hidden.length} more sources not responding`}>
                +{hidden.length}
              </button>
            </Tooltip>
          )}
        </>
      )}

      <Dialog
        open={open}
        title="Not responding"
        caption={count}
        tone="negative"
        onClose={() => setOpen(false)}
        footer={<Button onClick={openDetails}>Source details</Button>}
      >
        <ul className={styles.list}>
          {failing.map((s) => (
            <li key={s.source} className={styles.row}>
              <span className={styles.rowIcon}><Icon name={sourceIcon(s.source)} size={18} /></span>
              <span className={styles.rowText}>
                <span className={styles.rowName}>{sourceLabel(s.source)}</span>
                <span className={styles.rowError}>{s.status}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className={styles.note}>Nothing is invented: the last good data, if any, is kept until the source responds.</p>
      </Dialog>
    </div>
  );
}
