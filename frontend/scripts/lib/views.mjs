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
  watchlist: [{ name: "the first watch row", selector: "#watchlist ul > li" }],
  // Trading Bot: each tab's primary content. The fixture's account has no
  // bots, an unfunded paper account, no broker, no matches and no audit
  // entries, so the empty states stand in where there are no rows.
  "trading-bot": [
    { name: "the first bot or New bot", selector: "#trading-bot article[data-card], #trading-bot [data-empty] button", whole: true },
  ],
  "trading-bot?tab=risk": [
    { name: "the kill switch", selector: "#trading-bot [data-kill-switch]", whole: true },
    { name: "the drawdown switch state", selector: '#trading-bot section[aria-labelledby="dd-title"] header', whole: true },
  ],
  "trading-bot?tab=paper": [{ name: "the account summary", selector: '#trading-bot section[aria-label="Paper account"]' }],
  "trading-bot?tab=broker": [{ name: "the broker account", selector: '#trading-bot [role="tabpanel"] > :first-child' }],
  "trading-bot?tab=performance": [{ name: "the metrics", selector: '#trading-bot section[aria-labelledby="perf-title"] dl' }],
  "trading-bot?tab=rules": [{ name: "the saved rules", selector: '#trading-bot section[aria-labelledby="saved-rules"]' }],
  "trading-bot?tab=lots": [{ name: "the first tax lot", selector: '#trading-bot section[aria-labelledby="lots-title"] li' }],
  "trading-bot?tab=scanner": [
    { name: "the first match", selector: '#trading-bot section[aria-label="Scanner matches"] :is(li, p)' },
  ],
  "trading-bot?tab=audit": [
    { name: "the first log row", selector: '#trading-bot [role="tabpanel"] :is(ol > li, div > p:last-child)' },
  ],
  // Reference views. The fixture's econ calendar and X sources failed where
  // it was recorded, so their empty states stand in for the first row.
  "suggestion-history": [{ name: "the month calendar", selector: '#suggestion-history [role="grid"]' }],
  "econ-calendar": [{ name: "the first event", selector: "#econ-calendar ul > li, #econ-calendar > header + div" }],
  earnings: [{ name: "the first reporting day", selector: '#earnings ul[aria-label="Earnings by date"] > li' }],
  x: [{ name: "the first post", selector: "#x > ul > li, #x > div:last-child" }],
  // Signal pages: the first row, or (contracts, yield curve, congress: no
  // data where the fixture was recorded) the source's empty state.
  contracts: [{ name: "the first contract", selector: "#contracts li, #contracts > header + div" }],
  "yield-curve": [{ name: "the spread chart", selector: "#yield-curve > header + div", whole: true }],
  signals: [{ name: "the first ticker", selector: "#signals li" }],
  "fear-greed": [{ name: "the score and scale", selector: "#fear-greed > header + div", whole: true }],
  congress: [{ name: "the first trade", selector: "#congress li, #congress > header + div" }],
  short: [{ name: "the first ticker", selector: "#short-interest li" }],
  social: [{ name: "the first ticker", selector: "#social li, #social > header + div" }],
  analyst: [{ name: "the first ticker", selector: "#analyst li" }],
  fundamentals: [{ name: "the first ticker", selector: "#fundamentals li" }],
  // Long pages, folded on a phone: the first row leads, the rest is behind
  // Show all, a folded section or the Overview's section index.
  seasonality: [{ name: "the first ticker", selector: "#seasonality li" }],
  "boom-score": [{ name: "the first ticker", selector: "#boom-score li" }],
  investors: [{ name: "the first move", selector: "#investors li" }],
  overview: [
    { name: "the section index", selector: 'nav[aria-label="Sections on this page"]', whole: true },
    { name: "the first Boom Score", selector: "#boom-score li" },
  ],
  // Sign-in screens: the field the step asks for, whole.
  "auth/login": [{ name: "the email field", selector: 'input[type="email"]', whole: true }],
  "auth/register": [{ name: "the email field", selector: 'input[type="email"]', whole: true }],
  "auth/totp-setup": [{ name: "the code field", selector: 'input[autocomplete="one-time-code"]', whole: true }],
  "auth/totp-challenge": [{ name: "the code field", selector: 'input[autocomplete="one-time-code"]', whole: true }],
  ...Object.fromEntries(STOCKS.map((t) => [`stock/${t}`, [
    { name: "the chart", selector: '[data-anchor="chart"] canvas', whole: true },
  ]])),
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
