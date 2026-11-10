// The app's module navigation, shared by the desktop rail (Sidebar) and the
// phone tab bar (MobileNav). Modules in the confirmed flow:
// mood -> act -> you -> evidence -> radar.
// `short` is the phone tab label (a sixth of a phone's width); `group` is the
// heading it sits under in the phone's More sheet (NAV_GROUPS).
export const NAV_ITEMS = [
  { key: "sentiment",   label: "Sentiment",   icon: "gauge",    hint: "the mood", short: "Mood", group: "modules" },
  { key: "suggestions", label: "Suggestions", icon: "spark",    hint: "what to do", short: "Ideas", group: "modules" },
  { key: "suggestion-history", label: "History", icon: "calendar", hint: "what happened next", short: "History", group: "tools" },
  { key: "portfolio",   label: "Portfolio",   icon: "wallet",   hint: "your book", short: "Portfolio", group: "modules" },
  { key: "trading-bot", label: "Trading Bot", icon: "bot",      hint: "demo strategies", short: "Bot", group: "tools" },
  { key: "trades",      label: "Trades",      icon: "trending", hint: "insiders", short: "Trades", group: "modules" },
  { key: "news",        label: "News",        icon: "news",     hint: "the tape", short: "News", group: "modules" },
  { key: "watchlist",   label: "Watchlist",   icon: "star",     hint: "charts & radar", short: "Watch", group: "modules" },
  { key: "econ-calendar", label: "Calendar",  icon: "calendar", hint: "macro events", short: "Calendar", group: "tools" },
  { key: "earnings",    label: "Earnings",    icon: "contract", hint: "who reports when", short: "Earnings", group: "tools" },
];

// The five things the user acts on (PRODUCT.md): the phone tab bar's tabs
// until the user pins others (settings.phoneTabs, see phoneTabKeys).
export const PRIMARY_KEYS = ["sentiment", "suggestions", "portfolio", "trades", "news"];

// App-level utilities, kept out of the module flow (account menu on desktop).
export const UTILITY_ITEMS = [
  { key: "x",        label: "X Watch",  icon: "x",        hint: "tracked accounts", short: "X", group: "tools" },
  { key: "settings", label: "Settings", icon: "settings", hint: "config", short: "Settings", group: "app" },
  { key: "info",     label: "Info",     icon: "info",     hint: "modules, sources & glossary", short: "Info", group: "app" },
  { key: "server",   label: "Server",   icon: "layers",   hint: "health & errors", short: "Server", group: "app", admin: true },
];

export const NAV_GROUPS = [
  { key: "modules", label: "Modules" },
  { key: "tools", label: "Tools" },
  { key: "app", label: "App" },
];

// How many views the phone tab bar holds besides "More".
export const MIN_TABS = 2;
export const MAX_TABS = 5;

/** Every view the phone can navigate to, for this user. */
export function phoneNavItems(isAdmin) {
  return [...NAV_ITEMS, ...UTILITY_ITEMS.filter((u) => !u.admin || isAdmin)];
}

/**
 * The tab bar's views, in order: the saved pins that still name a view this
 * user can open, or the default five when that leaves too few or too many.
 */
export function phoneTabKeys(saved, isAdmin) {
  const allowed = new Set(phoneNavItems(isAdmin).map((i) => i.key));
  const keys = Array.isArray(saved) ? [...new Set(saved)].filter((k) => allowed.has(k)) : [];
  return keys.length >= MIN_TABS && keys.length <= MAX_TABS ? keys : PRIMARY_KEYS;
}
