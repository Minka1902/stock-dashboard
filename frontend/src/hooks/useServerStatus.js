import { useCallback, useEffect, useRef, useState } from "react";
import { getServerEvents, getServerOverview, getServerSources } from "../api";

// Polling, not SSE: this app runs a single uvicorn worker, and an open event
// stream would hold one of its threadpool slots per viewer for data that only
// changes every few seconds anyway.
const FAST_MS = 3000;   // overview + per-source state
const SLOW_MS = 10000;  // the event log

/**
 * Live server state for the Server page.
 *
 * Pauses while the tab is hidden — a background tab polling every 3s costs the
 * single worker real capacity for something nobody is looking at.
 */
export function useServerStatus(active = true) {
  const [overview, setOverview] = useState(null);
  const [sources, setSources] = useState([]);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const pull = useCallback(async (withEvents) => {
    try {
      const [ov, src] = await Promise.all([getServerOverview(), getServerSources()]);
      if (!mounted.current) return;
      setOverview(ov);
      setSources(src);
      setError(null);
      if (withEvents) {
        const ev = await getServerEvents(80);
        if (mounted.current) setEvents(ev);
      }
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!active) return undefined;

    let fast; let slow;
    const start = () => {
      pull(true);
      fast = setInterval(() => { if (!document.hidden) pull(false); }, FAST_MS);
      slow = setInterval(() => { if (!document.hidden) pull(true); }, SLOW_MS);
    };
    const stop = () => { clearInterval(fast); clearInterval(slow); };

    start();
    const onVisible = () => { if (!document.hidden) pull(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, pull]);

  return { overview, sources, events, error, loading, refresh: () => pull(true) };
}
