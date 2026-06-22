import { useState } from "react";
import { useDashboardData } from "./hooks/useDashboardData";
import { useTheme } from "./hooks/useTheme";
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
};

export default function App() {
  const data = useDashboardData();
  const { theme, toggle } = useTheme();
  const [view, setView] = useState("overview");

  const {
    contracts, sources, news, trades, watchlist,
    yieldCurve, signals, fearGreed, congressTrades,
    loading, busy, error, refresh, addWatch, removeWatch,
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
          />

          {error && (
            <div className={styles.error} role="alert">
              Couldn't reach the backend: {error}
            </div>
          )}

          <SourceStatus sources={sources} />

          {view === "overview" && (
            <>
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
              <CongressPanel data={congressTrades} loading={loading} busy={busy} onRefresh={refresh} />
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
        </div>
      </main>
    </div>
  );
}
