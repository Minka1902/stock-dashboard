import Icon from "./Icon";
import Tooltip from "./Tooltip";
import { useMediaQuery } from "../hooks/useMediaQuery";
import styles from "./Sidebar.module.css";

// Below this width the rail collapses to icons (Sidebar.module.css) — that is
// when each item needs a tooltip; at full width it would only repeat the text.
const ICON_ONLY = "(max-width: 900px)";

// Modules in the confirmed flow: mood -> act -> you -> evidence -> radar.
const NAV = [
  { key: "sentiment",   label: "Sentiment",   icon: "gauge",    hint: "the mood" },
  { key: "suggestions", label: "Suggestions", icon: "spark",    hint: "what to do" },
  { key: "suggestion-history", label: "History", icon: "calendar", hint: "what happened next" },
  { key: "portfolio",   label: "Portfolio",   icon: "wallet",   hint: "your book" },
  { key: "trades",      label: "Trades",      icon: "trending", hint: "insiders" },
  { key: "news",        label: "News",        icon: "news",     hint: "the tape" },
  { key: "watchlist",   label: "Watchlist",   icon: "star",     hint: "charts & radar" },
  { key: "econ-calendar", label: "Calendar",  icon: "calendar", hint: "macro events" },
  { key: "earnings",    label: "Earnings",    icon: "contract", hint: "who reports when" },
];

// Server lives in the account menu next to Settings and Info / Guide — the
// three are app-level utilities rather than modules in the flow above.
export default function Sidebar({ view, onNavigate }) {
  const items = NAV;
  const iconOnly = useMediaQuery(ICON_ONLY);
  return (
    <aside className={styles.rail}>
      <div className={styles.brand}>
        <span className={styles.mark}>◆</span>
        <span className={styles.brandName}>SIGNAL</span>
        <span className={styles.brandTag}>terminal</span>
      </div>

      <nav className={styles.nav} data-tour="nav">
        {items.map((item) => {
          const active = view === item.key;
          return (
            <Tooltip key={item.key} side="right" disabled={!iconOnly}
                     content={`${item.label} — ${item.hint}`}>
              <button
                type="button"
                className={`${styles.item} ${active ? styles.active : ""}`}
                onClick={() => onNavigate(item.key)}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
              >
                <Icon name={item.icon} size={17} />
                <span className={styles.label}>{item.label}</span>
                <span className={styles.hint}>{item.hint}</span>
              </button>
            </Tooltip>
          );
        })}
      </nav>

      <div className={styles.footer}>
        <p className={styles.note}>Signals, not predictions.</p>
      </div>
    </aside>
  );
}
