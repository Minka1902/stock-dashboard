import { useCallback, useEffect, useState } from "react";
import {
  getContracts,
  getSources,
  getNews,
  getTrades,
  getWatchlist,
  getYieldCurve,
  getSignals,
  getFearGreed,
  getCongressTrades,
  getShortInterest,
  getSocial,
  getAnalyst,
  getBoomScores,
  getFundamentals,
  refreshSource,
  addWatch as apiAddWatch,
  removeWatch as apiRemoveWatch,
} from "../api";

const REFRESH_MS = 180000; // 3 minutes, matches backend default
const EXTERNAL_SOURCES = [
  "usaspending", "gdelt", "edgar",
  "yield_curve", "technical", "fear_greed", "congress",
  "short_interest", "social", "analyst", "fundamentals", "boom_score",
];

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
  const [yieldCurve, setYieldCurve] = useState([]);
  const [signals, setSignals] = useState([]);
  const [fearGreed, setFearGreed] = useState([]);
  const [congressTrades, setCongressTrades] = useState([]);
  const [shortInterest, setShortInterest] = useState([]);
  const [social, setSocial] = useState([]);
  const [analyst, setAnalyst] = useState([]);
  const [boomScores, setBoomScores] = useState([]);
  const [fundamentals, setFundamentals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [c, s, n, t, w, yc, sig, fg, ct, si, soc, ana, bs, fund] = await Promise.all([
        getContracts(),
        getSources(),
        getNews(),
        getTrades(),
        getWatchlist(),
        getYieldCurve(),
        getSignals(),
        getFearGreed(),
        getCongressTrades(),
        getShortInterest(),
        getSocial(),
        getAnalyst(),
        getBoomScores(),
        getFundamentals(),
      ]);
      setContracts(c);
      setSources(s);
      setNews(n);
      setTrades(t);
      setWatchlist(w);
      setYieldCurve(yc);
      setSignals(sig);
      setFearGreed(fg);
      setCongressTrades(ct);
      setShortInterest(si);
      setSocial(soc);
      setAnalyst(ana);
      setBoomScores(bs);
      setFundamentals(fund);
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
    yieldCurve,
    signals,
    fearGreed,
    congressTrades,
    shortInterest,
    social,
    analyst,
    boomScores,
    fundamentals,
    loading,
    busy,
    error,
    refresh,
    addWatch,
    removeWatch,
  };
}
