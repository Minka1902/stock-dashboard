"""All SQLite access lives here."""
import functools
import inspect
import json
import sqlite3
import sys
import threading

from app.models import (
    AaiiSentiment,
    Alert,
    AnalystSignal,
    AppSettings,
    AuthSession,
    BoomScore,
    CongressTrade,
    ContractRecord,
    EconEvent,
    FearGreedSnapshot,
    Fundamentals,
    Holding,
    InsiderTrade,
    MarginDebtPoint,
    NewsArticle,
    NotifyProfile,
    OHLCBar,
    OHLCSeries,
    PutCallPoint,
    StockAnalysis,
    Seasonality,
    ShortInterest,
    SocialSentiment,
    SourceStatus,
    SuggestionLogEntry,
    TechnicalSignal,
    User,
    VixPoint,
    WatchItem,
    YieldPoint,
)


class _LockingConnection(sqlite3.Connection):
    """Connection subclass that carries a re-entrant lock.

    A raw ``sqlite3.Connection`` has no ``__dict__`` so we can't attach the
    lock to it; a subclass instance can. The lock lives on the connection
    object itself, so every db access serializes on the *same* lock no matter
    how this module is imported. See the ``_synchronized`` wrapper below.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._app_lock = threading.RLock()


def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, factory=_LockingConnection, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    # WAL lets readers proceed while a write is in flight; busy_timeout keeps
    # a briefly-locked DB from surfacing as an exception under load.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _try_add_column(conn: sqlite3.Connection, table: str, col: str, col_def: str) -> None:
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_def}")
    except Exception:
        pass  # column already exists


def _migrate_per_user_tables(conn: sqlite3.Connection) -> None:
    """One-time rebuild of pre-auth single-user tables to per-user shape.

    SQLite can't alter a primary key, so tables created before multi-user
    support are rebuilt with rows parked under user_id=0 ("unclaimed legacy").
    The first account to register claims them (see claim_legacy_rows).
    Idempotent: skipped once the user_id column exists.
    """
    def has_col(table: str, col: str) -> bool:
        return any(r[1] == col for r in conn.execute(f"PRAGMA table_info({table})"))

    if not has_col("watchlist", "user_id"):
        conn.executescript(
            """
            CREATE TABLE watchlist_v2 (
                user_id  INTEGER NOT NULL DEFAULT 0,
                ticker   TEXT NOT NULL,
                note     TEXT NOT NULL,
                added_at TEXT NOT NULL,
                PRIMARY KEY (user_id, ticker)
            );
            INSERT INTO watchlist_v2 (user_id, ticker, note, added_at)
                SELECT 0, ticker, note, added_at FROM watchlist;
            DROP TABLE watchlist;
            ALTER TABLE watchlist_v2 RENAME TO watchlist;
            """
        )

    if not has_col("portfolio", "user_id"):
        conn.executescript(
            """
            CREATE TABLE portfolio_v2 (
                user_id  INTEGER NOT NULL DEFAULT 0,
                ticker   TEXT NOT NULL,
                shares   REAL NOT NULL,
                avg_cost REAL NOT NULL,
                added_at TEXT NOT NULL,
                PRIMARY KEY (user_id, ticker)
            );
            INSERT INTO portfolio_v2 (user_id, ticker, shares, avg_cost, added_at)
                SELECT 0, ticker, shares, avg_cost, added_at FROM portfolio;
            DROP TABLE portfolio;
            ALTER TABLE portfolio_v2 RENAME TO portfolio;
            """
        )

    if not has_col("notify_profile", "user_id"):
        conn.executescript(
            """
            CREATE TABLE notify_profile_v2 (
                user_id       INTEGER PRIMARY KEY,
                email         TEXT,
                phone         TEXT,
                email_enabled INTEGER NOT NULL DEFAULT 0,
                sms_enabled   INTEGER NOT NULL DEFAULT 0,
                account_size  REAL,
                risk_pct      REAL NOT NULL DEFAULT 1.0,
                updated_at    TEXT NOT NULL DEFAULT ''
            );
            INSERT INTO notify_profile_v2
                (user_id, email, phone, email_enabled, sms_enabled,
                 account_size, risk_pct, updated_at)
                SELECT 0, email, phone, email_enabled, sms_enabled,
                       account_size, COALESCE(risk_pct, 1.0), updated_at
                FROM notify_profile;
            DROP TABLE notify_profile;
            ALTER TABLE notify_profile_v2 RENAME TO notify_profile;
            """
        )

    conn.commit()


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS contracts (
            external_id     TEXT PRIMARY KEY,
            award_id        TEXT NOT NULL,
            recipient_name  TEXT NOT NULL,
            amount          REAL NOT NULL,
            awarding_agency TEXT NOT NULL,
            start_date      TEXT NOT NULL,
            source          TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS news (
            url           TEXT PRIMARY KEY,
            title         TEXT NOT NULL,
            domain        TEXT NOT NULL,
            seendate      TEXT NOT NULL,
            sourcecountry TEXT NOT NULL,
            image         TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS insider_trades (
            accession        TEXT PRIMARY KEY,
            ticker           TEXT NOT NULL,
            company          TEXT NOT NULL,
            owner            TEXT NOT NULL,
            role             TEXT NOT NULL,
            transaction_date TEXT NOT NULL,
            transaction_type TEXT NOT NULL,
            shares           REAL NOT NULL,
            value            REAL NOT NULL,
            filing_url       TEXT NOT NULL,
            filed_at         TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS watchlist (
            user_id  INTEGER NOT NULL DEFAULT 0,
            ticker   TEXT NOT NULL,
            note     TEXT NOT NULL,
            added_at TEXT NOT NULL,
            PRIMARY KEY (user_id, ticker)
        );
        CREATE TABLE IF NOT EXISTS source_status (
            source            TEXT PRIMARY KEY,
            last_refreshed_at TEXT,
            status            TEXT NOT NULL,
            record_count      INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS yield_curve (
            date   TEXT PRIMARY KEY,
            yr2    REAL,
            yr10   REAL,
            yr30   REAL,
            spread REAL
        );
        CREATE TABLE IF NOT EXISTS econ_events (
            event_id          TEXT PRIMARY KEY,
            date              TEXT NOT NULL,
            time              TEXT NOT NULL,
            country           TEXT NOT NULL,
            event             TEXT NOT NULL,
            importance        TEXT NOT NULL,
            importance_source TEXT NOT NULL,
            actual            TEXT,
            forecast          TEXT,
            previous          TEXT,
            source            TEXT NOT NULL,
            fetched_at        TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS technical_signals (
            ticker       TEXT PRIMARY KEY,
            fetched_at   TEXT NOT NULL,
            price        REAL,
            change_pct   REAL,
            ma50         REAL,
            ma200        REAL,
            golden_cross INTEGER,
            rsi14        REAL,
            high_52w     REAL,
            low_52w      REAL,
            prices_json  TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS fear_greed (
            captured_at TEXT PRIMARY KEY,
            score       REAL NOT NULL,
            rating      TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS vix_daily (
            date  TEXT PRIMARY KEY,
            close REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS aaii_sentiment (
            week_ending TEXT PRIMARY KEY,
            bullish     REAL NOT NULL,
            neutral     REAL NOT NULL,
            bearish     REAL NOT NULL,
            fetched_at  TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS put_call (
            date  TEXT PRIMARY KEY,
            ratio REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS margin_debt (
            month          TEXT PRIMARY KEY,
            debit_balances REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS congress_trades (
            trade_hash        TEXT PRIMARY KEY,
            representative    TEXT NOT NULL,
            party             TEXT NOT NULL,
            state             TEXT NOT NULL,
            ticker            TEXT NOT NULL,
            asset_description TEXT NOT NULL,
            transaction_date  TEXT NOT NULL,
            transaction_type  TEXT NOT NULL,
            amount_range      TEXT NOT NULL,
            filed_at          TEXT NOT NULL,
            chamber           TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS short_interest (
            ticker             TEXT PRIMARY KEY,
            fetched_at         TEXT NOT NULL,
            shares_short       INTEGER,
            short_pct_float    REAL,
            days_to_cover      REAL,
            prior_month_shares INTEGER,
            squeeze_flag       INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS social_sentiment (
            ticker        TEXT PRIMARY KEY,
            fetched_at    TEXT NOT NULL,
            mentions      INTEGER,
            upvotes       INTEGER,
            rank          INTEGER,
            rank_24h_ago  INTEGER,
            rank_change   INTEGER
        );
        CREATE TABLE IF NOT EXISTS analyst_signals (
            ticker            TEXT PRIMARY KEY,
            fetched_at        TEXT NOT NULL,
            next_earnings     TEXT,
            rec_strong_buy    INTEGER,
            rec_buy           INTEGER,
            rec_hold          INTEGER,
            rec_sell          INTEGER,
            recent_upgrades   INTEGER NOT NULL DEFAULT 0,
            recent_downgrades INTEGER NOT NULL DEFAULT 0,
            latest_action     TEXT,
            latest_firm       TEXT,
            latest_to_grade   TEXT
        );
        CREATE TABLE IF NOT EXISTS boom_scores (
            ticker                    TEXT PRIMARY KEY,
            computed_at               TEXT NOT NULL,
            score                     INTEGER NOT NULL,
            components                TEXT NOT NULL,
            golden_cross              INTEGER NOT NULL DEFAULT 0,
            rsi_recovery              INTEGER NOT NULL DEFAULT 0,
            insider_cluster_buy       INTEGER NOT NULL DEFAULT 0,
            congress_buy              INTEGER NOT NULL DEFAULT 0,
            short_squeeze             INTEGER NOT NULL DEFAULT 0,
            wsb_rising                INTEGER NOT NULL DEFAULT 0,
            analyst_upgrade           INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS fundamentals (
            ticker         TEXT PRIMARY KEY,
            fetched_at     TEXT NOT NULL,
            sector         TEXT,
            industry       TEXT,
            pe_ratio       REAL,
            forward_pe     REAL,
            peg_ratio      REAL,
            pb_ratio       REAL,
            revenue_growth REAL,
            profit_margin  REAL,
            market_cap     REAL
        );
        CREATE TABLE IF NOT EXISTS boom_score_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker      TEXT NOT NULL,
            score       INTEGER NOT NULL,
            computed_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS seasonality (
            ticker        TEXT PRIMARY KEY,
            computed_at   TEXT NOT NULL,
            as_of         TEXT NOT NULL,
            history_years INTEGER NOT NULL DEFAULT 0,
            windows_json  TEXT NOT NULL DEFAULT '[]',
            anchors_json  TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS portfolio (
            user_id  INTEGER NOT NULL DEFAULT 0,
            ticker   TEXT NOT NULL,
            shares   REAL NOT NULL,
            avg_cost REAL NOT NULL,
            added_at TEXT NOT NULL,
            PRIMARY KEY (user_id, ticker)
        );
        CREATE TABLE IF NOT EXISTS notify_profile (
            user_id       INTEGER PRIMARY KEY,
            email         TEXT,
            phone         TEXT,
            email_enabled INTEGER NOT NULL DEFAULT 0,
            sms_enabled   INTEGER NOT NULL DEFAULT 0,
            account_size  REAL,
            risk_pct      REAL NOT NULL DEFAULT 1.0,
            updated_at    TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS app_settings (
            id                     INTEGER PRIMARY KEY CHECK (id = 1),
            analysis_time          TEXT NOT NULL DEFAULT '15:30',
            analysis_tz            TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
            quotes_refresh_seconds INTEGER NOT NULL DEFAULT 30,
            updated_at             TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS suggestion_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            for_date   TEXT NOT NULL,
            channel    TEXT NOT NULL,
            status     TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS alerts (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            dedup_key  TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            ticker     TEXT NOT NULL,
            type       TEXT NOT NULL,
            severity   TEXT NOT NULL,
            title      TEXT NOT NULL,
            message    TEXT NOT NULL,
            read       INTEGER NOT NULL DEFAULT 0,
            pushed     INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS alert_state (
            ticker              TEXT PRIMARY KEY,
            score               INTEGER,
            golden_cross        INTEGER,
            insider_cluster_buy INTEGER,
            updated_at          TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ohlc_series (
            ticker     TEXT NOT NULL,
            interval   TEXT NOT NULL,
            bars_json  TEXT NOT NULL,
            fetched_at TEXT NOT NULL,
            PRIMARY KEY (ticker, interval)
        );
        CREATE TABLE IF NOT EXISTS stock_analysis (
            ticker       TEXT PRIMARY KEY,
            computed_at  TEXT NOT NULL,
            payload_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            totp_secret   TEXT,
            totp_enabled  INTEGER NOT NULL DEFAULT 0,
            is_admin      INTEGER NOT NULL DEFAULT 0,
            created_at    TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash   TEXT PRIMARY KEY,
            user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            state        TEXT NOT NULL,
            created_at   TEXT NOT NULL,
            expires_at   TEXT NOT NULL,
            last_seen_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS recovery_codes (
            user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            code_hash TEXT NOT NULL,
            used_at   TEXT,
            PRIMARY KEY (user_id, code_hash)
        );
        CREATE TABLE IF NOT EXISTS alert_reads (
            user_id   INTEGER NOT NULL,
            dedup_key TEXT NOT NULL,
            read_at   TEXT NOT NULL,
            PRIMARY KEY (user_id, dedup_key)
        );
        """
    )
    conn.commit()

    # Older DBs may predate these columns; the per-user rebuild below copies them.
    _try_add_column(conn, "notify_profile", "account_size", "REAL")
    _try_add_column(conn, "notify_profile", "risk_pct", "REAL NOT NULL DEFAULT 1.0")
    _migrate_per_user_tables(conn)
    _try_add_column(conn, "news", "ticker", "TEXT NOT NULL DEFAULT ''")

    # Migrate existing tables: add new columns (safe on pre-existing databases).
    for col, col_def in [
        ("macd",           "REAL"),
        ("macd_signal",    "REAL"),
        ("macd_crossover", "INTEGER"),
        ("rel_volume",     "REAL"),
        ("volume_json",    "TEXT NOT NULL DEFAULT '[]'"),
    ]:
        _try_add_column(conn, "technical_signals", col, col_def)

    for col, col_def in [
        ("near_52w_high",             "INTEGER NOT NULL DEFAULT 0"),
        ("macd_crossover",            "INTEGER NOT NULL DEFAULT 0"),
        ("volume_confirmed",          "INTEGER NOT NULL DEFAULT 0"),
        ("fear_greed_contrarian",     "INTEGER NOT NULL DEFAULT 0"),
        ("yield_uninversion",         "INTEGER NOT NULL DEFAULT 0"),
        ("contracts_catalyst",        "INTEGER NOT NULL DEFAULT 0"),
        ("seasonal_tailwind",         "INTEGER NOT NULL DEFAULT 0"),
        ("death_cross",               "INTEGER NOT NULL DEFAULT 0"),
        ("insider_cluster_sell",      "INTEGER NOT NULL DEFAULT 0"),
        ("overbought_rsi",            "INTEGER NOT NULL DEFAULT 0"),
        ("congress_sale",             "INTEGER NOT NULL DEFAULT 0"),
        ("analyst_downgrade_cluster", "INTEGER NOT NULL DEFAULT 0"),
        ("extreme_greed",             "INTEGER NOT NULL DEFAULT 0"),
        ("earnings_soon",             "INTEGER NOT NULL DEFAULT 0"),
        ("mixed_signals",             "INTEGER NOT NULL DEFAULT 0"),
        ("vix_spike_contrarian",      "INTEGER NOT NULL DEFAULT 0"),
        ("aaii_bearish_extreme",      "INTEGER NOT NULL DEFAULT 0"),
        ("put_call_fear",             "INTEGER NOT NULL DEFAULT 0"),
        ("aaii_bullish_euphoria",     "INTEGER NOT NULL DEFAULT 0"),
        ("margin_debt_deleveraging",  "INTEGER NOT NULL DEFAULT 0"),
        ("margin_debt_euphoria",      "INTEGER NOT NULL DEFAULT 0"),
    ]:
        _try_add_column(conn, "boom_scores", col, col_def)

    _try_add_column(conn, "contracts", "ticker", "TEXT")
    _try_add_column(conn, "seasonality", "anchors_json", "TEXT NOT NULL DEFAULT '[]'")
    conn.commit()


# ---------- contracts ----------
def upsert_contracts(conn: sqlite3.Connection, records: list[ContractRecord]) -> None:
    from app.data.contractors import match_ticker  # lazy import to avoid circular deps

    rows = []
    for r in records:
        d = r.model_dump()
        d["ticker"] = match_ticker(r.recipient_name)
        rows.append(d)

    conn.executemany(
        """
        INSERT INTO contracts
            (external_id, award_id, recipient_name, amount, awarding_agency,
             start_date, source, ticker)
        VALUES (:external_id, :award_id, :recipient_name, :amount, :awarding_agency,
                :start_date, :source, :ticker)
        ON CONFLICT(external_id) DO UPDATE SET
            award_id=excluded.award_id,
            recipient_name=excluded.recipient_name,
            amount=excluded.amount,
            awarding_agency=excluded.awarding_agency,
            start_date=excluded.start_date,
            source=excluded.source,
            ticker=excluded.ticker
        """,
        rows,
    )
    conn.commit()


def get_contracts(conn: sqlite3.Connection, limit: int = 100) -> list[ContractRecord]:
    cur = conn.execute(
        "SELECT * FROM contracts ORDER BY amount DESC LIMIT ?", (limit,)
    )
    return [ContractRecord(**dict(row)) for row in cur.fetchall()]


# ---------- news ----------
def upsert_news(conn: sqlite3.Connection, records: list[NewsArticle]) -> None:
    conn.executemany(
        """
        INSERT INTO news (url, title, domain, seendate, sourcecountry, image, ticker)
        VALUES (:url, :title, :domain, :seendate, :sourcecountry, :image, :ticker)
        ON CONFLICT(url) DO UPDATE SET
            title=excluded.title,
            domain=excluded.domain,
            seendate=excluded.seendate,
            sourcecountry=excluded.sourcecountry,
            image=excluded.image,
            -- a ticker tag, once earned, is never wiped by an untagged macro hit
            ticker=CASE WHEN excluded.ticker != '' THEN excluded.ticker ELSE news.ticker END
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def get_news(conn: sqlite3.Connection, limit: int = 120) -> list[NewsArticle]:
    cur = conn.execute(
        "SELECT * FROM news ORDER BY seendate DESC LIMIT ?", (limit,)
    )
    return [NewsArticle(**dict(row)) for row in cur.fetchall()]


def get_company_names(conn: sqlite3.Connection, tickers: list[str]) -> dict[str, str]:
    """ticker -> latest known company name (from insider filings, where seen)."""
    if not tickers:
        return {}
    marks = ",".join("?" * len(tickers))
    cur = conn.execute(
        f"""
        SELECT ticker, company FROM insider_trades
        WHERE ticker IN ({marks}) AND company != ''
        GROUP BY ticker HAVING MAX(filed_at)
        """,
        [t.upper() for t in tickers],
    )
    return {row["ticker"]: row["company"] for row in cur.fetchall()}


# ---------- insider trades ----------
def upsert_trades(conn: sqlite3.Connection, records: list[InsiderTrade]) -> None:
    conn.executemany(
        """
        INSERT INTO insider_trades
            (accession, ticker, company, owner, role, transaction_date,
             transaction_type, shares, value, filing_url, filed_at)
        VALUES
            (:accession, :ticker, :company, :owner, :role, :transaction_date,
             :transaction_type, :shares, :value, :filing_url, :filed_at)
        ON CONFLICT(accession) DO UPDATE SET
            ticker=excluded.ticker,
            company=excluded.company,
            owner=excluded.owner,
            role=excluded.role,
            transaction_date=excluded.transaction_date,
            transaction_type=excluded.transaction_type,
            shares=excluded.shares,
            value=excluded.value,
            filing_url=excluded.filing_url,
            filed_at=excluded.filed_at
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def get_trades(conn: sqlite3.Connection, limit: int = 60) -> list[InsiderTrade]:
    cur = conn.execute(
        "SELECT * FROM insider_trades ORDER BY filed_at DESC, value DESC LIMIT ?",
        (limit,),
    )
    return [InsiderTrade(**dict(row)) for row in cur.fetchall()]


# ---------- watchlist (user managed, per-user) ----------
def add_watch(conn: sqlite3.Connection, user_id: int, item: WatchItem) -> None:
    conn.execute(
        """
        INSERT INTO watchlist (user_id, ticker, note, added_at)
        VALUES (:user_id, :ticker, :note, :added_at)
        ON CONFLICT(user_id, ticker) DO UPDATE SET note=excluded.note
        """,
        {"user_id": user_id, **item.model_dump()},
    )
    conn.commit()


def remove_watch(conn: sqlite3.Connection, user_id: int, ticker: str) -> None:
    conn.execute(
        "DELETE FROM watchlist WHERE user_id = ? AND ticker = ?", (user_id, ticker))
    conn.commit()


def get_watchlist(conn: sqlite3.Connection, user_id: int) -> list[WatchItem]:
    cur = conn.execute(
        "SELECT ticker, note, added_at FROM watchlist WHERE user_id = ? "
        "ORDER BY added_at DESC",
        (user_id,),
    )
    return [WatchItem(**dict(row)) for row in cur.fetchall()]


def get_all_watched_tickers(conn: sqlite3.Connection) -> list[str]:
    """Every ticker on any user's watchlist — the ingestion pipeline's universe."""
    cur = conn.execute("SELECT DISTINCT ticker FROM watchlist ORDER BY ticker")
    return [row[0] for row in cur.fetchall()]


# ---------- source status ----------
def update_source_status(
    conn: sqlite3.Connection,
    source: str,
    last_refreshed_at: str | None,
    status: str,
    record_count: int,
) -> None:
    conn.execute(
        """
        INSERT INTO source_status (source, last_refreshed_at, status, record_count)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(source) DO UPDATE SET
            last_refreshed_at=excluded.last_refreshed_at,
            status=excluded.status,
            record_count=excluded.record_count
        """,
        (source, last_refreshed_at, status, record_count),
    )
    conn.commit()


def get_source_statuses(conn: sqlite3.Connection) -> list[SourceStatus]:
    cur = conn.execute("SELECT * FROM source_status ORDER BY source")
    return [SourceStatus(**dict(row)) for row in cur.fetchall()]


# ---------- yield curve ----------
def upsert_yield_curve(conn: sqlite3.Connection, records: list[YieldPoint]) -> None:
    conn.executemany(
        """
        INSERT INTO yield_curve (date, yr2, yr10, yr30, spread)
        VALUES (:date, :yr2, :yr10, :yr30, :spread)
        ON CONFLICT(date) DO UPDATE SET
            yr2=excluded.yr2, yr10=excluded.yr10,
            yr30=excluded.yr30, spread=excluded.spread
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def get_yield_curve(conn: sqlite3.Connection, days: int = 90) -> list[YieldPoint]:
    cur = conn.execute(
        "SELECT * FROM yield_curve WHERE date >= date('now', ?) ORDER BY date ASC",
        (f"-{days} days",),
    )
    return [YieldPoint(**dict(row)) for row in cur.fetchall()]


# ---------- economic calendar ----------
def upsert_econ_events(conn: sqlite3.Connection, records: list[EconEvent]) -> None:
    conn.executemany(
        """
        INSERT INTO econ_events
            (event_id, date, time, country, event, importance, importance_source,
             actual, forecast, previous, source, fetched_at)
        VALUES
            (:event_id, :date, :time, :country, :event, :importance, :importance_source,
             :actual, :forecast, :previous, :source, :fetched_at)
        ON CONFLICT(event_id) DO UPDATE SET
            time=excluded.time, importance=excluded.importance,
            importance_source=excluded.importance_source,
            actual=excluded.actual, forecast=excluded.forecast,
            previous=excluded.previous, source=excluded.source,
            fetched_at=excluded.fetched_at
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def get_econ_events(
    conn: sqlite3.Connection,
    days_ahead: int = 7,
    days_back: int = 1,
    importance: str | None = None,
) -> list[EconEvent]:
    sql = (
        "SELECT * FROM econ_events "
        "WHERE date >= date('now', ?) AND date <= date('now', ?)"
    )
    params: list = [f"-{days_back} days", f"+{days_ahead} days"]
    if importance:
        sql += " AND importance = ?"
        params.append(importance)
    sql += " ORDER BY date ASC, CASE WHEN time = '' THEN '99:99' ELSE time END ASC"
    cur = conn.execute(sql, params)
    return [EconEvent(**dict(row)) for row in cur.fetchall()]


# ---------- technical signals ----------
def upsert_technical_signals(conn: sqlite3.Connection, records: list[TechnicalSignal]) -> None:
    conn.executemany(
        """
        INSERT INTO technical_signals
            (ticker, fetched_at, price, change_pct, ma50, ma200,
             golden_cross, rsi14, high_52w, low_52w, prices_json,
             macd, macd_signal, macd_crossover, rel_volume, volume_json)
        VALUES
            (:ticker, :fetched_at, :price, :change_pct, :ma50, :ma200,
             :golden_cross, :rsi14, :high_52w, :low_52w, :prices_json,
             :macd, :macd_signal, :macd_crossover, :rel_volume, :volume_json)
        ON CONFLICT(ticker) DO UPDATE SET
            fetched_at=excluded.fetched_at, price=excluded.price,
            change_pct=excluded.change_pct, ma50=excluded.ma50,
            ma200=excluded.ma200, golden_cross=excluded.golden_cross,
            rsi14=excluded.rsi14, high_52w=excluded.high_52w,
            low_52w=excluded.low_52w, prices_json=excluded.prices_json,
            macd=excluded.macd, macd_signal=excluded.macd_signal,
            macd_crossover=excluded.macd_crossover, rel_volume=excluded.rel_volume,
            volume_json=excluded.volume_json
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def _row_to_technical_signal(d: dict) -> TechnicalSignal:
    gc = d.get("golden_cross")
    d["golden_cross"] = bool(gc) if gc is not None else None
    mc = d.get("macd_crossover")
    d["macd_crossover"] = bool(mc) if mc is not None else None
    d.setdefault("macd", None)
    d.setdefault("macd_signal", None)
    d.setdefault("rel_volume", None)
    d.setdefault("volume_json", "[]")
    return TechnicalSignal(**d)


def get_technical_signals(conn: sqlite3.Connection) -> list[TechnicalSignal]:
    cur = conn.execute("SELECT * FROM technical_signals ORDER BY ticker ASC")
    return [_row_to_technical_signal(dict(row)) for row in cur.fetchall()]


# ---------- fear & greed ----------
def upsert_fear_greed(conn: sqlite3.Connection, records: list[FearGreedSnapshot]) -> None:
    conn.executemany(
        """
        INSERT INTO fear_greed (captured_at, score, rating)
        VALUES (:captured_at, :score, :rating)
        ON CONFLICT(captured_at) DO UPDATE SET
            score=excluded.score, rating=excluded.rating
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def get_fear_greed(conn: sqlite3.Connection, days: int = 30) -> list[FearGreedSnapshot]:
    cur = conn.execute(
        "SELECT * FROM fear_greed WHERE captured_at >= datetime('now', ?) ORDER BY captured_at ASC",
        (f"-{days} days",),
    )
    return [FearGreedSnapshot(**dict(row)) for row in cur.fetchall()]


# ---------- VIX ----------
def upsert_vix(conn: sqlite3.Connection, records: list[VixPoint]) -> None:
    conn.executemany(
        """
        INSERT INTO vix_daily (date, close)
        VALUES (:date, :close)
        ON CONFLICT(date) DO UPDATE SET close=excluded.close
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def get_vix(conn: sqlite3.Connection, days: int = 180) -> list[VixPoint]:
    cur = conn.execute(
        "SELECT * FROM vix_daily WHERE date >= date('now', ?) ORDER BY date ASC",
        (f"-{days} days",),
    )
    return [VixPoint(**dict(row)) for row in cur.fetchall()]


def get_latest_vix_closes(conn: sqlite3.Connection, n: int = 2) -> list[float]:
    """Most recent N closes, oldest first (for threshold-crossing checks)."""
    cur = conn.execute(
        "SELECT close FROM vix_daily ORDER BY date DESC LIMIT ?", (n,)
    )
    closes = [row[0] for row in cur.fetchall()]
    return list(reversed(closes))


# ---------- AAII sentiment survey ----------
def upsert_aaii(conn: sqlite3.Connection, records: list[AaiiSentiment]) -> None:
    conn.executemany(
        """
        INSERT INTO aaii_sentiment (week_ending, bullish, neutral, bearish, fetched_at)
        VALUES (:week_ending, :bullish, :neutral, :bearish, :fetched_at)
        ON CONFLICT(week_ending) DO UPDATE SET
            bullish=excluded.bullish, neutral=excluded.neutral,
            bearish=excluded.bearish, fetched_at=excluded.fetched_at
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def get_aaii(conn: sqlite3.Connection, weeks: int = 52) -> list[AaiiSentiment]:
    cur = conn.execute(
        "SELECT * FROM aaii_sentiment WHERE week_ending >= date('now', ?) ORDER BY week_ending ASC",
        (f"-{weeks * 7} days",),
    )
    return [AaiiSentiment(**dict(row)) for row in cur.fetchall()]


def get_latest_aaii(conn: sqlite3.Connection) -> AaiiSentiment | None:
    cur = conn.execute(
        "SELECT * FROM aaii_sentiment ORDER BY week_ending DESC LIMIT 1"
    )
    row = cur.fetchone()
    return AaiiSentiment(**dict(row)) if row else None


# ---------- put/call ratio ----------
def upsert_put_call(conn: sqlite3.Connection, records: list[PutCallPoint]) -> None:
    conn.executemany(
        """
        INSERT INTO put_call (date, ratio)
        VALUES (:date, :ratio)
        ON CONFLICT(date) DO UPDATE SET ratio=excluded.ratio
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def get_put_call(conn: sqlite3.Connection, days: int = 180) -> list[PutCallPoint]:
    cur = conn.execute(
        "SELECT * FROM put_call WHERE date >= date('now', ?) ORDER BY date ASC",
        (f"-{days} days",),
    )
    return [PutCallPoint(**dict(row)) for row in cur.fetchall()]


def get_latest_put_call(conn: sqlite3.Connection) -> PutCallPoint | None:
    cur = conn.execute("SELECT * FROM put_call ORDER BY date DESC LIMIT 1")
    row = cur.fetchone()
    return PutCallPoint(**dict(row)) if row else None


# ---------- margin debt (FINRA, monthly) ----------
def upsert_margin_debt(conn: sqlite3.Connection, records: list[MarginDebtPoint]) -> None:
    conn.executemany(
        """
        INSERT INTO margin_debt (month, debit_balances)
        VALUES (:month, :debit_balances)
        ON CONFLICT(month) DO UPDATE SET debit_balances=excluded.debit_balances
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def get_margin_debt(conn: sqlite3.Connection) -> list[MarginDebtPoint]:
    # No date filter: rows are monthly (tiny) and YoY needs a year+ of history.
    cur = conn.execute("SELECT * FROM margin_debt ORDER BY month ASC")
    return [MarginDebtPoint(**dict(row)) for row in cur.fetchall()]


# ---------- congress trades ----------
def upsert_congress_trades(conn: sqlite3.Connection, records: list[CongressTrade]) -> None:
    conn.executemany(
        """
        INSERT INTO congress_trades
            (trade_hash, representative, party, state, ticker,
             asset_description, transaction_date, transaction_type,
             amount_range, filed_at, chamber)
        VALUES
            (:trade_hash, :representative, :party, :state, :ticker,
             :asset_description, :transaction_date, :transaction_type,
             :amount_range, :filed_at, :chamber)
        ON CONFLICT(trade_hash) DO UPDATE SET
            filed_at=excluded.filed_at, amount_range=excluded.amount_range
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def get_congress_trades(conn: sqlite3.Connection, limit: int = 100) -> list[CongressTrade]:
    cur = conn.execute(
        "SELECT * FROM congress_trades ORDER BY transaction_date DESC, filed_at DESC LIMIT ?",
        (limit,),
    )
    return [CongressTrade(**dict(row)) for row in cur.fetchall()]


# ---------- short interest ----------
def upsert_short_interest(conn: sqlite3.Connection, records: list[ShortInterest]) -> None:
    conn.executemany(
        """
        INSERT INTO short_interest
            (ticker, fetched_at, shares_short, short_pct_float, days_to_cover,
             prior_month_shares, squeeze_flag)
        VALUES
            (:ticker, :fetched_at, :shares_short, :short_pct_float, :days_to_cover,
             :prior_month_shares, :squeeze_flag)
        ON CONFLICT(ticker) DO UPDATE SET
            fetched_at=excluded.fetched_at,
            shares_short=excluded.shares_short,
            short_pct_float=excluded.short_pct_float,
            days_to_cover=excluded.days_to_cover,
            prior_month_shares=excluded.prior_month_shares,
            squeeze_flag=excluded.squeeze_flag
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def get_short_interest(conn: sqlite3.Connection) -> list[ShortInterest]:
    cur = conn.execute("SELECT * FROM short_interest ORDER BY ticker ASC")
    rows = []
    for row in cur.fetchall():
        d = dict(row)
        d["squeeze_flag"] = bool(d["squeeze_flag"])
        rows.append(ShortInterest(**d))
    return rows


def get_short_interest_for(conn: sqlite3.Connection, ticker: str) -> ShortInterest | None:
    cur = conn.execute("SELECT * FROM short_interest WHERE ticker = ?", (ticker,))
    row = cur.fetchone()
    if row is None:
        return None
    d = dict(row)
    d["squeeze_flag"] = bool(d["squeeze_flag"])
    return ShortInterest(**d)


# ---------- social sentiment ----------
def upsert_social_sentiment(conn: sqlite3.Connection, records: list[SocialSentiment]) -> None:
    conn.executemany(
        """
        INSERT INTO social_sentiment
            (ticker, fetched_at, mentions, upvotes, rank, rank_24h_ago, rank_change)
        VALUES
            (:ticker, :fetched_at, :mentions, :upvotes, :rank, :rank_24h_ago, :rank_change)
        ON CONFLICT(ticker) DO UPDATE SET
            fetched_at=excluded.fetched_at,
            mentions=excluded.mentions,
            upvotes=excluded.upvotes,
            rank=excluded.rank,
            rank_24h_ago=excluded.rank_24h_ago,
            rank_change=excluded.rank_change
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def get_social_sentiment(conn: sqlite3.Connection) -> list[SocialSentiment]:
    cur = conn.execute("SELECT * FROM social_sentiment ORDER BY rank ASC NULLS LAST")
    return [SocialSentiment(**dict(row)) for row in cur.fetchall()]


def get_social_for(conn: sqlite3.Connection, ticker: str) -> SocialSentiment | None:
    cur = conn.execute("SELECT * FROM social_sentiment WHERE ticker = ?", (ticker,))
    row = cur.fetchone()
    return SocialSentiment(**dict(row)) if row else None


# ---------- analyst signals ----------
def upsert_analyst_signals(conn: sqlite3.Connection, records: list[AnalystSignal]) -> None:
    conn.executemany(
        """
        INSERT INTO analyst_signals
            (ticker, fetched_at, next_earnings, rec_strong_buy, rec_buy, rec_hold, rec_sell,
             recent_upgrades, recent_downgrades, latest_action, latest_firm, latest_to_grade)
        VALUES
            (:ticker, :fetched_at, :next_earnings, :rec_strong_buy, :rec_buy, :rec_hold, :rec_sell,
             :recent_upgrades, :recent_downgrades, :latest_action, :latest_firm, :latest_to_grade)
        ON CONFLICT(ticker) DO UPDATE SET
            fetched_at=excluded.fetched_at,
            next_earnings=excluded.next_earnings,
            rec_strong_buy=excluded.rec_strong_buy,
            rec_buy=excluded.rec_buy,
            rec_hold=excluded.rec_hold,
            rec_sell=excluded.rec_sell,
            recent_upgrades=excluded.recent_upgrades,
            recent_downgrades=excluded.recent_downgrades,
            latest_action=excluded.latest_action,
            latest_firm=excluded.latest_firm,
            latest_to_grade=excluded.latest_to_grade
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def get_analyst_signals(conn: sqlite3.Connection) -> list[AnalystSignal]:
    cur = conn.execute("SELECT * FROM analyst_signals ORDER BY ticker ASC")
    return [AnalystSignal(**dict(row)) for row in cur.fetchall()]


def get_analyst_for(conn: sqlite3.Connection, ticker: str) -> AnalystSignal | None:
    cur = conn.execute("SELECT * FROM analyst_signals WHERE ticker = ?", (ticker,))
    row = cur.fetchone()
    return AnalystSignal(**dict(row)) if row else None


# ---------- boom scores ----------
_BOOM_BOOL_COLS = (
    "golden_cross", "rsi_recovery", "insider_cluster_buy", "congress_buy",
    "short_squeeze", "wsb_rising", "analyst_upgrade",
    "near_52w_high", "macd_crossover", "volume_confirmed", "fear_greed_contrarian",
    "yield_uninversion", "contracts_catalyst", "seasonal_tailwind",
    "death_cross", "insider_cluster_sell", "overbought_rsi", "congress_sale",
    "analyst_downgrade_cluster", "extreme_greed", "earnings_soon", "mixed_signals",
    "vix_spike_contrarian", "aaii_bearish_extreme", "put_call_fear", "aaii_bullish_euphoria",
    "margin_debt_deleveraging", "margin_debt_euphoria",
)


def upsert_boom_scores(conn: sqlite3.Connection, records: list[BoomScore]) -> None:
    conn.executemany(
        """
        INSERT INTO boom_scores
            (ticker, computed_at, score, components,
             golden_cross, rsi_recovery, insider_cluster_buy, congress_buy,
             short_squeeze, wsb_rising, analyst_upgrade,
             near_52w_high, macd_crossover, volume_confirmed, fear_greed_contrarian,
             yield_uninversion, contracts_catalyst, seasonal_tailwind,
             death_cross, insider_cluster_sell, overbought_rsi, congress_sale,
             analyst_downgrade_cluster, extreme_greed, earnings_soon, mixed_signals,
             vix_spike_contrarian, aaii_bearish_extreme, put_call_fear, aaii_bullish_euphoria,
             margin_debt_deleveraging, margin_debt_euphoria)
        VALUES
            (:ticker, :computed_at, :score, :components,
             :golden_cross, :rsi_recovery, :insider_cluster_buy, :congress_buy,
             :short_squeeze, :wsb_rising, :analyst_upgrade,
             :near_52w_high, :macd_crossover, :volume_confirmed, :fear_greed_contrarian,
             :yield_uninversion, :contracts_catalyst, :seasonal_tailwind,
             :death_cross, :insider_cluster_sell, :overbought_rsi, :congress_sale,
             :analyst_downgrade_cluster, :extreme_greed, :earnings_soon, :mixed_signals,
             :vix_spike_contrarian, :aaii_bearish_extreme, :put_call_fear, :aaii_bullish_euphoria,
             :margin_debt_deleveraging, :margin_debt_euphoria)
        ON CONFLICT(ticker) DO UPDATE SET
            computed_at=excluded.computed_at, score=excluded.score,
            components=excluded.components,
            golden_cross=excluded.golden_cross, rsi_recovery=excluded.rsi_recovery,
            insider_cluster_buy=excluded.insider_cluster_buy,
            congress_buy=excluded.congress_buy, short_squeeze=excluded.short_squeeze,
            wsb_rising=excluded.wsb_rising, analyst_upgrade=excluded.analyst_upgrade,
            near_52w_high=excluded.near_52w_high, macd_crossover=excluded.macd_crossover,
            volume_confirmed=excluded.volume_confirmed,
            fear_greed_contrarian=excluded.fear_greed_contrarian,
            yield_uninversion=excluded.yield_uninversion,
            contracts_catalyst=excluded.contracts_catalyst,
            seasonal_tailwind=excluded.seasonal_tailwind,
            death_cross=excluded.death_cross,
            insider_cluster_sell=excluded.insider_cluster_sell,
            overbought_rsi=excluded.overbought_rsi, congress_sale=excluded.congress_sale,
            analyst_downgrade_cluster=excluded.analyst_downgrade_cluster,
            extreme_greed=excluded.extreme_greed,
            earnings_soon=excluded.earnings_soon, mixed_signals=excluded.mixed_signals,
            vix_spike_contrarian=excluded.vix_spike_contrarian,
            aaii_bearish_extreme=excluded.aaii_bearish_extreme,
            put_call_fear=excluded.put_call_fear,
            aaii_bullish_euphoria=excluded.aaii_bullish_euphoria,
            margin_debt_deleveraging=excluded.margin_debt_deleveraging,
            margin_debt_euphoria=excluded.margin_debt_euphoria
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def _row_to_boom_score(d: dict) -> BoomScore:
    for col in _BOOM_BOOL_COLS:
        if col in d:
            d[col] = bool(d[col])
        else:
            d[col] = False
    return BoomScore(**d)


def get_boom_scores(conn: sqlite3.Connection) -> list[BoomScore]:
    cur = conn.execute("SELECT * FROM boom_scores ORDER BY score DESC")
    return [_row_to_boom_score(dict(row)) for row in cur.fetchall()]


# ---------- single-ticker helpers for boom_score computation ----------
def get_technical_signal_for(conn: sqlite3.Connection, ticker: str) -> TechnicalSignal | None:
    cur = conn.execute("SELECT * FROM technical_signals WHERE ticker = ?", (ticker,))
    row = cur.fetchone()
    if row is None:
        return None
    return _row_to_technical_signal(dict(row))


def count_insider_buys(conn: sqlite3.Connection, ticker: str, days: int = 30) -> int:
    cur = conn.execute(
        """
        SELECT COUNT(*) FROM insider_trades
        WHERE ticker = ?
          AND transaction_type = 'Buy'
          AND transaction_date >= date('now', ?)
        """,
        (ticker, f"-{days} days"),
    )
    return cur.fetchone()[0]


def has_congress_buy(conn: sqlite3.Connection, ticker: str, days: int = 30) -> bool:
    cur = conn.execute(
        """
        SELECT 1 FROM congress_trades
        WHERE ticker = ?
          AND transaction_type = 'Purchase'
          AND transaction_date >= date('now', ?)
        LIMIT 1
        """,
        (ticker, f"-{days} days"),
    )
    return cur.fetchone() is not None


# ---------- new helpers for enhanced boom score ----------

def count_insider_sells(conn: sqlite3.Connection, ticker: str, days: int = 30) -> int:
    cur = conn.execute(
        """
        SELECT COUNT(*) FROM insider_trades
        WHERE ticker = ?
          AND transaction_type = 'Sell'
          AND transaction_date >= date('now', ?)
        """,
        (ticker, f"-{days} days"),
    )
    return cur.fetchone()[0]


def has_congress_sale(conn: sqlite3.Connection, ticker: str, days: int = 30) -> bool:
    cur = conn.execute(
        """
        SELECT 1 FROM congress_trades
        WHERE ticker = ?
          AND transaction_type = 'Sale'
          AND transaction_date >= date('now', ?)
        LIMIT 1
        """,
        (ticker, f"-{days} days"),
    )
    return cur.fetchone() is not None


def get_congress_buys_for(conn: sqlite3.Connection, ticker: str, days: int = 30) -> list[dict]:
    cur = conn.execute(
        """
        SELECT transaction_date, transaction_type, amount_range
        FROM congress_trades
        WHERE ticker = ?
          AND transaction_type = 'Purchase'
          AND transaction_date >= date('now', ?)
        ORDER BY transaction_date DESC
        """,
        (ticker, f"-{days} days"),
    )
    return [dict(row) for row in cur.fetchall()]


def get_latest_fear_greed_score(conn: sqlite3.Connection) -> float | None:
    cur = conn.execute(
        "SELECT score FROM fear_greed ORDER BY captured_at DESC LIMIT 1"
    )
    row = cur.fetchone()
    return row[0] if row else None


def has_yield_uninversion(conn: sqlite3.Connection, days: int = 30) -> bool:
    """True if yield curve spread went from negative to positive in the last N days."""
    cur_latest = conn.execute(
        "SELECT spread FROM yield_curve ORDER BY date DESC LIMIT 1"
    )
    latest = cur_latest.fetchone()
    if not latest or latest[0] is None or latest[0] <= 0:
        return False
    cur_neg = conn.execute(
        """
        SELECT 1 FROM yield_curve
        WHERE date >= date('now', ?)
          AND spread < 0
        LIMIT 1
        """,
        (f"-{days} days",),
    )
    return cur_neg.fetchone() is not None


def has_major_contract_for(
    conn: sqlite3.Connection, ticker: str, days: int = 30, min_amount: float = 100_000_000
) -> bool:
    cur = conn.execute(
        """
        SELECT 1 FROM contracts
        WHERE ticker = ?
          AND amount >= ?
          AND start_date >= date('now', ?)
        LIMIT 1
        """,
        (ticker, min_amount, f"-{days} days"),
    )
    return cur.fetchone() is not None


# ---------- fundamentals ----------

def upsert_fundamentals(conn: sqlite3.Connection, records: list[Fundamentals]) -> None:
    conn.executemany(
        """
        INSERT INTO fundamentals
            (ticker, fetched_at, sector, industry, pe_ratio, forward_pe,
             peg_ratio, pb_ratio, revenue_growth, profit_margin, market_cap)
        VALUES
            (:ticker, :fetched_at, :sector, :industry, :pe_ratio, :forward_pe,
             :peg_ratio, :pb_ratio, :revenue_growth, :profit_margin, :market_cap)
        ON CONFLICT(ticker) DO UPDATE SET
            fetched_at=excluded.fetched_at, sector=excluded.sector,
            industry=excluded.industry, pe_ratio=excluded.pe_ratio,
            forward_pe=excluded.forward_pe, peg_ratio=excluded.peg_ratio,
            pb_ratio=excluded.pb_ratio, revenue_growth=excluded.revenue_growth,
            profit_margin=excluded.profit_margin, market_cap=excluded.market_cap
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def get_fundamentals(conn: sqlite3.Connection) -> list[Fundamentals]:
    cur = conn.execute("SELECT * FROM fundamentals ORDER BY ticker ASC")
    return [Fundamentals(**dict(row)) for row in cur.fetchall()]


def get_fundamentals_for(conn: sqlite3.Connection, ticker: str) -> "Fundamentals | None":
    cur = conn.execute("SELECT * FROM fundamentals WHERE ticker = ?", (ticker,))
    row = cur.fetchone()
    return Fundamentals(**dict(row)) if row else None


# ---------- boom score history ----------

def insert_boom_score_history(conn: sqlite3.Connection, scores: list[BoomScore]) -> None:
    conn.executemany(
        "INSERT INTO boom_score_history (ticker, score, computed_at) VALUES (?, ?, ?)",
        [(s.ticker, s.score, s.computed_at) for s in scores],
    )
    conn.commit()


def get_boom_score_history(conn: sqlite3.Connection, ticker: str, days: int = 30) -> list[dict]:
    cur = conn.execute(
        """
        SELECT computed_at, score FROM boom_score_history
        WHERE ticker = ?
          AND computed_at >= datetime('now', ?)
        ORDER BY computed_at ASC
        """,
        (ticker, f"-{days} days"),
    )
    return [{"computed_at": row[0], "score": row[1]} for row in cur.fetchall()]


# ---------- seasonality ----------

def upsert_seasonality(conn: sqlite3.Connection, records: list[Seasonality]) -> None:
    conn.executemany(
        """
        INSERT INTO seasonality
            (ticker, computed_at, as_of, history_years, windows_json, anchors_json)
        VALUES
            (:ticker, :computed_at, :as_of, :history_years, :windows_json, :anchors_json)
        ON CONFLICT(ticker) DO UPDATE SET
            computed_at=excluded.computed_at, as_of=excluded.as_of,
            history_years=excluded.history_years, windows_json=excluded.windows_json,
            anchors_json=excluded.anchors_json
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def get_seasonality(conn: sqlite3.Connection) -> list[Seasonality]:
    cur = conn.execute("SELECT * FROM seasonality ORDER BY ticker ASC")
    return [Seasonality(**dict(row)) for row in cur.fetchall()]


def get_seasonality_for(conn: sqlite3.Connection, ticker: str) -> Seasonality | None:
    cur = conn.execute("SELECT * FROM seasonality WHERE ticker = ?", (ticker,))
    row = cur.fetchone()
    return Seasonality(**dict(row)) if row else None


# ---------- portfolio (user managed) ----------

def upsert_holding(conn: sqlite3.Connection, user_id: int, item: Holding) -> None:
    """Add shares to a position, merging into any existing holding.

    On conflict the shares are summed and ``avg_cost`` becomes the
    share-weighted average of the existing and incoming cost basis, so P/L
    stays correct. ``added_at`` (first-buy date) is preserved. In SQLite's
    ``DO UPDATE SET`` every RHS expression evaluates against the pre-update
    row, so the ordering of the two assignments below is safe.
    """
    conn.execute(
        """
        INSERT INTO portfolio (user_id, ticker, shares, avg_cost, added_at)
        VALUES (:user_id, :ticker, :shares, :avg_cost, :added_at)
        ON CONFLICT(user_id, ticker) DO UPDATE SET
            avg_cost = (portfolio.shares * portfolio.avg_cost
                        + excluded.shares * excluded.avg_cost)
                       / (portfolio.shares + excluded.shares),
            shares   = portfolio.shares + excluded.shares
        """,
        {"user_id": user_id, **item.model_dump()},
    )
    conn.commit()


def replace_holding(
    conn: sqlite3.Connection, user_id: int, ticker: str, shares: float, avg_cost: float
) -> None:
    """Overwrite an existing position outright (the edit/correct path)."""
    conn.execute(
        "UPDATE portfolio SET shares = ?, avg_cost = ? "
        "WHERE user_id = ? AND ticker = ?",
        (shares, avg_cost, user_id, ticker),
    )
    conn.commit()


def remove_holding(conn: sqlite3.Connection, user_id: int, ticker: str) -> None:
    conn.execute(
        "DELETE FROM portfolio WHERE user_id = ? AND ticker = ?", (user_id, ticker))
    conn.commit()


def get_portfolio(conn: sqlite3.Connection, user_id: int) -> list[Holding]:
    cur = conn.execute(
        "SELECT ticker, shares, avg_cost, added_at FROM portfolio "
        "WHERE user_id = ? ORDER BY ticker ASC",
        (user_id,),
    )
    return [Holding(**dict(row)) for row in cur.fetchall()]


def get_all_portfolio_tickers(conn: sqlite3.Connection) -> list[str]:
    """Every ticker held by any user — the ingestion pipeline's universe."""
    cur = conn.execute("SELECT DISTINCT ticker FROM portfolio ORDER BY ticker")
    return [row[0] for row in cur.fetchall()]


# ---------- notify profile (one row per user) ----------

def get_notify_profile(conn: sqlite3.Connection, user_id: int) -> NotifyProfile:
    cur = conn.execute("SELECT * FROM notify_profile WHERE user_id = ?", (user_id,))
    row = cur.fetchone()
    if row is None:
        return NotifyProfile()
    d = dict(row)
    return NotifyProfile(
        email=d.get("email"),
        phone=d.get("phone"),
        email_enabled=bool(d.get("email_enabled")),
        sms_enabled=bool(d.get("sms_enabled")),
        account_size=d.get("account_size"),
        risk_pct=d.get("risk_pct") if d.get("risk_pct") is not None else 1.0,
        updated_at=d.get("updated_at") or "",
    )


def upsert_notify_profile(conn: sqlite3.Connection, user_id: int,
                          profile: NotifyProfile) -> None:
    conn.execute(
        """
        INSERT INTO notify_profile (user_id, email, phone, email_enabled, sms_enabled, account_size, risk_pct, updated_at)
        VALUES (:user_id, :email, :phone, :email_enabled, :sms_enabled, :account_size, :risk_pct, :updated_at)
        ON CONFLICT(user_id) DO UPDATE SET
            email=excluded.email, phone=excluded.phone,
            email_enabled=excluded.email_enabled, sms_enabled=excluded.sms_enabled,
            account_size=excluded.account_size, risk_pct=excluded.risk_pct,
            updated_at=excluded.updated_at
        """,
        {
            "user_id": user_id,
            "email": profile.email,
            "phone": profile.phone,
            "email_enabled": int(profile.email_enabled),
            "sms_enabled": int(profile.sms_enabled),
            "account_size": profile.account_size,
            "risk_pct": profile.risk_pct,
            "updated_at": profile.updated_at,
        },
    )
    conn.commit()


# ---------- app settings (single row) ----------

def get_app_settings(conn: sqlite3.Connection) -> AppSettings:
    cur = conn.execute("SELECT * FROM app_settings WHERE id = 1")
    row = cur.fetchone()
    if row is None:
        return AppSettings()
    d = dict(row)
    return AppSettings(
        analysis_time=d.get("analysis_time") or "15:30",
        analysis_tz=d.get("analysis_tz") or "Asia/Jerusalem",
        quotes_refresh_seconds=d.get("quotes_refresh_seconds") or 30,
        updated_at=d.get("updated_at") or "",
    )


def upsert_app_settings(conn: sqlite3.Connection, settings: AppSettings) -> None:
    conn.execute(
        """
        INSERT INTO app_settings (id, analysis_time, analysis_tz, quotes_refresh_seconds, updated_at)
        VALUES (1, :analysis_time, :analysis_tz, :quotes_refresh_seconds, :updated_at)
        ON CONFLICT(id) DO UPDATE SET
            analysis_time=excluded.analysis_time, analysis_tz=excluded.analysis_tz,
            quotes_refresh_seconds=excluded.quotes_refresh_seconds,
            updated_at=excluded.updated_at
        """,
        {
            "analysis_time": settings.analysis_time,
            "analysis_tz": settings.analysis_tz,
            "quotes_refresh_seconds": settings.quotes_refresh_seconds,
            "updated_at": settings.updated_at,
        },
    )
    conn.commit()


# ---------- OHLC series + technical analysis ----------

def upsert_ohlc(conn: sqlite3.Connection, series: list[OHLCSeries]) -> None:
    conn.executemany(
        """
        INSERT INTO ohlc_series (ticker, interval, bars_json, fetched_at)
        VALUES (:ticker, :interval, :bars_json, :fetched_at)
        ON CONFLICT(ticker, interval) DO UPDATE SET
            bars_json=excluded.bars_json, fetched_at=excluded.fetched_at
        """,
        [s.model_dump() for s in series],
    )
    conn.commit()


def get_ohlc(conn: sqlite3.Connection, ticker: str, interval: str = "daily") -> list[OHLCBar]:
    cur = conn.execute(
        "SELECT bars_json FROM ohlc_series WHERE ticker = ? AND interval = ?",
        (ticker.upper(), interval),
    )
    row = cur.fetchone()
    if row is None:
        return []
    try:
        return [OHLCBar(**b) for b in json.loads(row["bars_json"])]
    except (ValueError, TypeError):
        return []


def upsert_analyses(conn: sqlite3.Connection, analyses: list[StockAnalysis]) -> None:
    conn.executemany(
        """
        INSERT INTO stock_analysis (ticker, computed_at, payload_json)
        VALUES (:ticker, :computed_at, :payload_json)
        ON CONFLICT(ticker) DO UPDATE SET
            computed_at=excluded.computed_at, payload_json=excluded.payload_json
        """,
        [{"ticker": a.ticker, "computed_at": a.computed_at, "payload_json": a.model_dump_json()}
         for a in analyses],
    )
    conn.commit()


def get_analysis(conn: sqlite3.Connection, ticker: str) -> StockAnalysis | None:
    cur = conn.execute("SELECT payload_json FROM stock_analysis WHERE ticker = ?", (ticker.upper(),))
    row = cur.fetchone()
    if row is None:
        return None
    try:
        return StockAnalysis(**json.loads(row["payload_json"]))
    except (ValueError, TypeError):
        return None


def get_all_analyses(conn: sqlite3.Connection) -> list[StockAnalysis]:
    cur = conn.execute("SELECT payload_json FROM stock_analysis")
    out: list[StockAnalysis] = []
    for row in cur.fetchall():
        try:
            out.append(StockAnalysis(**json.loads(row["payload_json"])))
        except (ValueError, TypeError):
            continue
    return out


# ---------- suggestion log (append-only) ----------

def insert_suggestion_log(conn: sqlite3.Connection, entries: list[SuggestionLogEntry]) -> None:
    conn.executemany(
        """
        INSERT INTO suggestion_log (created_at, for_date, channel, status)
        VALUES (:created_at, :for_date, :channel, :status)
        """,
        [e.model_dump() for e in entries],
    )
    conn.commit()


def get_recent_suggestions(conn: sqlite3.Connection, limit: int = 20) -> list[SuggestionLogEntry]:
    cur = conn.execute(
        "SELECT created_at, for_date, channel, status FROM suggestion_log ORDER BY id DESC LIMIT ?",
        (limit,),
    )
    return [SuggestionLogEntry(**dict(row)) for row in cur.fetchall()]


# ---------- alerts ----------

def upsert_alerts(conn: sqlite3.Connection, records: list[Alert]) -> None:
    conn.executemany(
        """
        INSERT INTO alerts (dedup_key, created_at, ticker, type, severity, title, message, read, pushed)
        VALUES (:dedup_key, :created_at, :ticker, :type, :severity, :title, :message, :read, :pushed)
        ON CONFLICT(dedup_key) DO NOTHING
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def _row_to_alert(d: dict) -> Alert:
    d["read"] = bool(d["read"])
    d["pushed"] = bool(d["pushed"])
    return Alert(**d)


def get_alerts(conn: sqlite3.Connection, user_id: int, limit: int = 100) -> list[Alert]:
    """Alerts are global (market events); read-state is per user via alert_reads."""
    cur = conn.execute(
        """
        SELECT a.dedup_key, a.created_at, a.ticker, a.type, a.severity, a.title,
               a.message, (ar.dedup_key IS NOT NULL) AS read, a.pushed
        FROM alerts a
        LEFT JOIN alert_reads ar
            ON ar.dedup_key = a.dedup_key AND ar.user_id = ?
        ORDER BY a.id DESC LIMIT ?
        """,
        (user_id, limit),
    )
    return [_row_to_alert(dict(row)) for row in cur.fetchall()]


def count_unread_alerts(conn: sqlite3.Connection, user_id: int) -> int:
    return conn.execute(
        """
        SELECT COUNT(*) FROM alerts a
        WHERE NOT EXISTS (
            SELECT 1 FROM alert_reads ar
            WHERE ar.user_id = ? AND ar.dedup_key = a.dedup_key
        )
        """,
        (user_id,),
    ).fetchone()[0]


def mark_alerts_read(conn: sqlite3.Connection, user_id: int,
                     keys: list[str] | None = None, read_at: str = "") -> None:
    if keys:
        conn.executemany(
            "INSERT OR IGNORE INTO alert_reads (user_id, dedup_key, read_at) VALUES (?, ?, ?)",
            [(user_id, k, read_at) for k in keys],
        )
    else:
        conn.execute(
            "INSERT OR IGNORE INTO alert_reads (user_id, dedup_key, read_at) "
            "SELECT ?, dedup_key, ? FROM alerts",
            (user_id, read_at),
        )
    conn.commit()


def alert_exists(conn: sqlite3.Connection, dedup_key: str) -> bool:
    return conn.execute("SELECT 1 FROM alerts WHERE dedup_key = ? LIMIT 1", (dedup_key,)).fetchone() is not None


# ---------- alert_state (transition memory) ----------

def get_alert_state(conn: sqlite3.Connection, ticker: str) -> dict | None:
    row = conn.execute("SELECT * FROM alert_state WHERE ticker = ?", (ticker,)).fetchone()
    return dict(row) if row else None


def upsert_alert_state(
    conn: sqlite3.Connection, ticker: str, score: int | None,
    golden_cross: bool | None, insider_cluster_buy: bool | None, updated_at: str,
) -> None:
    conn.execute(
        """
        INSERT INTO alert_state (ticker, score, golden_cross, insider_cluster_buy, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(ticker) DO UPDATE SET
            score=excluded.score, golden_cross=excluded.golden_cross,
            insider_cluster_buy=excluded.insider_cluster_buy, updated_at=excluded.updated_at
        """,
        (ticker, score, int(golden_cross) if golden_cross is not None else None,
         int(insider_cluster_buy) if insider_cluster_buy is not None else None, updated_at),
    )
    conn.commit()


# ---------- users, sessions & recovery codes ----------
def create_user(conn: sqlite3.Connection, email: str, password_hash: str,
                created_at: str, is_admin: bool = False) -> User:
    cur = conn.execute(
        "INSERT INTO users (email, password_hash, created_at, is_admin) VALUES (?, ?, ?, ?)",
        (email, password_hash, created_at, int(is_admin)),
    )
    conn.commit()
    return get_user(conn, cur.lastrowid)


def get_user(conn: sqlite3.Connection, user_id: int) -> User | None:
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return User(**dict(row)) if row else None


def get_user_by_email(conn: sqlite3.Connection, email: str) -> User | None:
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    return User(**dict(row)) if row else None


def count_users(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]


def get_users(conn: sqlite3.Connection) -> list[User]:
    cur = conn.execute("SELECT * FROM users ORDER BY id ASC")
    return [User(**dict(row)) for row in cur.fetchall()]


def set_totp_secret(conn: sqlite3.Connection, user_id: int, secret: str) -> None:
    conn.execute("UPDATE users SET totp_secret = ? WHERE id = ?", (secret, user_id))
    conn.commit()


def enable_totp(conn: sqlite3.Connection, user_id: int) -> None:
    conn.execute("UPDATE users SET totp_enabled = 1 WHERE id = ?", (user_id,))
    conn.commit()


def create_session(conn: sqlite3.Connection, session: AuthSession) -> None:
    conn.execute(
        """
        INSERT INTO sessions (token_hash, user_id, state, created_at, expires_at, last_seen_at)
        VALUES (:token_hash, :user_id, :state, :created_at, :expires_at, :last_seen_at)
        """,
        session.model_dump(),
    )
    conn.commit()


def get_session(conn: sqlite3.Connection, token_hash: str) -> AuthSession | None:
    row = conn.execute(
        "SELECT * FROM sessions WHERE token_hash = ?", (token_hash,)
    ).fetchone()
    return AuthSession(**dict(row)) if row else None


def touch_session(conn: sqlite3.Connection, token_hash: str, last_seen_at: str) -> None:
    conn.execute(
        "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?",
        (last_seen_at, token_hash),
    )
    conn.commit()


def delete_session(conn: sqlite3.Connection, token_hash: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
    conn.commit()


def purge_expired_sessions(conn: sqlite3.Connection, now_iso: str) -> None:
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now_iso,))
    conn.commit()


def replace_recovery_codes(conn: sqlite3.Connection, user_id: int,
                           code_hashes: list[str]) -> None:
    conn.execute("DELETE FROM recovery_codes WHERE user_id = ?", (user_id,))
    conn.executemany(
        "INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)",
        [(user_id, h) for h in code_hashes],
    )
    conn.commit()


def consume_recovery_code(conn: sqlite3.Connection, user_id: int,
                          code_hash: str, used_at: str) -> bool:
    """Mark one unused code as used. Returns False if no such unused code."""
    cur = conn.execute(
        "UPDATE recovery_codes SET used_at = ? "
        "WHERE user_id = ? AND code_hash = ? AND used_at IS NULL",
        (used_at, user_id, code_hash),
    )
    conn.commit()
    return cur.rowcount == 1


def count_unused_recovery_codes(conn: sqlite3.Connection, user_id: int) -> int:
    return conn.execute(
        "SELECT COUNT(*) FROM recovery_codes WHERE user_id = ? AND used_at IS NULL",
        (user_id,),
    ).fetchone()[0]


def _has_column(conn: sqlite3.Connection, table: str, col: str) -> bool:
    return any(r[1] == col for r in conn.execute(f"PRAGMA table_info({table})"))


def claim_legacy_rows(conn: sqlite3.Connection, user_id: int) -> None:
    """Assign pre-auth single-user data (user_id=0 sentinel) to `user_id`.

    Called when the first account registers, so an existing single-user DB
    migrates to its owner. No-op on tables that predate the user_id column.
    """
    for table in ("watchlist", "portfolio", "notify_profile"):
        if _has_column(conn, table, "user_id"):
            conn.execute(f"UPDATE {table} SET user_id = ? WHERE user_id = 0", (user_id,))
    conn.commit()


# --- Thread safety -------------------------------------------------------
# One shared SQLite connection (check_same_thread=False) is used by FastAPI's
# threadpool AND the APScheduler jobs. sqlite3 forbids *concurrent* use of a
# single connection, which otherwise corrupts cursor results (all-NULL rows,
# InterfaceError, "tuple index out of range"). Serialize every public db access
# on a re-entrant lock carried by the connection object (see connect()), so the
# lock is shared even if this module is imported under two names. Holding the
# lock for the whole function keeps each execute+fetch atomic; RLock lets db
# functions call each other on the same thread without deadlock.
def _conn_lock(args, kwargs):
    conn = args[0] if args else kwargs.get("conn")
    return getattr(conn, "_app_lock", None)


def _synchronized(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        lock = _conn_lock(args, kwargs)
        if lock is None:
            return fn(*args, **kwargs)
        with lock:
            return fn(*args, **kwargs)
    return wrapper


_module = sys.modules[__name__]
for _name, _obj in list(vars(_module).items()):
    if (
        inspect.isfunction(_obj)
        and _obj.__module__ == __name__
        and not _name.startswith("_")
    ):
        setattr(_module, _name, _synchronized(_obj))
