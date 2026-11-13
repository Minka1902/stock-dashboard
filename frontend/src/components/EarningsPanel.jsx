import { useEffect, useMemo, useState } from "react";
import Dialog from "./Dialog";
import Icon from "./Icon";
import PanelInfo from "./PanelInfo";
import Skeleton from "./Skeleton";
import TickerLabel from "./TickerLabel";
import { getEarnings } from "../api";
import { PHONE, useMediaQuery } from "../hooks/useMediaQuery";
import { DAY_NAMES, monthGrid, monthLabel } from "../lib/calendarGrid";
import { openTickerTab } from "../lib/nav";
import styles from "./EarningsPanel.module.css";
import Tooltip from "./Tooltip";
import Term from "./Term";

const BLURB = "Who reports and when — your holdings and watchlist, plus the large caps that move the market.";
const CELL_TICKERS = 4;
const KIND_LABEL = { held: "held", watched: "watched", major: "large cap" };
const TIMING_LABEL = { bmo: "before open", amc: "after close", intraday: "during hours" };

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** held > watched > major — which of your names is reporting matters most. */
function rank(e) {
  if (e.held) return 0;
  if (e.watched) return 1;
  return 2;
}

function kindOf(e) {
  if (e.held) return "held";
  return e.watched ? "watched" : "major";
}

/** A day's reporters as chips, the first `max` of them and a "+N" for the rest. */
function tickerChips(list, max = list.length) {
  return (
    <span className={styles.cellTickers}>
      {list.slice(0, max).map((e) => (
        <span
          key={e.ticker}
          className={styles.chipTicker}
          data-kind={kindOf(e)}
          data-estimate={e.is_estimate ? "yes" : "no"}
        >
          {e.ticker}
        </span>
      ))}
      {list.length > max && <span className={styles.more}>+{list.length - max}</span>}
    </span>
  );
}

export default function EarningsPanel() {
  const phone = useMediaQuery(PHONE);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [scope, setScope] = useState("all");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [openDay, setOpenDay] = useState(null);

  const from = iso(new Date(cursor.year, cursor.month, 1));
  const to = iso(new Date(cursor.year, cursor.month + 1, 0));

  useEffect(() => {
    let alive = true;
    getEarnings({ from, to, scope })
      // Both branches set state, so clearing a stale error is part of the
      // response rather than a synchronous reset before the request.
      .then((d) => { if (alive) { setRows(d); setError(null); } })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [from, to, scope]);

  const byDay = useMemo(() => {
    const m = new Map();
    for (const e of rows || []) {
      if (!m.has(e.event_date)) m.set(e.event_date, []);
      m.get(e.event_date).push(e);
    }
    for (const list of m.values()) list.sort((a, b) => rank(a) - rank(b) || a.ticker.localeCompare(b.ticker));
    return m;
  }, [rows]);

  const cells = monthGrid(cursor.year, cursor.month);
  const step = (delta) => {
    setOpenDay(null);
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const today = iso(new Date());
  const dayRows = openDay ? byDay.get(openDay) || [] : [];
  const estimatedCount = (rows || []).filter((e) => e.is_estimate).length;
  // A phone lists the days that have reports (weekday from the grid column)
  // instead of a seven-column month.
  const agenda = cells
    .map((cell, i) => cell && { ...cell, weekday: DAY_NAMES[i % 7], list: byDay.get(cell.iso) || [] })
    .filter((d) => d?.list.length);
  const closeDay = () => setOpenDay(null);
  const detailList = (
    <ul className={styles.detailList}>
      {dayRows.map((e) => (
        <li key={e.ticker} className={styles.detailRow}>
          <Tooltip content={`Open ${e.ticker} analysis in a new tab`}>
            <button
              type="button"
              className={styles.symbolBtn}
              onClick={() => openTickerTab(e.ticker)}
            >
              <TickerLabel ticker={e.ticker} className={styles.symbol} />
            </button>
          </Tooltip>
          <span className={styles.kind} data-kind={kindOf(e)}>{KIND_LABEL[kindOf(e)]}</span>
          <span className={styles.timing}>{TIMING_LABEL[e.timing] || "time not given"}</span>
          <span className={styles.est} data-estimate={e.is_estimate ? "yes" : "no"}>
            {e.is_estimate ? "date estimated" : "date confirmed"}
          </span>
          <span className={styles.eps}>
            {e.eps_estimate != null && <Term term="eps">est. EPS {e.eps_estimate.toFixed(2)}</Term>}
          </span>
        </li>
      ))}
    </ul>
  );

  if (error) {
    return (
      <section className={styles.panel}>
        <p className={styles.error}><Icon name="bell" size={14} /> {error}</p>
      </section>
    );
  }

  return (
    <section className={styles.panel} id="earnings">
      <header className={styles.head} data-head="inline">
        <div>
          <h2 className={styles.title}>Earnings<PanelInfo label="Earnings" blurb={BLURB} /></h2>
          <p className={styles.subtitle}>{BLURB}</p>
        </div>
        <div className={styles.scope} role="group" aria-label="Scope">
          {[["all", "Everyone"], ["mine", "Mine only"]].map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={styles.scopeBtn}
              data-active={scope === v ? "yes" : "no"}
              onClick={() => setScope(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className={styles.monthBar}>
        <Tooltip content="Previous month"><button className={styles.navBtn} onClick={() => step(-1)} aria-label="Previous month">‹</button></Tooltip>
        <span className={styles.monthLabel}>{monthLabel(cursor.year, cursor.month, phone)}</span>
        <Tooltip content="Next month"><button className={styles.navBtn} onClick={() => step(1)} aria-label="Next month">›</button></Tooltip>
        <span className={styles.legend}>
          <span className={styles.chip} data-kind="held" /> held
          <span className={styles.chip} data-kind="watched" /> watched
          <span className={styles.chip} data-kind="major" /> large cap
          {/* Said out loud: a projected date is not a confirmed one. */}
          {estimatedCount > 0 && (phone ? (
            <span className={styles.estNote}>· {estimatedCount} estimated (dashed)</span>
          ) : (
            <span className={styles.estNote}>
              · {estimatedCount} date{estimatedCount === 1 ? "" : "s"} estimated by the data
              provider, not confirmed by the company (shown dashed)
            </span>
          ))}
        </span>
      </div>

      {rows === null ? (
        <div className={styles.gridPad}><Skeleton w="100%" h="320px" /></div>
      ) : phone ? (
        agenda.length > 0 && (
          <ul className={styles.agenda} aria-label="Earnings by date">
            {agenda.map((d) => (
              <li key={d.iso}>
                <button
                  type="button"
                  className={styles.day}
                  data-today={d.iso === today ? "yes" : "no"}
                  data-open={openDay === d.iso ? "yes" : "no"}
                  onClick={() => setOpenDay(d.iso)}
                  aria-label={`${d.iso}: ${d.list.length} report${d.list.length === 1 ? "" : "s"}`}
                >
                  <span className={styles.dayDate}>{d.weekday} {d.day}</span>
                  {tickerChips(d.list)}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className={styles.grid} role="grid" aria-label="Earnings calendar">
          {DAY_NAMES.map((d) => <span key={d} className={styles.dayName}>{d}</span>)}
          {cells.map((cell, i) => {
            if (!cell) return <span key={`pad-${i}`} className={styles.pad} />;
            const list = byDay.get(cell.iso) || [];
            return (
              <button
                key={cell.iso}
                className={styles.cell}
                data-has={list.length ? "yes" : "no"}
                data-today={cell.iso === today ? "yes" : "no"}
                data-open={openDay === cell.iso ? "yes" : "no"}
                disabled={list.length === 0}
                onClick={() => setOpenDay(openDay === cell.iso ? null : cell.iso)}
                aria-label={`${cell.iso}: ${list.length} report${list.length === 1 ? "" : "s"}`}
              >
                <span className={styles.cellDay}>{cell.day}</span>
                {tickerChips(list, CELL_TICKERS)}
              </button>
            );
          })}
        </div>
      )}

      {!phone && openDay && dayRows.length > 0 && (
        <div className={styles.detail}>
          <div className={styles.detailHead}>{openDay} · {dayRows.length} reporting</div>
          {detailList}
        </div>
      )}
      <Dialog open={phone && dayRows.length > 0} title={`${openDay} · ${dayRows.length} reporting`} onClose={closeDay}>
        {detailList}
      </Dialog>

      {rows !== null && rows.length === 0 && (
        <p className={styles.empty}>
          No earnings recorded for this month yet. Dates are pulled a few times a
          day; if this stays empty, check the earnings source on the Server page.
        </p>
      )}
    </section>
  );
}
