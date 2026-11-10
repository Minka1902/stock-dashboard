import { call } from "./account.mjs";

// The default list is the long one (it is the list the Watchlist page opens
// on): six core names, then a tail with TASE and dotted/dashed symbols and two
// long notes, so row layout, clipping and the STC-107 scroll path all get real
// content. A second, short list gives the list tabs something to switch to.
const CORE = ["AAPL", "NVDA", "LMT", "PLTR", "MSFT", "TSLA"];
const LONG_TAIL = [
  "TEVA.TA", "BRK-B", "GOOGL", "AMZN", "META", "AMD", "INTC", "BA", "RTX", "GD",
  "NOC", "KTOS", "AVAV", "JPM", "GS", "XOM", "CVX", "PFE", "MRNA", "COIN",
  "SOFI", "RIVN", "NIO", "BABA", "SHOP", "UBER", "ABNB", "DIS", "NFLX", "ICL.TA",
];
const NOTES = {
  AMD: "Watching the data-centre GPU ramp against NVDA; add below the 200-day if the next print holds margins",
  BA: "Waiting for the FAA production cap decision and a clean quarter of deliveries before any position",
};
const SECOND_LIST = { name: "Defense", tickers: ["LMT", "RTX", "NOC", "ESLT"] };
const HOLDINGS = [
  { ticker: "AAPL", shares: 12, avg_cost: 171.4 },
  { ticker: "NVDA", shares: 30, avg_cost: 88.2 },
  { ticker: "LMT", shares: 5, avg_cost: 455 },
  { ticker: "PLTR", shares: 100, avg_cost: 21.7 },
];
const CASH = { currency: "USD", amount: 5000 };

async function fillList(api, listId, tickers) {
  const have = new Set((await call(api, "GET", `/api/watchlist?list_id=${listId}`)).map((w) => w.ticker));
  for (const ticker of tickers.filter((t) => !have.has(t))) {
    await call(api, "POST", "/api/watchlist", { ticker, note: NOTES[ticker] || "", list_id: listId });
  }
}

async function ensureList(api, name) {
  const lists = await call(api, "GET", "/api/watchlists");
  return lists.find((l) => l.name === name)
    || (await call(api, "POST", "/api/watchlists", { name })).find((l) => l.name === name);
}

/** Idempotent: tops up whatever is missing, so a re-run never doubles a position. */
export async function seed(api) {
  const [defaultList] = await call(api, "GET", "/api/watchlists");
  await fillList(api, defaultList.id, [...CORE, ...LONG_TAIL]);
  const second = await ensureList(api, SECOND_LIST.name);
  await fillList(api, second.id, SECOND_LIST.tickers);

  const held = new Set((await call(api, "GET", "/api/portfolio")).map((h) => h.ticker));
  for (const h of HOLDINGS.filter((x) => !held.has(x.ticker))) {
    await call(api, "POST", "/api/portfolio", { ...h, fees: 0, pay_from_cash: false });
  }
  const cash = await call(api, "GET", "/api/portfolio/cash");
  if (!cash.some((c) => c.currency === CASH.currency && c.balance > 0)) {
    await call(api, "POST", "/api/portfolio/cash", { ...CASH, side: "deposit", account: "manual" });
  }
}
