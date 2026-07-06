import { useEffect, useState } from "react";
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
import GuidePanel from "./components/GuidePanel";
import styles from "./App.module.css";

const TITLES = {
  sentiment:   "Market Sentiment",
  overview:    "Overview",
  contracts:   "Contracts",
  trades:      "Trades",
  news:        "News",
  watchlist:   "Watchlist",
  "yield-curve": "Yield Curve",
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
  guide:       "Module Guide",
  settings:    "Settings",
};

// Terminal module numbering for the five primary views.
const MODULE_INDEX = {
  sentiment: "01",
  suggestions: "02",
  portfolio: "03",
  trades: "04",
  news: "05",
};

export default function App() {
  const data = useDashboardData();
  const appSettingsApi = useAppSettings();
  const { quotes, quotesByTicker, asOf } = useLiveQuotes(
    (appSettingsApi.appSettings.quotes_refresh_seconds || 30) * 1000,
  );
  const { theme, toggle } = useTheme();
  const { settings, setSetting } = useSettings();
  const [view, setView] = useState("sentiment");
  const [cmdOpen, setCmdOpen] = useState(false);

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
    yieldCurve, signals, fearGreed, vix, aaii, putCall, marginDebt, sentiment, congressTrades,
    shortInterest, social, analyst, boomScores, fundamentals, seasonality,
    portfolio, suggestions, analyses, alerts, unreadAlerts,
    loading, busy, error, refresh, addWatch, removeWatch, addHolding, removeHolding,
    markAlertsRead,
  } = data;

  const commandItems = [
    { id: "sentiment",   label: "Market Sentiment", hint: "the mood",   icon: "gauge",    run: () => setView("sentiment") },
    { id: "suggestions", label: "Suggestions",      hint: "what to do", icon: "spark",    run: () => setView("suggestions") },
    { id: "portfolio",   label: "Portfolio",        hint: "your book",  icon: "wallet",   run: () => setView("portfolio") },
    { id: "trades",      label: "Trades",           hint: "insiders",   icon: "trending", run: () => setView("trades") },
    { id: "news",        label: "News",             hint: "the tape",   icon: "news",     run: () => setView("news") },
    { id: "settings",    label: "Settings",         hint: "config & guide", icon: "settings", run: () => setView("settings") },
    { id: "refresh",     label: "Refresh all sources", hint: "sync now", icon: "refresh", run: () => refresh() },
    { id: "theme",       label: "Toggle theme", hint: theme === "dark" ? "to light" : "to dark", icon: theme === "dark" ? "sun" : "moon", run: () => toggle() },
    { id: "dyslexia",    label: "Dyslexia-friendly mode", hint: settings.dyslexia ? "on" : "off", icon: "book", run: () => setSetting("dyslexia", !settings.dyslexia) },
  ];

  return (
    <div className={styles.app}>
      <Sidebar view={view} onNavigate={setView} />

      <main className={styles.main}>
        <div className={styles.band}>
          <TopBar
            title={TITLES[view]}
            index={MODULE_INDEX[view]}
            sources={sources}
            busy={busy}
            onRefresh={refresh}
            theme={theme}
            onToggleTheme={toggle}
            dyslexia={settings.dyslexia}
            onToggleDyslexia={() => setSetting("dyslexia", !settings.dyslexia)}
            lean={sentiment?.overall?.lean}
            alerts={alerts}
            unreadAlerts={unreadAlerts}
            onMarkAlertsRead={markAlertsRead}
            onOpenCommand={() => setCmdOpen(true)}
          />
          <LiveTicker quotes={quotes} asOf={asOf} />
        </div>

        <div className={styles.scroll}>
          <div className={styles.inner}>
            {error && (
              <div className={styles.error} role="alert">
                <Icon name="bell" size={14} /> Backend unreachable: {error}
              </div>
            )}

            <SourceStatus sources={sources} />

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
              <PortfolioPanel portfolio={portfolio} signals={signals} quotes={quotesByTicker} analyses={analyses} onAdd={addHolding} onRemove={removeHolding} />
            )}

            {view === "trades" && (
              <TradesPanel trades={trades} loading={loading} busy={busy} onRefresh={refresh} />
            )}

            {view === "news" && (
              <NewsPanel news={news} loading={loading} busy={busy} onRefresh={refresh} />
            )}

            {view === "settings" && (
              <SettingsPanel settings={settings} setSetting={setSetting} onNavigate={setView} appSettingsApi={appSettingsApi} />
            )}

            {view === "guide" && (
              <GuidePanel onNavigate={setView} />
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
                  <SeasonalityPanel data={seasonality} settings={settings} loading={loading} busy={busy} onRefresh={refresh} compact onViewAll={() => setView("seasonality")} collapsible collapsed={isCollapsed("seasonality")} onToggleCollapse={() => toggleCollapsed("seasonality")} />
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
            {view === "watchlist" && <WatchlistPanel watchlist={watchlist} quotes={quotesByTicker} onAdd={addWatch} onRemove={removeWatch} />}
            {view === "yield-curve" && <YieldCurvePanel data={yieldCurve} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "signals" && <TechnicalPanel data={signals} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "fear-greed" && <FearGreedPanel data={fearGreed} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "congress" && <CongressPanel data={congressTrades} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "boom-score" && <BoomScorePanel data={boomScores} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "short" && <ShortPanel data={shortInterest} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "social" && <SocialPanel data={social} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "analyst" && <AnalystPanel data={analyst} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "fundamentals" && <FundamentalsPanel data={fundamentals} loading={loading} busy={busy} onRefresh={refresh} />}
            {view === "seasonality" && <SeasonalityPanel data={seasonality} settings={settings} loading={loading} busy={busy} onRefresh={refresh} />}
          </div>
        </div>
      </main>

      {cmdOpen && <CommandPalette items={commandItems} onClose={() => setCmdOpen(false)} />}
    </div>
  );
}
