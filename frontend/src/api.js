const BASE = "http://localhost:8000";

async function getJSON(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`failed to load ${path}`);
  return res.json();
}

export const getContracts = () => getJSON("/api/contracts");
export const getSources = () => getJSON("/api/sources");
export const getNews = () => getJSON("/api/news");
export const getTrades = () => getJSON("/api/trades");
export const getWatchlist = () => getJSON("/api/watchlist");
export const getYieldCurve = () => getJSON("/api/yield-curve");
export const getSignals = () => getJSON("/api/signals");
export const getFearGreed = () => getJSON("/api/fear-greed");
export const getVix = () => getJSON("/api/vix");
export const getAaii = () => getJSON("/api/aaii");
export const getPutCall = () => getJSON("/api/put-call");
export const getMarginDebt = () => getJSON("/api/margin-debt");
export const getSentiment = () => getJSON("/api/sentiment");
export const getQuotes = () => getJSON("/api/quotes");
export const getCongressTrades = () => getJSON("/api/congress-trades");
export const getShortInterest = () => getJSON("/api/short-interest");
export const getSocial = () => getJSON("/api/social");
export const getAnalyst = () => getJSON("/api/analyst");
export const getBoomScores = () => getJSON("/api/boom-scores");
export const getFundamentals = () => getJSON("/api/fundamentals");
export const getSeasonality = () => getJSON("/api/seasonality");
export const getBoomScoreHistory = (ticker) => getJSON(`/api/boom-scores/history/${ticker}`);
export const getPortfolio = () => getJSON("/api/portfolio");
export const getProfile = () => getJSON("/api/profile");
export const getSuggestions = () => getJSON("/api/suggestions");
export const getSuggestionLog = () => getJSON("/api/suggestions/log");
export const getAlerts = () => getJSON("/api/alerts");

export async function markAlertsRead(payload = { all: true }) {
  const res = await fetch(`${BASE}/api/alerts/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("could not mark alerts read");
  return res.json();
}

export async function saveProfile(profile) {
  const res = await fetch(`${BASE}/api/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "could not save profile");
  return res.json();
}

export async function addHolding(ticker, shares, avg_cost) {
  const res = await fetch(`${BASE}/api/portfolio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, shares, avg_cost }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "could not add holding");
  return res.json();
}

export async function removeHolding(ticker) {
  const res = await fetch(`${BASE}/api/portfolio/${encodeURIComponent(ticker)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("could not remove holding");
  return res.json();
}

export async function sendTestSuggestions() {
  const res = await fetch(`${BASE}/api/suggestions/send-test`, { method: "POST" });
  if (!res.ok) throw new Error("could not send test");
  return res.json();
}

export async function refreshSource(name) {
  const res = await fetch(`${BASE}/api/refresh/${name}`, { method: "POST" });
  if (!res.ok) throw new Error("refresh failed");
  return res.json();
}

export async function addWatch(ticker, note) {
  const res = await fetch(`${BASE}/api/watchlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, note }),
  });
  if (!res.ok) throw new Error("could not add ticker");
  return res.json();
}

export async function removeWatch(ticker) {
  const res = await fetch(`${BASE}/api/watchlist/${encodeURIComponent(ticker)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("could not remove ticker");
  return res.json();
}
