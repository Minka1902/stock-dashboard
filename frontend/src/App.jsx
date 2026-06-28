import { useState } from "react";
import { useDashboardData } from "./hooks/useDashboardData";
import { useTheme } from "./hooks/useTheme";
import { useSettings } from "./hooks/useSettings";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import StatGrid from "./components/StatGrid";
import SourceStatus from "./components/SourceStatus";
import ContractsPanel from "./components/ContractsPanel";
import TradesPanel from "./components/TradesPanel";
import NewsPanel from "./components/NewsPanel";
import WatchlistPanel from "./components/WatchlistPanel";
import YieldCurvePanel from "./components/YieldCurvePanel";
import TechnicalPanel from "./components/TechnicalPanel";
import FearGreedPanel from "./components/FearGreedPanel";
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
import styles from "./App.module.css";

const TITLES = {
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
  settings:    "Settings",
};

export default function App() {
  const data = useDashboardData();
  const { theme, toggle } = useTheme();
  const { settings, setSetting } = useSettings();
  const [view, setView] = useState("overview");

  const {
    contracts, sources, news, trades, watchlist,
    yieldCurve, signals, fearGreed, congressTrades,
    shortInterest, social, analyst, boomScores, fundamentals, seasonality,
    portfolio, suggestions,
    loading, busy, error, refresh, addWatch, removeWatch, addHolding, removeHolding,
  } = data;

  return (
    <div className={styles.app}>
      <Sidebar view={view} onNavigate={setView} />

      <main className={styles.main}>
        <div className={styles.inner}>
          <TopBar
            title={TITLES[view]}
            sources={sources}
            busy={busy}
            onRefresh={refresh}
            theme={theme}
            onToggleTheme={toggle}
            dyslexia={settings.dyslexia}
            onToggleDyslexia={() => setSetting("dyslexia", !settings.dyslexia)}
          />

          {error && (
            <div className={styles.error} role="alert">
              Couldn't reach the backend: {error}
            </div>
          )}

          <SourceStatus sources={sources} />

          {view === "overview" && (
            <>
              <BoomScorePanel data={boomScores} loading={loading} busy={busy} onRefresh={refresh} />
              <SuggestionsPanel data={suggestions} loading={loading} busy={busy} onRefresh={refresh} />
              <StatGrid contracts={contracts} sources={sources} loading={loading} />
              <ContractsPanel contracts={contracts} loading={loading} busy={busy} onRefresh={refresh} />
              <div className={styles.twoCol}>
                <TradesPanel trades={trades} loading={loading} busy={busy} onRefresh={refresh} />
                <NewsPanel news={news} loading={loading} busy={busy} onRefresh={refresh} />
              </div>
              <div className={styles.twoCol}>
                <YieldCurvePanel data={yieldCurve} loading={loading} busy={busy} onRefresh={refresh} />
                <FearGreedPanel data={fearGreed} loading={loading} busy={busy} onRefresh={refresh} />
              </div>
              <TechnicalPanel data={signals} loading={loading} busy={busy} onRefresh={refresh} />
              <SeasonalityPanel data={seasonality} settings={settings} loading={loading} busy={busy} onRefresh={refresh} />
              <CongressPanel data={congressTrades} loading={loading} busy={busy} onRefresh={refresh} />
              <div className={styles.twoCol}>
                <ShortPanel data={shortInterest} loading={loading} busy={busy} onRefresh={refresh} />
                <SocialPanel data={social} loading={loading} busy={busy} onRefresh={refresh} />
              </div>
              <AnalystPanel data={analyst} loading={loading} busy={busy} onRefresh={refresh} />
              <FundamentalsPanel data={fundamentals} loading={loading} busy={busy} onRefresh={refresh} />
            </>
          )}

          {view === "contracts" && (
            <ContractsPanel contracts={contracts} loading={loading} busy={busy} onRefresh={refresh} />
          )}

          {view === "trades" && (
            <TradesPanel trades={trades} loading={loading} busy={busy} onRefresh={refresh} />
          )}

          {view === "news" && (
            <NewsPanel news={news} loading={loading} busy={busy} onRefresh={refresh} />
          )}

          {view === "watchlist" && (
            <WatchlistPanel watchlist={watchlist} onAdd={addWatch} onRemove={removeWatch} />
          )}

          {view === "yield-curve" && (
            <YieldCurvePanel data={yieldCurve} loading={loading} busy={busy} onRefresh={refresh} />
          )}

          {view === "signals" && (
            <TechnicalPanel data={signals} loading={loading} busy={busy} onRefresh={refresh} />
          )}

          {view === "fear-greed" && (
            <FearGreedPanel data={fearGreed} loading={loading} busy={busy} onRefresh={refresh} />
          )}

          {view === "congress" && (
            <CongressPanel data={congressTrades} loading={loading} busy={busy} onRefresh={refresh} />
          )}

          {view === "boom-score" && (
            <BoomScorePanel data={boomScores} loading={loading} busy={busy} onRefresh={refresh} />
          )}

          {view === "short" && (
            <ShortPanel data={shortInterest} loading={loading} busy={busy} onRefresh={refresh} />
          )}

          {view === "social" && (
            <SocialPanel data={social} loading={loading} busy={busy} onRefresh={refresh} />
          )}

          {view === "analyst" && (
            <AnalystPanel data={analyst} loading={loading} busy={busy} onRefresh={refresh} />
          )}

          {view === "fundamentals" && (
            <FundamentalsPanel data={fundamentals} loading={loading} busy={busy} onRefresh={refresh} />
          )}

          {view === "seasonality" && (
            <SeasonalityPanel data={seasonality} settings={settings} loading={loading} busy={busy} onRefresh={refresh} />
          )}

          {view === "suggestions" && (
            <SuggestionsPanel data={suggestions} loading={loading} busy={busy} onRefresh={refresh} />
          )}

          {view === "portfolio" && (
            <PortfolioPanel portfolio={portfolio} signals={signals} onAdd={addHolding} onRemove={removeHolding} />
          )}

          {view === "settings" && (
            <SettingsPanel settings={settings} setSetting={setSetting} onNavigate={setView} />
          )}
        </div>
      </main>
    </div>
  );
}
