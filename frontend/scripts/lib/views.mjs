import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TITLES } from "../../src/lib/routes.js";

// The route table is read from the app itself, so a new view or Trading Bot
// tab is covered without touching the harness.
const TRADING_BOT_SOURCE = fileURLToPath(new URL("../../src/components/TradingBotPanel.jsx", import.meta.url));
const STOCKS = ["AAPL", "TEVA.TA"];
// The two-factor screens exist only in the SPA's memory after a password
// sign-in (a reload lands on the login form), so they are reached through the
// form: `tab` opens an auth-form tab, `signIn` names the account to sign in
// with (see account.mjs).
const AUTH_SCREENS = [
  { id: "auth/login" },
  { id: "auth/register", tab: "Create account" },
  { id: "auth/totp-setup", signIn: "setup" },
  { id: "auth/totp-challenge", signIn: "main" },
];

/**
 * What each core view must show in its first screen at 390x844 (PRODUCT.md:
 * one glance, one decision): `{ name, selector, whole? }` per view. The first
 * visible match's top (its bottom too with `whole`) must sit within the
 * page scroller's first viewport, above the tab bar.
 */
export const FIRST_SCREEN_WIDTH = 390;
export const FIRST_SCREEN = {
  sentiment: [
    { name: "the read", selector: "#sentiment h2" },
    { name: "the gauge", selector: '#sentiment svg[role="img"]', whole: true },
  ],
  suggestions: [{ name: "the first idea", selector: "#suggestions li" }],
  portfolio: [
    { name: "the equity total", selector: "#portfolio [data-card]" },
    { name: "the first holding", selector: "#portfolio ul[aria-label] > li" },
  ],
  trades: [{ name: "the first trade", selector: "#trades li" }],
  // The recorded fixture has no headlines (GDELT and X are blocked where it
  // was recorded), so the empty state stands in for the first headline.
  news: [{ name: "the first headline", selector: '#news li, #news [data-error="no"]' }],
};

function tradingBotTabs() {
  const block = /const TABS = \{([\s\S]*?)\n\};/.exec(readFileSync(TRADING_BOT_SOURCE, "utf8"));
  const keys = block ? [...block[1].matchAll(/^ {2}([\w-]+): \{/gm)].map((m) => m[1]) : [];
  if (!keys.length) throw new Error(`could not read the TABS keys from ${TRADING_BOT_SOURCE}`);
  return keys;
}

/**
 * Every place the harness visits: `{ id, path, anon?, tab?, signIn? }`. The
 * first Trading Bot tab is what /trading-bot itself shows, so it is not
 * visited twice.
 */
export function allViews() {
  const [, ...tabs] = tradingBotTabs();
  return [
    ...Object.keys(TITLES).map((v) => ({ id: v, path: `/${v}` })),
    ...tabs.map((t) => ({ id: `trading-bot?tab=${t}`, path: `/trading-bot?tab=${t}` })),
    ...STOCKS.map((t) => ({ id: `stock/${t}`, path: `/stock/${t}` })),
    ...AUTH_SCREENS.map((s) => ({ ...s, path: "/", anon: true })),
  ];
}

export function fileStem(viewId) {
  return viewId.replace(/[^\w.-]+/g, "_");
}
