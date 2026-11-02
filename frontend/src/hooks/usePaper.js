import { useCallback, useEffect, useState } from "react";
import { cancelPaperOrder, getPaper, resetPaper } from "../api";

// Resting orders are checked every minute server-side; this is how often the
// tab looks again.
const POLL_MS = 30_000;

/** The paper account: summary, polling, and its actions. */
export function usePaper() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(() => getPaper()
    .then((d) => { setData(d); setError(null); })
    .catch((e) => setError(e.message)), []);

  useEffect(() => {
    reload();
    const id = setInterval(() => { if (!document.hidden) reload(); }, POLL_MS);
    return () => clearInterval(id);
  }, [reload]);

  const reset = useCallback(async (body) => setData(await resetPaper(body)), []);
  const cancel = useCallback(async (id) => { await cancelPaperOrder(id); await reload(); }, [reload]);

  return { data, error, reload, reset, cancel };
}
