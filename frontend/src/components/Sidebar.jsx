import Icon from "./Icon";
import styles from "./Sidebar.module.css";

const NAV = [
  { key: "overview", label: "Overview", icon: "overview" },
  { key: "contracts", label: "Contracts", icon: "contract" },
  { key: "trades", label: "Trades", icon: "trending" },
  { key: "news", label: "News", icon: "news" },
  { key: "watchlist", label: "Watchlist", icon: "star" },
];

export default function Sidebar({ view, onNavigate }) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.logo}>
          <Icon name="spark" size={18} />
        </span>
        <span className={styles.brandName}>Signal</span>
      </div>

      <nav className={styles.nav}>
        {NAV.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`${styles.item} ${view === item.key ? styles.active : ""}`}
            onClick={() => onNavigate(item.key)}
            aria-current={view === item.key ? "page" : undefined}
          >
            <Icon name={item.icon} size={18} />
            <span className={styles.itemLabel}>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className={styles.footer}>
        <p className={styles.footNote}>Signals, not predictions.</p>
      </div>
    </aside>
  );
}
