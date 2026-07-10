const BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
// Cap every request so a stalled backend surfaces as a clean, predictable error
// (and drives the "Backend unreachable" banner) instead of hanging forever.
const REQUEST_TIMEOUT_MS = 20000;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = "GET", body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: "include", // session cookie
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    // Abort (timeout) or a network-level failure ("Failed to fetch").
    throw new ApiError(
      e.name === "AbortError" ? `request timed out: ${path}` : (e.message || `network error: ${path}`),
      0,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    // A 401 outside the auth endpoints means the session expired mid-use:
    // tell useAuth so the app returns to the login screen cleanly.
    if (res.status === 401 && !path.startsWith("/api/auth/")) {
      window.dispatchEvent(new Event("auth:expired"));
    }
    const detail = (await res.json().catch(() => ({}))).detail;
    throw new ApiError(detail || `request failed: ${path}`, res.status);
  }
  return res.json();
}

const getJSON = (path) => request(path);

export const getContracts = () => getJSON("/api/contracts");
export const getSources = () => getJSON("/api/sources");
export const getNews = () => getJSON("/api/news");
export const getTrades = () => getJSON("/api/trades");
export const getWatchlist = () => getJSON("/api/watchlist");
export const getYieldCurve = () => getJSON("/api/yield-curve");
export const getEconCalendar = () => getJSON("/api/econ-calendar");
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
export const getAnalyses = () => getJSON("/api/analysis");
export const getAnalysis = (ticker) => getJSON(`/api/analysis/${encodeURIComponent(ticker)}`);
export const getBoomScoreHistory = (ticker) => getJSON(`/api/boom-scores/history/${encodeURIComponent(ticker)}`);
export const getPortfolio = () => getJSON("/api/portfolio");
export const getProfile = () => getJSON("/api/profile");
export const getSuggestions = () => getJSON("/api/suggestions");
export const getAppSettings = () => getJSON("/api/settings");
export const getChart = (ticker, interval) =>
  getJSON(`/api/chart/${encodeURIComponent(ticker)}?interval=${encodeURIComponent(interval)}`);
export const analysisReportUrl = (ticker, { print = false } = {}) =>
  `${BASE}/api/analysis/${encodeURIComponent(ticker)}/report${print ? "?print=1" : ""}`;
export const getSuggestionLog = () => getJSON("/api/suggestions/log");
export const getAlerts = () => getJSON("/api/alerts");
export const searchStocks = (q) =>
  getJSON(`/api/search?q=${encodeURIComponent(q)}`);
export const getAnalyze = (ticker) =>
  getJSON(`/api/analyze/${encodeURIComponent(ticker)}`);

export const markAlertsRead = (payload = { all: true }) =>
  request("/api/alerts/read", { method: "POST", body: payload });
export const saveAppSettings = (settings) =>
  request("/api/settings", { method: "PUT", body: settings });
export const saveProfile = (profile) =>
  request("/api/profile", { method: "PUT", body: profile });
export const addHolding = (ticker, shares, avg_cost) =>
  request("/api/portfolio", { method: "POST", body: { ticker, shares, avg_cost } });
export const updateHolding = (ticker, shares, avg_cost) =>
  request(`/api/portfolio/${encodeURIComponent(ticker)}`, {
    method: "PUT",
    body: { shares, avg_cost },
  });
export const removeHolding = (ticker) =>
  request(`/api/portfolio/${encodeURIComponent(ticker)}`, { method: "DELETE" });
export const sendTestSuggestions = () =>
  request("/api/suggestions/send-test", { method: "POST" });
export const refreshSource = (name) =>
  request(`/api/refresh/${encodeURIComponent(name)}`, { method: "POST" });
export const addWatch = (ticker, note) =>
  request("/api/watchlist", { method: "POST", body: { ticker, note } });
export const removeWatch = (ticker) =>
  request(`/api/watchlist/${encodeURIComponent(ticker)}`, { method: "DELETE" });

// ---------- auth ----------
export const getMe = () => getJSON("/api/auth/me");
export const register = (email, password) =>
  request("/api/auth/register", { method: "POST", body: { email, password } });
export const login = (email, password) =>
  request("/api/auth/login", { method: "POST", body: { email, password } });
export const totpSetup = () => getJSON("/api/auth/totp/setup");
export const totpEnable = (code) =>
  request("/api/auth/totp/enable", { method: "POST", body: { code } });
export const totpVerify = (code) =>
  request("/api/auth/totp/verify", { method: "POST", body: { code } });
export const useRecoveryCode = (code) =>
  request("/api/auth/recovery", { method: "POST", body: { code } });
export const logout = () => request("/api/auth/logout", { method: "POST" });
