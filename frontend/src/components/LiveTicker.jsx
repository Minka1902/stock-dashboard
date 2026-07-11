import { useEffect, useRef } from "react";
import { motion, useMotionValue, useAnimationFrame } from "motion/react";
import { prefersReducedMotion } from "../lib/motionConfig";
import styles from "./LiveTicker.module.css";

function tone(pct) {
  if (pct == null) return "flat";
  return pct >= 0 ? "pos" : "neg";
}

function Item({ q }) {
  const t = tone(q.change_pct);
  return (
    <span className={styles.item} role="listitem">
      <span className={styles.symbol}>{q.ticker}</span>
      <span className={styles.price}>{q.price != null ? q.price.toFixed(2) : "—"}</span>
      <span className={styles.change} data-tone={t}>
        <span className={styles.arrow}>{t === "pos" ? "▲" : t === "neg" ? "▼" : "•"}</span>
        {q.change_pct != null ? `${Math.abs(q.change_pct).toFixed(2)}%` : "—"}
      </span>
      {(q.market_state === "PRE" || q.market_state === "POST") && (
        <span className={styles.badge}>{q.market_state}</span>
      )}
    </span>
  );
}

function marketBadge(quotes) {
  const state = quotes.find((q) => q.market_state)?.market_state;
  return state || null;
}

// Marquee speed: px/sec derived so a full loop (one copy width) takes ~48s,
// matching the old CSS keyframe cadence regardless of content width.
const LOOP_SECONDS = 48;

/**
 * JS-driven infinite marquee: one motion value drives translateX, advancing
 * every frame and wrapping modulo the (duplicated) list's half-width. Hovering
 * pauses the auto-advance and hands control to drag; releasing the pointer and
 * leaving resumes the scroll from the current offset with no jump.
 */
function Marquee({ quotes }) {
  const x = useMotionValue(0);
  const trackRef = useRef(null);
  const halfRef = useRef(0);
  const pausedRef = useRef(false);    // hover
  const draggingRef = useRef(false);  // active pointer drag

  useEffect(() => {
    const measure = () => {
      const el = trackRef.current;
      if (el) halfRef.current = el.scrollWidth / 2;
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (trackRef.current) ro.observe(trackRef.current);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  useAnimationFrame((_t, dt) => {
    const half = halfRef.current;
    if (!half) return;
    if (!pausedRef.current && !draggingRef.current) {
      const speed = half / LOOP_SECONDS;
      x.set(x.get() - (speed * dt) / 1000);
    }
    // Wrap into (-half, 0]; positions v and v±half are visually identical
    // because the list is duplicated, so this loops seamlessly. Skipped while a
    // pointer drag owns the value so we don't fight the gesture.
    if (!draggingRef.current) {
      let v = x.get();
      if (v <= -half) v += half;
      else if (v > 0) v -= half;
      x.set(v);
    }
  });

  return (
    <div
      className={styles.trackWrap}
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={() => { pausedRef.current = false; }}
    >
      <motion.div
        ref={trackRef}
        className={styles.track}
        style={{ x }}
        drag="x"
        dragMomentum={false}
        onDragStart={() => { draggingRef.current = true; }}
        onDragEnd={() => { draggingRef.current = false; }}
      >
        {quotes.map((q) => <Item key={q.ticker} q={q} />)}
        {/* duplicate for a seamless loop */}
        {quotes.map((q) => <Item key={`${q.ticker}-b`} q={q} />)}
      </motion.div>
    </div>
  );
}

/** Scrolling tape of live quotes (incl. pre/post-market). Pauses + drags on hover; static under reduce-motion. */
export default function LiveTicker({ quotes, asOf, marketStatus }) {
  const reduced = prefersReducedMotion();
  if (!quotes || quotes.length === 0) return null;
  // Prefer the backend's clock-based session; fall back to per-quote state.
  const state = marketStatus || marketBadge(quotes);
  const stamp = asOf
    ? new Date(asOf).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  return (
    <div className={styles.tape} role="list" aria-label="Live quotes">
      {stamp && (
        <span className={styles.asOf} data-state={state || "CLOSED"}>
          <span className={styles.dot} aria-hidden="true" />
          {state || "CLOSED"} · {stamp}
        </span>
      )}
      {reduced ? (
        <div className={styles.trackWrap} data-static="yes">
          <div className={styles.track}>
            {quotes.map((q) => <Item key={q.ticker} q={q} />)}
            {quotes.map((q) => <Item key={`${q.ticker}-b`} q={q} />)}
          </div>
        </div>
      ) : (
        <Marquee quotes={quotes} />
      )}
    </div>
  );
}
