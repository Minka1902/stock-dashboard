// Routing: real History API paths (/news, /stock/NVDA), no hash.
//
// Deliberately hand-rolled rather than react-router. The whole surface is a flat
// list of views plus one parameterised route; a router library would buy nested
// routes, loaders and data APIs that this app does not use, in exchange for
// restructuring App.jsx around <Routes>. The server side already cooperates:
// the SPA catch-all in app/main.py returns index.html for any non-/api path.

import { DEFAULT_VIEW, isViewKey } from "./routes";

const STOCK_SEGMENT = "stock";
const TICKER_RE = /^[A-Za-z0-9.-]{1,10}$/;

/** Legacy hash form, kept solely so old tabs and bookmarks can be migrated. */
export const STOCK_HASH_RE = /^#\/stock\/([A-Za-z0-9.-]{1,10})$/;

/** Fired after a programmatic navigation; pushState/replaceState emit no event. */
const NAV_EVENT = "app:navigate";

/**
 * Parse a location into a route.
 *
 * @returns {{kind: "stock", ticker: string, alertKey: string|null}
 *          |{kind: "view", view: string, known: boolean}}
 */
export function parseRoute(pathname = window.location.pathname, search = window.location.search) {
  const segments = pathname.split("/").filter(Boolean);
  const params = new URLSearchParams(search);

  if (segments[0] === STOCK_SEGMENT && segments[1]) {
    const raw = decodeURIComponent(segments[1]);
    if (TICKER_RE.test(raw)) {
      return { kind: "stock", ticker: raw.toUpperCase(), alertKey: params.get("alert") };
    }
  }

  if (segments.length === 0) return { kind: "view", view: DEFAULT_VIEW, known: true };
  const view = segments[0];
  // `known: false` lets the app rewrite a junk URL to "/" instead of rendering
  // a blank screen for a typo'd path.
  return { kind: "view", view: isViewKey(view) ? view : DEFAULT_VIEW, known: isViewKey(view) };
}

/** Build the path for a route. The inverse of parseRoute. */
export function routeToPath(route) {
  if (typeof route === "string") return route.startsWith("/") ? route : `/${route}`;
  if (route.kind === "stock") {
    const q = route.alertKey ? `?alert=${encodeURIComponent(route.alertKey)}` : "";
    return `/${STOCK_SEGMENT}/${encodeURIComponent(route.ticker)}${q}`;
  }
  return route.view === DEFAULT_VIEW ? "/" : `/${route.view}`;
}

/** Navigate in the current tab and tell subscribers. */
export function navigateTo(route, { replace = false } = {}) {
  const path = routeToPath(route);
  if (path === window.location.pathname + window.location.search) return;
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.dispatchEvent(new Event(NAV_EVENT));
}

/** Go back if there's history to go back to, else replace with a fallback. */
export function goBack(fallback = { kind: "view", view: DEFAULT_VIEW }) {
  // history.length > 1 means this tab has somewhere to return to. A ticker tab
  // opened with target=_blank starts at length 1, so it falls through to the
  // dashboard instead of leaving the user on a dead end.
  if (window.history.length > 1) {
    window.history.back();
    return;
  }
  navigateTo(fallback, { replace: true });
}

/**
 * Open a ticker's analysis view in a new tab. Called from direct user gestures
 * (clicks) so popup blockers don't interfere.
 */
export function openTickerTab(ticker) {
  window.open(routeToPath({ kind: "stock", ticker }), "_blank", "noopener");
}

/**
 * Rewrite a legacy #/stock/TICKER URL to /stock/TICKER.
 *
 * Called once before first paint. Without it, every bookmark and still-open tab
 * from the hash era would land on the dashboard instead of its stock.
 */
export function migrateHashUrl() {
  const match = STOCK_HASH_RE.exec(window.location.hash);
  if (!match) return false;
  window.history.replaceState(
    null, "", routeToPath({ kind: "stock", ticker: match[1].toUpperCase() }));
  return true;
}

// ---- useSyncExternalStore plumbing ----

export function subscribeToRoute(callback) {
  window.addEventListener("popstate", callback);
  window.addEventListener(NAV_EVENT, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(NAV_EVENT, callback);
  };
}

/**
 * A string, not a parsed object, on purpose: getSnapshot must return an
 * Object.is-stable value while the store is unchanged, and a fresh object every
 * call would re-render forever.
 */
export function getRouteSnapshot() {
  return window.location.pathname + window.location.search;
}
