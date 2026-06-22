const BASE = "http://localhost:8000";

export async function getContracts() {
  const res = await fetch(`${BASE}/api/contracts`);
  if (!res.ok) throw new Error("failed to load contracts");
  return res.json();
}

export async function getSources() {
  const res = await fetch(`${BASE}/api/sources`);
  if (!res.ok) throw new Error("failed to load sources");
  return res.json();
}

export async function refreshSource(name) {
  const res = await fetch(`${BASE}/api/refresh/${name}`, { method: "POST" });
  if (!res.ok) throw new Error("refresh failed");
  return res.json();
}
