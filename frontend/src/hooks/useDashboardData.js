import { useCallback, useEffect, useState } from "react";
import {
  getContracts,
  getSources,
  getNews,
  getTrades,
  getWatchlist,
  getYieldCurve,
  getEconCalendar,
  getSignals,
  getFearGreed,
  getVix,
  getAaii,
  getPutCall,
  getMarginDebt,
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
  getAnalyses,
  markAlertsRead as apiMarkAlertsRead,
  refreshSource,
  addWatch as apiAddWatch,
  removeWatch as apiRemoveWatch,
  addHolding as apiAddHolding,
  updateHolding as apiUpdateHolding,
  removeHolding as apiRemoveHolding,
} from "../api";

const REFRESH_MS = 180000; // 3 minutes, matches backend default
const EXTERNAL_SOURCES = [
  "usaspending", "gdelt", "edgar",
  "yield_curve", "econ_calendar", "technical", "fear_greed", "vix", "aaii", "put_call", "margin_debt", "congress",
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
  const [econCalendar, setEconCalendar] = useState([]);
  const [signals, setSignals] = useState([]);
  const [fearGreed, setFearGreed] = useState([]);
  const [vix, setVix] = useState([]);
  const [aaii, setAaii] = useState([]);
  const [putCall, setPutCall] = useState([]);
  const [marginDebt, setMarginDebt] = useState([]);
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
  const [analyses, setAnalyses] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    // Load every source independently: one failing endpoint (e.g. an upstream
    // 429/500) must not blank the whole dashboard. Each result is applied on
    // its own; failures leave that panel's previous state untouched.
    const results = await Promise.allSettled([
      getContracts(),      // 0
      getSources(),        // 1 — connectivity signal for the error banner
      getNews(),           // 2
      getTrades(),         // 3
      getWatchlist(),      // 4
      getYieldCurve(),     // 5
      getSignals(),        // 6
      getFearGreed(),      // 7
      getVix(),            // 8
      getAaii(),           // 9
      getPutCall(),        // 10
      getMarginDebt(),     // 11
      getSentiment(),      // 12
      getCongressTrades(), // 13
      getShortInterest(),  // 14
      getSocial(),         // 15
      getAnalyst(),        // 16
      getBoomScores(),     // 17
      getFundamentals(),   // 18
      getSeasonality(),    // 19
      getPortfolio(),      // 20
      getSuggestions(),    // 21
      getAlerts(),         // 22 — special shape { alerts, unread }
      getAnalyses(),       // 23
      getEconCalendar(),   // 24
    ]);

    const setters = [
      setContracts, setSources, setNews, setTrades, setWatchlist,
      setYieldCurve, setSignals, setFearGreed, setVix, setAaii,
      setPutCall, setMarginDebt, setSentiment, setCongressTrades,
      setShortInterest, setSocial, setAnalyst, setBoomScores,
      setFundamentals, setSeasonality, setPortfolio, setSuggestions,
      null, // alerts handled below
      setAnalyses,
      setEconCalendar,
    ];
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && setters[i]) setters[i](r.value);
    });

    const alerts = results[22];
    if (alerts.status === "fulfilled") {
      setAlerts(alerts.value.alerts);
      setUnreadAlerts(alerts.value.unread);
    }

    // Only banner a genuine outage: the sources fetch is the connectivity probe.
    const sources = results[1];
    setError(sources.status === "fulfilled" ? null : (sources.reason?.message || "backend unreachable"));
    setLoading(false);
  }, []);

  useEffect(() => {
    // Intentional: kick off the initial load on mount, then poll on an interval.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // Refresh every external source, then reload. Partial failures are fine:
  // each source records its own status server-side. Bounded concurrency: firing
  // all ~18 refreshes at once saturates the single backend worker (each does
  // blocking network I/O), so run them a few at a time.
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const queue = [...EXTERNAL_SOURCES];
      const worker = async () => {
        while (queue.length) {
          const s = queue.shift();
          try { await refreshSource(s); } catch { /* status recorded server-side */ }
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
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

  const updateHolding = useCallback(async (ticker, shares, avgCost) => {
    setPortfolio(await apiUpdateHolding(ticker, shares, avgCost));
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
    econCalendar,
    signals,
    fearGreed,
    vix,
    aaii,
    putCall,
    marginDebt,
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
    analyses,
    alerts,
    unreadAlerts,
    loading,
    busy,
    error,
    refresh,
    addWatch,
    removeWatch,
    addHolding,
    updateHolding,
    removeHolding,
    markAlertsRead,
  };
}
