// Deep-link helpers for the standalone analyze tab (#/stock/TICKER).

export const STOCK_HASH_RE = /^#\/stock\/([A-Za-z0-9.-]{1,10})$/;

/** Parse the current URL hash into a ticker, or null. */
export function parseStockHash() {
  const m = STOCK_HASH_RE.exec(window.location.hash);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Open a ticker's analyze view in a new tab. Called from direct user gestures
 * (clicks) so popup blockers don't interfere.
 */
export function openTickerTab(ticker) {
  window.open(
    `${window.location.pathname}#/stock/${encodeURIComponent(ticker)}`,
    "_blank",
    "noopener",
  );
}
