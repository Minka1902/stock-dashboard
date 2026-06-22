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
