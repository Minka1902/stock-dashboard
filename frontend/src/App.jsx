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
import styles from "./App.module.css";

const TITLES = {
  overview: "Overview",
  contracts: "Contracts",
  trades: "Trades",
  news: "News",
  watchlist: "Watchlist",
};

export default function App() {
  const data = useDashboardData();
  const { theme, toggle } = useTheme();
  const [view, setView] = useState("overview");

  const {
    contracts, sources, news, trades, watchlist,
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
              Couldn’t reach the backend: {error}
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
        </div>
      </main>
    </div>
  );
}
