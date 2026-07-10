import Icon from "./Icon";
import styles from "./Sidebar.module.css";

// Modules in the confirmed flow: mood -> act -> you -> evidence -> radar.
const NAV = [
  { key: "sentiment",   label: "Sentiment",   icon: "gauge",    hint: "the mood" },
  { key: "suggestions", label: "Suggestions", icon: "spark",    hint: "what to do" },
  { key: "portfolio",   label: "Portfolio",   icon: "wallet",   hint: "your book" },
  { key: "trades",      label: "Trades",      icon: "trending", hint: "insiders" },
  { key: "news",        label: "News",        icon: "news",     hint: "the tape" },
  { key: "watchlist",   label: "Watchlist",   icon: "star",     hint: "charts & radar" },
  { key: "econ-calendar", label: "Calendar",  icon: "calendar", hint: "macro events" },
];

export default function Sidebar({ view, onNavigate }) {
  return (
    <aside className={styles.rail}>
      <div className={styles.brand}>
        <span className={styles.mark}>◆</span>
        <span className={styles.brandName}>SIGNAL</span>
        <span className={styles.brandTag}>terminal</span>
      </div>

      <nav className={styles.nav} data-tour="nav">
        {NAV.map((item, i) => {
          const active = view === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={`${styles.item} ${active ? styles.active : ""}`}
              onClick={() => onNavigate(item.key)}
              aria-current={active ? "page" : undefined}
            >
              <span className={styles.index}>{String(i + 1).padStart(2, "0")}</span>
              <Icon name={item.icon} size={17} />
              <span className={styles.label}>{item.label}</span>
              <span className={styles.hint}>{item.hint}</span>
            </button>
          );
        })}
      </nav>

      <div className={styles.footer}>
        <button
          type="button"
          className={`${styles.gear} ${view === "info" ? styles.active : ""}`}
          onClick={() => onNavigate("info")}
          aria-current={view === "info" ? "page" : undefined}
        >
          <Icon name="info" size={16} />
          <span className={styles.label}>Info</span>
        </button>
        <button
          type="button"
          className={`${styles.gear} ${view === "settings" ? styles.active : ""}`}
          onClick={() => onNavigate("settings")}
          aria-current={view === "settings" ? "page" : undefined}
        >
          <Icon name="settings" size={16} />
          <span className={styles.label}>Settings</span>
        </button>
        <p className={styles.note}>Signals, not predictions.</p>
      </div>
    </aside>
  );
}
