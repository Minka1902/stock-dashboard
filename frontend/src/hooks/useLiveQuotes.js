import { useCallback, useEffect, useMemo, useState } from "react";
import { getQuotes } from "../api";

// Faster than the 180s dashboard cycle; the backend caches for ~25s so this
// costs at most one Yahoo fetch per ticker per poll across all clients.
const REFRESH_MS = 30000;

/**
 * Live quotes (incl. pre/post-market) for watchlist + portfolio tickers.
 * Polls independently of useDashboardData; on failure it keeps the last
 * good quotes and retries on the next tick.
 */
export function useLiveQuotes() {
  const [quotes, setQuotes] = useState([]);
  const [asOf, setAsOf] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await getQuotes();
      setQuotes(data.quotes);
      setAsOf(data.as_of);
    } catch {
      // keep showing the last good quotes; next tick retries
    }
  }, []);

  useEffect(() => {
    // Intentional: kick off the initial load on mount, then poll on an interval.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const quotesByTicker = useMemo(
    () => Object.fromEntries(quotes.map((q) => [q.ticker, q])),
    [quotes],
  );

  return { quotes, quotesByTicker, asOf };
}
