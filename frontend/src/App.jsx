import { useEffect, useRef, useState } from "react";
import { useDashboardData } from "./hooks/useDashboardData";
import { useLiveQuotes } from "./hooks/useLiveQuotes";
import { useTheme } from "./hooks/useTheme";
import { useSettings } from "./hooks/useSettings";
import { useAppSettings } from "./hooks/useAppSettings";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import LiveTicker from "./components/LiveTicker";
import CommandPalette from "./components/CommandPalette";
import Icon from "./components/Icon";
import StatGrid from "./components/StatGrid";
import SourceStatus from "./components/SourceStatus";
import ContractsPanel from "./components/ContractsPanel";
import TradesPanel from "./components/TradesPanel";
import NewsPanel from "./components/NewsPanel";
import WatchlistPanel from "./components/WatchlistPanel";
import YieldCurvePanel from "./components/YieldCurvePanel";
import EconCalendarPanel from "./components/EconCalendarPanel";
import TechnicalPanel from "./components/TechnicalPanel";
import FearGreedPanel from "./components/FearGreedPanel";
import MarketSentimentPanel from "./components/MarketSentimentPanel";
import CongressPanel from "./components/CongressPanel";
import BoomScorePanel from "./components/BoomScorePanel";
import ShortPanel from "./components/ShortPanel";
import SocialPanel from "./components/SocialPanel";
import AnalystPanel from "./components/AnalystPanel";
import FundamentalsPanel from "./components/FundamentalsPanel";
import SeasonalityPanel from "./components/SeasonalityPanel";
import SettingsPanel from "./components/SettingsPanel";
import SuggestionsPanel from "./components/SuggestionsPanel";
import PortfolioPanel from "./components/PortfolioPanel";
import XPostsPanel from "./components/XPostsPanel";
import InfoPanel from "./components/InfoPanel";
import StockDetailPanel from "./components/StockDetailPanel";
import BackToTop from "./components/BackToTop";
import Tour from "./components/Tour";
import { TOURS } from "./lib/tours";
import { AnimatePresence, motion } from "motion/react";
import { parseStockHash, openTickerTab } from "./lib/nav";
import { prefersReducedMotion } from "./lib/motionConfig";
import styles from "./App.module.css";

const TITLES = {
  sentiment:   "Market Sentiment",
  overview:    "Overview",
  contracts:   "Contracts",
  trades:      "Trades",
  news:        "News",
  watchlist:   "Watchlist",
  "yield-curve": "Yield Curve",
  "econ-calendar": "Economic Calendar",
  signals:     "Signals",
  "fear-greed": "Fear & Greed",
  congress:    "Congress",
  "boom-score": "Boom Score",
  short:       "Short Interest",
  social:      "WSB Sentiment",
  analyst:     "Analyst Ratings",
  fundamentals: "Fundamentals",
  seasonality: "Seasonality",
  suggestions: "Suggestions",
  portfolio:   "Portfolio",
  x:           "X Watch",
  info:        "Info",
  settings:    "Settings",
};

export default function App({ auth }) {
  const data = useDashboardData();
  const appSettingsApi = useAppSettings();
  const { quotes, quotesByTicker, asOf, marketStatus } = useLiveQuotes(
    (appSettingsApi.appSettings.quotes_refresh_seconds || 30) * 1000,
  );
  const { theme, setTheme, toggle, themes } = useTheme();
  const { settings, setSetting } = useSettings();
  const [view, setView] = useState("sentiment");
  const [cmdOpen, setCmdOpen] = useState(false);
  const scrollRef = useRef(null);
  // Any-ticker detail view is driven by the URL hash (#/stock/TICKER) so it can
  // live in its own tab (Task 13). It overlays the current view when present.
  const [detailTicker, setDetailTicker] = useState(parseStockHash);
  // Strip the #/stock/TICKER hash and drop the overlay without touching `view`.
  const clearDetail = () => {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setDetailTicker(null);
  };
  // Nav from within a detail tab must close the overlay first, else the sidebar
  // click would only change the (hidden) TopBar title and the overlay would stay.
  const navigate = (v) => {
    if (detailTicker) clearDetail();
    setView(v);
  };
  // Open the Info page scrolled to its data-sources section (from the failed-
  // source strip). The panel mounts on navigate, so scroll on the next frame.
  const openSourceDetails = () => {
    navigate("info");
    setTimeout(() => {
      document.getElementById("info-sources")?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      });
    }, 80);
  };
  // Guided tour: which view's tour is currently running (null = none).
  const [tourView, setTourView] = useState(null);

  useEffect(() => {
    const onHash = () => setDetailTicker(parseStockHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Back control for the standalone tab: try to close it if it was script-opened
  // (no-op for noopener tabs), otherwise clear the hash and land on the default
  // dashboard view rather than whatever stale `view` was last selected.
  const closeDetail = () => {
    window.close();
    clearDetail();
    setView("sentiment");
  };

  // Cmd/Ctrl+K toggles the command palette (palette mounts only while open).
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Overview collapse/focus plumbing (Overview is no longer in nav but kept in code).
  const [focusKey, setFocusKey] = useState("boom-score");
  const isCollapsed = (key) =>
    settings.focusMode ? key !== focusKey : !!settings.collapsed[key];
  const toggleCollapsed = (key) => {
    if (settings.focusMode) {
      setFocusKey((prev) => (prev === key ? null : key));
    } else {
      setSetting("collapsed", { ...settings.collapsed, [key]: !settings.collapsed[key] });
    }
  };

  const {
    contracts, sources, news, trades, watchlist,
    yieldCurve, econCalendar, signals, fearGreed, vix, aaii, putCall, marginDebt, sentiment, congressTrades,
    shortInterest, social, analyst, boomScores, fundamentals, seasonality,
    portfolio, xPosts, suggestions, analyses, alerts, unreadAlerts,
    loading, busy, error, refresh, addWatch, removeWatch, addHolding, updateHolding,
    setHoldingCategory, removeHolding,
    markAlertsRead,
  } = data;

  // Auto-run each view's tour the first time it's visited (marked seen on close).
  useEffect(() => {
    if (loading || detailTicker || !TOURS[view] || settings.toursSeen[view]) {
      return undefined;
    }
    const id = setTimeout(() => setTourView(view), 450); // let the panel render first
    return () => clearTimeout(id);
  }, [view, loading, detailTicker, settings.toursSeen]);

  const closeTour = () => {
    if (tourView) setSetting("toursSeen", { ...settings.toursSeen, [tourView]: true });
    setTourView(null);
  };

  const commandItems = [
    { id: "sentiment",   label: "Market Sentiment", hint: "the mood",   icon: "gauge",    run: () => navigate("sentiment") },
    { id: "suggestions", label: "Suggestions",      hint: "what to do", icon: "spark",    run: () => navigate("suggestions") },
    { id: "portfolio",   label: "Portfolio",        hint: "your book",  icon: "wallet",   run: () => navigate("portfolio") },
    { id: "trades",      label: "Trades",           hint: "insiders",   icon: "trending", run: () => navigate("trades") },
    { id: "news",        label: "News",             hint: "the tape",   icon: "news",     run: () => navigate("news") },
    { id: "watchlist",   label: "Watchlist",        hint: "charts & radar", icon: "star", run: () => navigate("watchlist") },
    { id: "econ-calendar", label: "Economic Calendar", hint: "macro events", icon: "calendar", run: () => navigate("econ-calendar") },
    { id: "x",           label: "X Watch",          hint: "tracked accounts", icon: "x", run: () => navigate("x") },
    { id: "info",        label: "Info",             hint: "modules, sources & glossary", icon: "info", run: () => navigate("info") },
    { id: "settings",    label: "Settings",         hint: "config", icon: "settings", run: () => navigate("settings") },
    { id: "refresh",     label: "Refresh all sources", hint: "sync now", icon: "refresh", run: () => refresh() },
    { id: "theme",       label: "Toggle theme", hint: theme === "dark" ? "to light" : "to dark", icon: theme === "dark" ? "sun" : "moon", run: () => toggle() },
    { id: "dyslexia",    label: "Dyslexia-friendly mode", hint: settings.dyslexia ? "on" : "off", icon: "book", run: () => setSetting("dyslexia", !settings.dyslexia) },
  ];

  return (
    <div className={styles.app}>
      <Sidebar view={view} onNavigate={navigate} />

      <main className={styles.main}>
        <div className={styles.band}>
          <TopBar
            title={detailTicker ? `${detailTicker} — analysis` : TITLES[view]}
            sources={sources}
            busy={busy}
            onRefresh={refresh}
            theme={theme}
            onToggleTheme={toggle}
            onSetTheme={setTheme}
            themes={themes}
            dyslexia={settings.dyslexia}
            onToggleDyslexia={() => setSetting("dyslexia", !settings.dyslexia)}
            lean={sentiment?.overall?.lean}
            alerts={alerts}
            unreadAlerts={unreadAlerts}
            onMarkAlertsRead={markAlertsRead}
            onOpenCommand={() => setCmdOpen(true)}
            user={auth?.user}
            onLogout={auth?.logout}
            onNavigate={navigate}
            hasTour={Boolean(TOURS[view]) && !detailTicker}
            onStartTour={() => setTourView(view)}
          />
          <LiveTicker quotes={quotes} asOf={asOf} marketStatus={marketStatus} />
        </div>

        <div className={styles.scroll} ref={scrollRef}>
          <div className={styles.inner}>
            {error && (
              <div className={styles.error} role="alert">
                <Icon name="bell" size={14} /> Backend unreachable: {error}
              </div>
            )}

            <SourceStatus sources={sources} onOpenDetails={openSourceDetails} />

            <AnimatePresence mode="wait" initial={false}>
            {detailTicker ? (
              <motion.div
                key="detail"
                initial={prefersReducedMotion() ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion() ? { opacity: 0 } : { opacity: 0, y: 10 }}
                transition={prefersReducedMotion() ? { duration: 0 } : { duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              >
                <StockDetailPanel
                  ticker={detailTicker}
                  onBack={closeDetail}
                  watchlist={watchlist}
                  onAddWatch={addWatch}
                />
              </motion.div>
            ) : (
              <motion.div
                key="views"
                initial={prefersReducedMotion() ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion() ? { opacity: 0 } : { opacity: 0, y: 10 }}
                transition={prefersReducedMotion() ? { duration: 0 } : { duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              >
            {view === "sentiment" && (
              <MarketSentimentPanel
                sentiment={sentiment} fearGreed={fearGreed} vix={vix} aaii={aaii}
                putCall={putCall} marginDebt={marginDebt} quotes={quotesByTicker}
                loading={loading} busy={busy} onRefresh={refresh}
              />
            )}

            {view === "suggestions" && (
              <SuggestionsPanel data={suggestions} loading={loading} busy={busy} onRefresh={refresh} />
            )}

            {view === "portfolio" && (
              <PortfolioPanel portfolio={portfolio} signals={signals} quotes={quotesByTicker} analyses={analyses} onAdd={addHolding} onEdit={updateHolding} onSetCategory={setHoldingCategory} onRemove={removeHolding} />
            )}

            {view === "trades" && (
              <TradesPanel trades={trades} loading={loading} busy={busy} onRefresh={refresh} />
            )}

            {view === "news" && (
              <NewsPanel news={news} portfolio={portfolio} xPosts={xPosts} loading={loading} busy={busy} onRefresh={refresh} />
            )}

            {view === "settings" && (
              <SettingsPanel settings={settings} setSetting={setSetting} onNavigate={navigate} appSettingsApi={appSettingsApi} user={auth?.user} theme={theme} onSetTheme={setTheme} themes={themes} />
            )}

            {view === "info" && (
              <InfoPanel onNavigate={navigate} sources={sources} />
            )}

            {view === "x" && (
              <XPostsPanel data={xPosts} sources={sources} loading={loading} busy={busy} onRefresh={refresh} />
            )}

            {/* --- Retained but no longer in navigation (reachable only via code) --- */}
            {view === "overview" && (
              <>
                <BoomScorePanel data={boomScores} loading={loading} busy={busy} onRefresh={refresh} compact onViewAll={() => setView("boom-score")} collapsible collapsed={isCollapsed("boom-score")} onToggleCollapse={() => toggleCollapsed("boom-score")} />
                <SuggestionsPanel data={suggestions} loading={loading} busy={busy} onRefresh={refresh} compact onViewAll={() => setView("suggestions")} collapsible collapsed={isCollapsed("suggestions")} onToggleCollapse={() => toggleCollapsed("suggestions")} />
                <StatGrid contracts={contracts} sources={sources} loading={loading} />
                <ContractsPanel contracts={contracts} loading={loading} busy={busy} onRefresh={refresh} compact onViewAll={() => setView("contracts")} collapsible collapsed={isCollapsed("contracts")} onToggleCollapse={() => toggleCollapsed("contracts")} />
                <div className={styles.twoCol}>
                  <TechnicalPanel data={signals} loading={loading} busy={busy} onRefresh={refresh} compact onViewAll={() => setView("signals")} collapsible collapsed={isCollapsed("signals")} onToggleCollapse={() => toggleCollapsed("signals")} />
                  <SeasonalityPanel data={seasonality} settings={settings} quotes={quotesByTicker} loading={loading} busy={busy} onRefresh={refresh} compact onViewAll={() => setView("seasonality")} collapsible collapsed={isCollapsed("seasonality")} onToggleCollapse={() => toggleCollapsed("seasonality")} />
                </div>
                <div className={styles.twoCol}>
                  <YieldCurvePanel data={yieldCurve} loading={loading} busy={busy} onRefresh={refresh} compact onViewAll={() => setView("yield-curve")} collapsible collapsed={isCollapsed("yield-curve")} onToggleCollapse={() => toggleCollapsed("yield-curve")} />
                  <FearGreedPanel data={fearGreed} loading={loading} busy={busy} onRefresh={refresh} compact onViewAll={() => setView("fear-greed")} collapsible collapsed={isCollapsed("fear-greed")} onToggleCollapse={() => toggleCollapsed("fear-greed")} />
                </div>
                <CongressPanel data={congressTrades} loading={loading} busy={busy} onRefresh={refresh} compact onViewAll={() => setView("congress")} collapsible collapsed={isCollapsed("congress")} onToggleCollapse={() => toggleCollapsed("congress")} />
                <div className={styles.twoCol}>
                  <ShortPanel data={shortInterest} loading={loading} busy={busy} onRefresh={refresh} compact onViewAll={() => setView("short")} collapsible collapsed={isCollapsed("short")} onToggleCollapse={() => toggleCollapsed("short")} />
                  <SocialPanel data={social} loading={loading} busy={busy} onRefresh={refresh} compact onViewAll={() => setView("social")} collapsible collapsed={isCollapsed("social")} onToggleCollapse={() => toggleCollapsed("social")} />
                </div>
                <AnalystPanel data={analyst} loading={loading} busy={busy} onRefresh={refresh} compact onViewAll={() => setView("analyst")} collapsible collapsed={isCollapsed("analyst")} onToggleCollapse={() => toggleCollapsed("analyst")} />
                <FundamentalsPanel data={fundamentals} loading={loading} busy={busy} onRefresh={refresh} compact onViewAll={() => setView("fundamentals")} collapsible collapsed={isCollapsed("fundamentals")} onToggleCollapse={() => toggleCollapsed("fundamentals")} />
              </>
            )}
            {view === "contracts" && <ContractsPanel contracts={contracts} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "watchlist" && <WatchlistPanel watchlist={watchlist} quotes={quotesByTicker} marketStatus={marketStatus} onAdd={addWatch} onRemove={removeWatch} />}
            {view === "yield-curve" && <YieldCurvePanel data={yieldCurve} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "econ-calendar" && <EconCalendarPanel data={econCalendar} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "signals" && <TechnicalPanel data={signals} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "fear-greed" && <FearGreedPanel data={fearGreed} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "congress" && <CongressPanel data={congressTrades} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "boom-score" && <BoomScorePanel data={boomScores} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "short" && <ShortPanel data={shortInterest} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "social" && <SocialPanel data={social} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "analyst" && <AnalystPanel data={analyst} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "fundamentals" && <FundamentalsPanel data={fundamentals} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "seasonality" && <SeasonalityPanel data={seasonality} settings={settings} quotes={quotesByTicker} loading={loading} busy={busy} onRefresh={refresh} />}
              </motion.div>
            )}
            </AnimatePresence>
          </div>
        </div>

        <BackToTop scrollRef={scrollRef} />
      </main>

      {cmdOpen && (
        <CommandPalette
          items={commandItems}
          onClose={() => setCmdOpen(false)}
          onOpenTicker={openTickerTab}
        />
      )}

      {tourView && TOURS[tourView] && (
        <Tour steps={TOURS[tourView]} onClose={closeTour} />
      )}
    </div>
  );
}
