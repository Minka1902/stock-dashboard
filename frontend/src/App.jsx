import { useCallback, useEffect, useRef, useState } from "react";
import { useDashboardData } from "./hooks/useDashboardData";
import { useRoute } from "./hooks/useRoute";
import { useLiveQuotes } from "./hooks/useLiveQuotes";
import { useTheme } from "./hooks/useTheme";
import { useSettingsContext } from "./hooks/useSettingsContext";
import { useAppSettings } from "./hooks/useAppSettings";
import { useDocumentTitle } from "./hooks/useDocumentTitle";
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
import SuggestionHistoryPanel from "./components/SuggestionHistoryPanel";
import PortfolioPanel from "./components/PortfolioPanel";
import XPostsPanel from "./components/XPostsPanel";
import InfoPanel from "./components/InfoPanel";
import StockDetailPanel from "./components/StockDetailPanel";
import BackToTop from "./components/BackToTop";
import Tour from "./components/Tour";
import { TOURS } from "./lib/tours";
import { AnimatePresence, motion } from "motion/react";
import { goBack, navigateTo, openTickerTab } from "./lib/nav";
import { DEFAULT_VIEW, TITLES } from "./lib/routes";
import { prefersReducedMotion } from "./lib/motionConfig";
import styles from "./App.module.css";

/**
 * view key -> renderer. Replaces a 25-branch `{view === "x" && <Panel/>}` chain.
 *
 * Every panel takes the same props bag, so adding a view is one entry here plus
 * one title in lib/routes.js — and, crucially, feature branches that add a view
 * no longer all edit the same stretch of JSX and collide.
 */
const VIEWS = {
  sentiment: (p) => (
    <MarketSentimentPanel
      sentiment={p.sentiment} fearGreed={p.fearGreed} vix={p.vix} aaii={p.aaii}
      putCall={p.putCall} marginDebt={p.marginDebt}
      shortInterest={p.shortInterest} social={p.social}
      loading={p.loading} busy={p.busy} onRefresh={p.refresh}
    />
  ),
  suggestions: (p) => (
    <SuggestionsPanel data={p.suggestions} loading={p.loading} busy={p.busy} onRefresh={p.refresh} onAddWatch={p.addWatch} />
  ),
  portfolio: (p) => (
    <PortfolioPanel portfolio={p.portfolio} signals={p.signals} quotes={p.quotesByTicker} analyses={p.analyses} onAdd={p.addHolding} onEdit={p.updateHolding} onSetCategory={p.setHoldingCategory} onRemove={p.removeHolding} />
  ),
  trades: (p) => <TradesPanel trades={p.trades} loading={p.loading} busy={p.busy} onRefresh={p.refresh} />,
  news: (p) => (
    <NewsPanel news={p.news} portfolio={p.portfolio} xPosts={p.xPosts} sources={p.sources} loading={p.loading} busy={p.busy} onRefresh={p.refresh} />
  ),
  "suggestion-history": () => <SuggestionHistoryPanel />,
  settings: (p) => (
    <SettingsPanel settings={p.settings} setSetting={p.setSetting} onNavigate={p.navigate} appSettingsApi={p.appSettingsApi} user={p.user} theme={p.theme} onSetTheme={p.setTheme} themes={p.themes} />
  ),
  info: (p) => <InfoPanel onNavigate={p.navigate} sources={p.sources} />,
  x: (p) => <XPostsPanel data={p.xPosts} sources={p.sources} loading={p.loading} busy={p.busy} onRefresh={p.refresh} />,
  contracts: (p) => <ContractsPanel contracts={p.contracts} loading={p.loading} busy={p.busy} onRefresh={p.refresh} />,
  watchlist: (p) => <WatchlistPanel quotes={p.quotesByTicker} marketStatus={p.marketStatus} />,
  "yield-curve": (p) => <YieldCurvePanel data={p.yieldCurve} loading={p.loading} busy={p.busy} onRefresh={p.refresh} />,
  "econ-calendar": (p) => <EconCalendarPanel data={p.econCalendar} loading={p.loading} busy={p.busy} onRefresh={p.refresh} />,
  signals: (p) => <TechnicalPanel data={p.signals} loading={p.loading} busy={p.busy} onRefresh={p.refresh} />,
  "fear-greed": (p) => <FearGreedPanel data={p.fearGreed} loading={p.loading} busy={p.busy} onRefresh={p.refresh} />,
  congress: (p) => <CongressPanel data={p.congressTrades} loading={p.loading} busy={p.busy} onRefresh={p.refresh} />,
  "boom-score": (p) => <BoomScorePanel data={p.boomScores} loading={p.loading} busy={p.busy} onRefresh={p.refresh} />,
  short: (p) => <ShortPanel data={p.shortInterest} loading={p.loading} busy={p.busy} onRefresh={p.refresh} />,
  social: (p) => <SocialPanel data={p.social} loading={p.loading} busy={p.busy} onRefresh={p.refresh} />,
  analyst: (p) => <AnalystPanel data={p.analyst} loading={p.loading} busy={p.busy} onRefresh={p.refresh} />,
  fundamentals: (p) => <FundamentalsPanel data={p.fundamentals} loading={p.loading} busy={p.busy} onRefresh={p.refresh} />,
  seasonality: (p) => (
    <SeasonalityPanel data={p.seasonality} settings={p.settings} quotes={p.quotesByTicker} loading={p.loading} busy={p.busy} onRefresh={p.refresh} />
  ),
  // Retained but no longer in navigation (reachable by URL or from code).
  overview: (p) => (
    <>
      <BoomScorePanel data={p.boomScores} loading={p.loading} busy={p.busy} onRefresh={p.refresh} compact onViewAll={() => p.navigate("boom-score")} collapsible collapsed={p.isCollapsed("boom-score")} onToggleCollapse={() => p.toggleCollapsed("boom-score")} />
      <SuggestionsPanel data={p.suggestions} loading={p.loading} busy={p.busy} onRefresh={p.refresh} onAddWatch={p.addWatch} compact onViewAll={() => p.navigate("suggestions")} collapsible collapsed={p.isCollapsed("suggestions")} onToggleCollapse={() => p.toggleCollapsed("suggestions")} />
      <StatGrid contracts={p.contracts} sources={p.sources} loading={p.loading} />
      <ContractsPanel contracts={p.contracts} loading={p.loading} busy={p.busy} onRefresh={p.refresh} compact onViewAll={() => p.navigate("contracts")} collapsible collapsed={p.isCollapsed("contracts")} onToggleCollapse={() => p.toggleCollapsed("contracts")} />
      <div className={styles.twoCol}>
        <TechnicalPanel data={p.signals} loading={p.loading} busy={p.busy} onRefresh={p.refresh} compact onViewAll={() => p.navigate("signals")} collapsible collapsed={p.isCollapsed("signals")} onToggleCollapse={() => p.toggleCollapsed("signals")} />
        <SeasonalityPanel data={p.seasonality} settings={p.settings} quotes={p.quotesByTicker} loading={p.loading} busy={p.busy} onRefresh={p.refresh} compact onViewAll={() => p.navigate("seasonality")} collapsible collapsed={p.isCollapsed("seasonality")} onToggleCollapse={() => p.toggleCollapsed("seasonality")} />
      </div>
      <div className={styles.twoCol}>
        <YieldCurvePanel data={p.yieldCurve} loading={p.loading} busy={p.busy} onRefresh={p.refresh} compact onViewAll={() => p.navigate("yield-curve")} collapsible collapsed={p.isCollapsed("yield-curve")} onToggleCollapse={() => p.toggleCollapsed("yield-curve")} />
        <FearGreedPanel data={p.fearGreed} loading={p.loading} busy={p.busy} onRefresh={p.refresh} compact onViewAll={() => p.navigate("fear-greed")} collapsible collapsed={p.isCollapsed("fear-greed")} onToggleCollapse={() => p.toggleCollapsed("fear-greed")} />
      </div>
      <CongressPanel data={p.congressTrades} loading={p.loading} busy={p.busy} onRefresh={p.refresh} compact onViewAll={() => p.navigate("congress")} collapsible collapsed={p.isCollapsed("congress")} onToggleCollapse={() => p.toggleCollapsed("congress")} />
      <div className={styles.twoCol}>
        <ShortPanel data={p.shortInterest} loading={p.loading} busy={p.busy} onRefresh={p.refresh} compact onViewAll={() => p.navigate("short")} collapsible collapsed={p.isCollapsed("short")} onToggleCollapse={() => p.toggleCollapsed("short")} />
        <SocialPanel data={p.social} loading={p.loading} busy={p.busy} onRefresh={p.refresh} compact onViewAll={() => p.navigate("social")} collapsible collapsed={p.isCollapsed("social")} onToggleCollapse={() => p.toggleCollapsed("social")} />
      </div>
      <AnalystPanel data={p.analyst} loading={p.loading} busy={p.busy} onRefresh={p.refresh} compact onViewAll={() => p.navigate("analyst")} collapsible collapsed={p.isCollapsed("analyst")} onToggleCollapse={() => p.toggleCollapsed("analyst")} />
      <FundamentalsPanel data={p.fundamentals} loading={p.loading} busy={p.busy} onRefresh={p.refresh} compact onViewAll={() => p.navigate("fundamentals")} collapsible collapsed={p.isCollapsed("fundamentals")} onToggleCollapse={() => p.toggleCollapsed("fundamentals")} />
    </>
  ),
};

export default function App({ auth }) {
  const data = useDashboardData();
  const appSettingsApi = useAppSettings();
  const { quotes, quotesByTicker, asOf, marketStatus } = useLiveQuotes(
    (appSettingsApi.appSettings.quotes_refresh_seconds || 30) * 1000,
  );
  const { theme, setTheme, toggle, themes } = useTheme();
  const { settings, setSetting, labelFor } = useSettingsContext();
  const [cmdOpen, setCmdOpen] = useState(false);
  const scrollRef = useRef(null);

  // The address bar is the single source of truth for both the current view and
  // the any-ticker detail page (/stock/TICKER), so every view is deep-linkable
  // and survives a reload.
  const route = useRoute();
  const detailTicker = route.kind === "stock" ? route.ticker : null;
  // While a ticker is open the detail page owns the whole screen — sidebar,
  // top bar, tours and the VIEWS switch are all suppressed below — so `view`
  // is unused in that state and needs no "remember where I came from" state.
  // Going back is history.back(), which restores the previous URL anyway.
  const view = route.kind === "view" ? route.view : DEFAULT_VIEW;

  // A path we don't recognise renders the default view, so make the URL agree.
  useEffect(() => {
    if (route.kind === "view" && !route.known) {
      navigateTo({ kind: "view", view: DEFAULT_VIEW }, { replace: true });
    }
  }, [route]);

  const navigate = useCallback((v) => navigateTo({ kind: "view", view: v }), []);

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

  // Back out of the detail page. history.back() keeps the browser's own notion
  // of "back" intact; goBack() falls back to the dashboard when this tab was
  // opened straight onto a ticker and has nothing to return to.
  // (The old code called window.close() first, which never worked: openTickerTab
  // passes "noopener", so the tab has a null opener and the browser refuses.)
  const closeDetail = useCallback(() => goBack(), []);

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

  // Only what App itself renders (chrome, banners, the detail overlay). Panel
  // data reaches the views through `viewProps`, which spreads `data` wholesale.
  const {
    sources, watchlist, sentiment, alerts, unreadAlerts,
    loading, busy, error, refresh, addWatch, markAlertsRead,
  } = data;

  /**
   * Open the stock an alert is about, in this tab, and mark that one alert
   * read. The dedup_key rides along in the URL so the analysis page can scroll
   * to it and highlight it — otherwise you land on a long page with no
   * indication of which alert you followed.
   *
   * Declared after the destructure above: markAlertsRead is a `const` and this
   * closes over it, so hoisting this earlier is a temporal-dead-zone crash.
   */
  const openAlert = useCallback((alert) => {
    markAlertsRead([alert.dedup_key]).catch(() => {});
    navigateTo({ kind: "stock", ticker: alert.ticker, alertKey: alert.dedup_key });
  }, [markAlertsRead]);

  // Only auto-run tours for a genuinely first-time account. Captured once at
  // mount (App mounts only when authed, so auth.user is present) so the value
  // is stable for the session even after we flip the server flag on first close.
  const [tourAllowed] = useState(() => !auth?.user?.onboarded);

  // Auto-run each view's tour the first time it's visited (marked seen on close).
  // Returning users (onboarded) are never auto-toured.
  useEffect(() => {
    if (!tourAllowed || loading || detailTicker || !TOURS[view] || settings.toursSeen[view]) {
      return undefined;
    }
    const id = setTimeout(() => setTourView(view), 450); // let the panel render first
    return () => clearTimeout(id);
  }, [tourAllowed, view, loading, detailTicker, settings.toursSeen]);

  const closeTour = () => {
    if (tourView) {
      setSetting("toursSeen", { ...settings.toursSeen, [tourView]: true });
      // First tour closed → persist onboarding so no device auto-tours again.
      if (auth?.user && !auth.user.onboarded) auth.markOnboarded?.();
    }
    setTourView(null);
  };

  // The analysis view opens in its own tab, so the title has to name the stock
  // or every tab looks identical. Honours the ticker/company-name setting.
  const detailLabel = detailTicker ? labelFor(detailTicker) : null;
  useDocumentTitle(
    detailTicker
      ? (detailLabel && detailLabel !== detailTicker
        ? `${detailTicker} — ${detailLabel}`
        : detailTicker)
      : TITLES[view],
  );

  // One props bag shared by every entry in VIEWS.
  const viewProps = {
    ...data,
    quotesByTicker, marketStatus,
    settings, setSetting, navigate, appSettingsApi,
    user: auth?.user, theme, setTheme, themes,
    isCollapsed, toggleCollapsed,
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
    <div className={styles.app} data-detail={detailTicker ? "yes" : "no"}>
      {/* While a ticker is open the analysis page is the whole screen: no rail,
          no marquee, no top bar. Its own Back button is the way out (Task 19). */}
      {!detailTicker && <Sidebar view={view} onNavigate={navigate} />}

      <main className={styles.main}>
        {!detailTicker && (
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
            onOpenAlert={openAlert}
            onOpenCommand={() => setCmdOpen(true)}
            user={auth?.user}
            onLogout={auth?.logout}
            onNavigate={navigate}
            hasTour={Boolean(TOURS[view]) && !detailTicker}
            onStartTour={() => setTourView(view)}
          />
          <LiveTicker quotes={quotes} asOf={asOf} marketStatus={marketStatus} />
        </div>
        )}

        <div className={styles.scroll} ref={scrollRef}>
          <div className={styles.inner}>
            {error && (
              <div className={styles.error} role="alert">
                <Icon name="bell" size={14} /> Backend unreachable: {error}
              </div>
            )}

            {!detailTicker && <SourceStatus sources={sources} onOpenDetails={openSourceDetails} />}

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
                  // From /stock/X?alert=<dedup_key>: which alert brought you here.
                  focusAlertKey={route.kind === "stock" ? route.alertKey : null}
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
            {(VIEWS[view] || VIEWS[DEFAULT_VIEW])(viewProps)}
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
