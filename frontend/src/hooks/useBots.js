import { useCallback, useEffect, useState } from "react";
import {
  createBot, getBotStrategies, getBots, pauseBot, resumeBot, stopAllBots, stopBot,
} from "../api";

const POLL_MS = 30000;

/**
 * The Trading Bot page's data: the user's bots (with positions, P&L and
 * recent events), the strategy catalog, and the actions. Polls every 30s;
 * every action returns the fresh list. `onCashChanged` runs after anything
 * that moves Portfolio cash (create, stop).
 */
export function useBots(onCashChanged) {
  const [bots, setBots] = useState([]);
  const [strategies, setStrategies] = useState([]);
  const [costBps, setCostBps] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const out = await getBots();
      setBots(out.bots);
      setCostBps(out.cost_bps);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Intentional: initial load on mount, then poll.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    getBotStrategies().then((s) => setStrategies(s.strategies)).catch(() => {});
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const act = useCallback(async (fn, movesCash = false) => {
    const out = await fn();
    setBots(out.bots);
    if (movesCash) onCashChanged?.();
    return out;
  }, [onCashChanged]);

  return {
    bots, strategies, costBps, loading, error, reload: load,
    create: (body) => act(() => createBot(body), true),
    pause: (id) => act(() => pauseBot(id)),
    resume: (id) => act(() => resumeBot(id)),
    stop: (id) => act(() => stopBot(id), true),
    stopAll: () => act(stopAllBots, true),
  };
}
