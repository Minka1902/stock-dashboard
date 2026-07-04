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
  getVix,
  getAaii,
  getPutCall,
  getSentiment,
  getCongressTrades,
  getShortInterest,
  getSocial,
  getAnalyst,
  getBoomScores,
  getFundamentals,
  getSeasonality,
  getPortfolio,
  getSuggestions,
  getAlerts,
  markAlertsRead as apiMarkAlertsRead,
  refreshSource,
  addWatch as apiAddWatch,
  removeWatch as apiRemoveWatch,
  addHolding as apiAddHolding,
  removeHolding as apiRemoveHolding,
} from "../api";

const REFRESH_MS = 180000; // 3 minutes, matches backend default
const EXTERNAL_SOURCES = [
  "usaspending", "gdelt", "edgar",
  "yield_curve", "technical", "fear_greed", "vix", "aaii", "put_call", "congress",
  "short_interest", "social", "analyst", "fundamentals", "seasonality", "boom_score",
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
  const [vix, setVix] = useState([]);
  const [aaii, setAaii] = useState([]);
  const [putCall, setPutCall] = useState([]);
  const [sentiment, setSentiment] = useState(null);
  const [congressTrades, setCongressTrades] = useState([]);
  const [shortInterest, setShortInterest] = useState([]);
  const [social, setSocial] = useState([]);
  const [analyst, setAnalyst] = useState([]);
  const [boomScores, setBoomScores] = useState([]);
  const [fundamentals, setFundamentals] = useState([]);
  const [seasonality, setSeasonality] = useState([]);
  const [portfolio, setPortfolio] = useState([]);
  const [suggestions, setSuggestions] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [c, s, n, t, w, yc, sig, fg, vx, aa, pc, sent, ct, si, soc, ana, bs, fund, seas, port, sugg, al] = await Promise.all([
        getContracts(),
        getSources(),
        getNews(),
        getTrades(),
        getWatchlist(),
        getYieldCurve(),
        getSignals(),
        getFearGreed(),
        getVix(),
        getAaii(),
        getPutCall(),
        getSentiment(),
        getCongressTrades(),
        getShortInterest(),
        getSocial(),
        getAnalyst(),
        getBoomScores(),
        getFundamentals(),
        getSeasonality(),
        getPortfolio(),
        getSuggestions(),
        getAlerts(),
      ]);
      setContracts(c);
      setSources(s);
      setNews(n);
      setTrades(t);
      setWatchlist(w);
      setYieldCurve(yc);
      setSignals(sig);
      setFearGreed(fg);
      setVix(vx);
      setAaii(aa);
      setPutCall(pc);
      setSentiment(sent);
      setCongressTrades(ct);
      setShortInterest(si);
      setSocial(soc);
      setAnalyst(ana);
      setBoomScores(bs);
      setFundamentals(fund);
      setSeasonality(seas);
      setPortfolio(port);
      setSuggestions(sugg);
      setAlerts(al.alerts);
      setUnreadAlerts(al.unread);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Intentional: kick off the initial load on mount, then poll on an interval.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const addHolding = useCallback(async (ticker, shares, avgCost) => {
    setPortfolio(await apiAddHolding(ticker, shares, avgCost));
  }, []);

  const removeHolding = useCallback(async (ticker) => {
    setPortfolio(await apiRemoveHolding(ticker));
  }, []);

  const markAlertsRead = useCallback(async () => {
    const { alerts: a, unread } = await apiMarkAlertsRead({ all: true });
    setAlerts(a);
    setUnreadAlerts(unread);
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
    vix,
    aaii,
    putCall,
    sentiment,
    congressTrades,
    shortInterest,
    social,
    analyst,
    boomScores,
    fundamentals,
    seasonality,
    portfolio,
    suggestions,
    alerts,
    unreadAlerts,
    loading,
    busy,
    error,
    refresh,
    addWatch,
    removeWatch,
    addHolding,
    removeHolding,
    markAlertsRead,
  };
}
