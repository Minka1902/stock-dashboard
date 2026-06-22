import { useCallback, useEffect, useState } from "react";
import {
  getContracts,
  getSources,
  getNews,
  getTrades,
  getWatchlist,
  refreshSource,
  addWatch as apiAddWatch,
  removeWatch as apiRemoveWatch,
} from "../api";

const REFRESH_MS = 180000; // 3 minutes, matches backend default
const EXTERNAL_SOURCES = ["usaspending", "gdelt", "edgar"];

/**
 * Owns all dashboard data: contracts, sources, news, insider trades, watchlist.
 * Loads in parallel, supports manual refresh of all sources, auto-refreshes
 * every 3 minutes, and exposes watchlist add/remove.
 */
export function useDashboardData() {
  const [contracts, setContracts] = useState([]);
  const [sources, setSources] = useState([]);
  const [news, setNews] = useState([]);
  const [trades, setTrades] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [c, s, n, t, w] = await Promise.all([
        getContracts(),
        getSources(),
        getNews(),
        getTrades(),
        getWatchlist(),
      ]);
      setContracts(c);
      setSources(s);
      setNews(n);
      setTrades(t);
      setWatchlist(w);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // Refresh every external source, then reload. Partial failures are fine:
  // each source records its own status server-side.
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      await Promise.allSettled(EXTERNAL_SOURCES.map((s) => refreshSource(s)));
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [load]);

  const addWatch = useCallback(async (ticker, note) => {
    setWatchlist(await apiAddWatch(ticker, note));
  }, []);

  const removeWatch = useCallback(async (ticker) => {
    setWatchlist(await apiRemoveWatch(ticker));
  }, []);

  return {
    contracts,
    sources,
    news,
    trades,
    watchlist,
    loading,
    busy,
    error,
    refresh,
    addWatch,
    removeWatch,
  };
}
