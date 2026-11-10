import { useState } from "react";
import Button from "./Button";
import Dialog from "./Dialog";
import Icon from "./Icon";
import Tooltip from "./Tooltip";
import { useSettingsContext } from "../hooks/useSettingsContext";
import {
  MAX_TABS, MIN_TABS, NAV_GROUPS, PRIMARY_KEYS, phoneNavItems, phoneTabKeys,
} from "../lib/navItems";
import styles from "./MobileNav.module.css";

/**
 * Phone navigation (≤640px; hidden above by CSS): a bottom tab bar with the
 * pinned views plus "More", a sheet listing every view by group. Any 2–5
 * views can be pinned from the sheet (settings.phoneTabs); the five core
 * views are the default. Replaces the desktop rail, which would otherwise
 * take a sixth of a phone's width.
 *
 * Props: view (current key), onNavigate(key), isAdmin (shows Server).
 */
export default function MobileNav({ view, onNavigate, isAdmin = false }) {
  const { settings, setSetting } = useSettingsContext();
  const [moreOpen, setMoreOpen] = useState(false);

  const items = phoneNavItems(isAdmin);
  const pinned = phoneTabKeys(settings.phoneTabs, isAdmin);
  const tabs = pinned.map((k) => items.find((i) => i.key === k));
  const inMore = !pinned.includes(view) && items.some((i) => i.key === view);
  const customised = pinned.join() !== PRIMARY_KEYS.join();

  const go = (key) => {
    setMoreOpen(false);
    onNavigate(key);
  };
  const togglePin = (key) => setSetting("phoneTabs",
    pinned.includes(key) ? pinned.filter((k) => k !== key) : [...pinned, key]);

  return (
    <>
      <nav className={styles.bar} aria-label="Main">
        {tabs.map((item) => (
          <button key={item.key} type="button" className={styles.tab}
                  data-active={view === item.key ? "yes" : "no"}
                  aria-current={view === item.key ? "page" : undefined} aria-label={item.label}
                  onClick={() => go(item.key)}>
            <Icon name={item.icon} size={19} />
            <span className={styles.label} aria-hidden="true">{item.short}</span>
          </button>
        ))}
        <button type="button" className={styles.tab} data-active={inMore || moreOpen ? "yes" : "no"}
                aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}>
          <Icon name="layers" size={19} />
          <span className={styles.label}>More</span>
        </button>
      </nav>

      <Dialog open={moreOpen} title="All views" caption="Navigate" onClose={() => setMoreOpen(false)}>
        <div className={styles.pinNote}>
          <span>Pin {MIN_TABS} to {MAX_TABS} views to the tab bar · {pinned.length} pinned</span>
          {customised && (
            <Button variant="quiet" size="sm" onClick={() => setSetting("phoneTabs", PRIMARY_KEYS)}>
              Reset
            </Button>
          )}
        </div>
        {NAV_GROUPS.map((group) => (
          <section key={group.key} className={styles.group} aria-label={group.label}>
            <h3 className={`caption ${styles.groupHead}`}>{group.label}</h3>
            <ul className={styles.list}>
              {items.filter((i) => i.group === group.key).map((item) => {
                const isPinned = pinned.includes(item.key);
                const locked = isPinned ? pinned.length <= MIN_TABS : pinned.length >= MAX_TABS;
                return (
                  <li key={item.key} className={styles.item}>
                    <button type="button" className={styles.row} data-active={view === item.key ? "yes" : "no"}
                            aria-current={view === item.key ? "page" : undefined} onClick={() => go(item.key)}>
                      <Icon name={item.icon} size={18} />
                      <span className={styles.rowLabel}>{item.label}</span>
                      <span className={styles.rowHint}>{item.hint}</span>
                    </button>
                    <Tooltip side="left" content={isPinned ? "In the tab bar: tap to unpin" : "Tap to pin to the tab bar"}>
                      <button type="button" className={styles.pin} data-on={isPinned ? "yes" : "no"}
                              aria-pressed={isPinned} aria-label={`Pin ${item.label}`} disabled={locked}
                              onClick={() => togglePin(item.key)}>
                        <Icon name="pin" size={16} />
                      </button>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </Dialog>
    </>
  );
}
