# Three ideas to improve the analysis process

Status: **documented, not yet implemented** (agreed 2026-07-06). Each idea keeps the
core product principle — signals with visible reasoning, never black-box scores or
fabricated data — and each sketch reuses infrastructure that already exists.

---

## 1. Backtested per-signal hit-rates (self-validating signals)

**Problem.** The engine says "MACD crossed up — momentum turning", but never says how
often that call has actually been right *for this ticker*. All `WEIGHTS` in
`boom_score.py` and the conviction increments in `analysis.py` are hand-picked
constants.

**Idea.** Walk the stored OHLC history (`ohlc_series`, 2 years daily) per ticker;
re-run each detector (golden cross, MACD crossover, RSI recovery zone, pattern hits,
gap events) at every historical bar; measure the forward return over 5/20/60 sessions
after each firing. Persist per-ticker, per-signal stats:

```
signal_stats(ticker, signal, window_days, fired_count, win_rate, avg_return, computed_at)
```

**Surface it.** Next to every reason line: *"MACD cross-up — right 62% of the time on
NOC over 20 days (18 firings)"*. Low-sample signals (< 10 firings) show "insufficient
history" instead of a percentage. Longer term, the measured win rates can replace the
hand-tuned weights (evidence-based re-weighting), with the static weights kept as the
fallback when history is thin.

**Fits where.** A new pure module `app/backtest.py` (same style as `analysis.py`),
computed inside the existing `analysis` source cycle (it is DB-only, no network); one
new table + `GET /api/signal-stats/{ticker}`; reason strings extended in
`analysis.build`.

---

## 2. Multi-timeframe confluence (weekly confirms daily)

**Problem.** The directive is computed from daily bars alone. A textbook-bullish daily
setup inside a weekly downtrend is a much weaker trade — classic top-down analysis
(Elder's triple-screen) exists precisely to filter these.

**Idea.** The weekly series is already stored (`ohlc_series interval='weekly'`).
Compute the same trend stack on it (MA alignment, trend direction, RSI zone). Then:

- `Accumulate` requires the weekly trend to be `up` or at least not `down`
  (otherwise the directive is capped at `Hold` and the reason says why);
- conviction gets a confluence bonus (+10 when daily and weekly agree, −10 when they
  conflict), always with an explicit reason line;
- the UI shows a small "weekly ✓ / weekly ✗" badge beside the directive, and the
  report gains a "Timeframe confluence" row.

**Fits where.** `analysis.build` gains an optional `weekly: list[OHLCBar]` argument
(callers in `main.analysis_fetch` and the report already have the weekly series);
pure helpers stay unit-testable with synthetic bars.

---

## 3. Relative strength vs SPY (leaders over laggards)

**Problem.** "Trend is up" in a roaring bull market is not information — everything
is up. What separates winners is *relative* strength: outperforming the benchmark,
especially in weak tape.

**Idea.** Fetch/store SPY daily bars once per cycle (the chart endpoint already
fetches SPY on demand; persist it like any holding's series). Per ticker compute
RS over 21/63/126 sessions:

```
rs_63 = (ticker_return_63d - spy_return_63d)
```

- a positive-RS regime adds conviction (+8, with the reason "outperforming SPY by
  +12.4% over 3 months");
- bullish directives are suppressed one notch for laggards when SPY itself is below
  its 50-day MA (weak tape + weak stock = pass);
- Boom Score gains an `rs_leader` component so the watchlist ranking favors leaders;
- the UI sorts the portfolio by RS and colors the new "RS" column.

**Fits where.** SPY storage piggybacks on the existing `ohlc` source (add SPY to the
fetched tickers); a pure `relative_strength(ticker_bars, spy_bars, window)` helper in
`analysis.py`; one new component in `boom_score.WEIGHTS` (registered after `ohlc` in
`SOURCES`, which is already the case for `boom_score`).

---

### Suggested build order

1 → 3 → 2. Hit-rates (idea 1) pay for themselves immediately by exposing which
current signals are weak on your actual tickers; relative strength (3) is the
cheapest to add; confluence (2) changes directive semantics, so it benefits from the
hit-rate telemetry existing first to prove it helps.
