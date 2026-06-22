import { useEffect, useState, useCallback } from "react";
import { getContracts, getSources, refreshSource } from "./api";
import "./App.css";

const REFRESH_MS = 180000; // 3 minutes, matches backend default

function formatAmount(n) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatWhen(iso) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString();
}

export default function App() {
  const [contracts, setContracts] = useState([]);
  const [sources, setSources] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([getContracts(), getSources()]);
      setContracts(c);
      setSources(s);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  async function handleRefresh() {
    setBusy(true);
    try {
      await refreshSource("usaspending");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Stock Signal Dashboard</h1>
        <button onClick={handleRefresh} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh now"}
        </button>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="sources">
        <h2>Data sources</h2>
        <ul>
          {sources.length === 0 && <li>No data yet — click "Refresh now".</li>}
          {sources.map((s) => (
            <li key={s.source}>
              <strong>{s.source}</strong> — {s.status} · {s.record_count} records ·
              last refreshed {formatWhen(s.last_refreshed_at)}
            </li>
          ))}
        </ul>
      </section>

      <section className="contracts">
        <h2>Biggest recent federal contracts</h2>
        <table>
          <thead>
            <tr>
              <th>Recipient</th><th>Agency</th><th>Amount</th><th>Start</th><th>Award ID</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.external_id}>
                <td>{c.recipient_name}</td>
                <td>{c.awarding_agency}</td>
                <td className="amount">{formatAmount(c.amount)}</td>
                <td>{c.start_date || "—"}</td>
                <td>{c.award_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
