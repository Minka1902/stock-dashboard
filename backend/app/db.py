"""All SQLite access lives here."""
import sqlite3

from app.models import (
    CongressTrade,
    ContractRecord,
    FearGreedSnapshot,
    InsiderTrade,
    NewsArticle,
    SourceStatus,
    TechnicalSignal,
    WatchItem,
    YieldPoint,
)


def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


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
            ticker   TEXT PRIMARY KEY,
            note     TEXT NOT NULL,
            added_at TEXT NOT NULL
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
        """
    )
    conn.commit()


# ---------- contracts ----------
def upsert_contracts(conn: sqlite3.Connection, records: list[ContractRecord]) -> None:
    conn.executemany(
        """
        INSERT INTO contracts
            (external_id, award_id, recipient_name, amount, awarding_agency, start_date, source)
        VALUES (:external_id, :award_id, :recipient_name, :amount, :awarding_agency, :start_date, :source)
        ON CONFLICT(external_id) DO UPDATE SET
            award_id=excluded.award_id,
            recipient_name=excluded.recipient_name,
            amount=excluded.amount,
            awarding_agency=excluded.awarding_agency,
            start_date=excluded.start_date,
            source=excluded.source
        """,
        [r.model_dump() for r in records],
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
        INSERT INTO news (url, title, domain, seendate, sourcecountry, image)
        VALUES (:url, :title, :domain, :seendate, :sourcecountry, :image)
        ON CONFLICT(url) DO UPDATE SET
            title=excluded.title,
            domain=excluded.domain,
            seendate=excluded.seendate,
            sourcecountry=excluded.sourcecountry,
            image=excluded.image
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def get_news(conn: sqlite3.Connection, limit: int = 60) -> list[NewsArticle]:
    cur = conn.execute(
        "SELECT * FROM news ORDER BY seendate DESC LIMIT ?", (limit,)
    )
    return [NewsArticle(**dict(row)) for row in cur.fetchall()]


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


# ---------- watchlist (user managed) ----------
def add_watch(conn: sqlite3.Connection, item: WatchItem) -> None:
    conn.execute(
        """
        INSERT INTO watchlist (ticker, note, added_at)
        VALUES (:ticker, :note, :added_at)
        ON CONFLICT(ticker) DO UPDATE SET note=excluded.note
        """,
        item.model_dump(),
    )
    conn.commit()


def remove_watch(conn: sqlite3.Connection, ticker: str) -> None:
    conn.execute("DELETE FROM watchlist WHERE ticker = ?", (ticker,))
    conn.commit()


def get_watchlist(conn: sqlite3.Connection) -> list[WatchItem]:
    cur = conn.execute("SELECT * FROM watchlist ORDER BY added_at DESC")
    return [WatchItem(**dict(row)) for row in cur.fetchall()]


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


# ---------- technical signals ----------
def upsert_technical_signals(conn: sqlite3.Connection, records: list[TechnicalSignal]) -> None:
    conn.executemany(
        """
        INSERT INTO technical_signals
            (ticker, fetched_at, price, change_pct, ma50, ma200,
             golden_cross, rsi14, high_52w, low_52w, prices_json)
        VALUES
            (:ticker, :fetched_at, :price, :change_pct, :ma50, :ma200,
             :golden_cross, :rsi14, :high_52w, :low_52w, :prices_json)
        ON CONFLICT(ticker) DO UPDATE SET
            fetched_at=excluded.fetched_at, price=excluded.price,
            change_pct=excluded.change_pct, ma50=excluded.ma50,
            ma200=excluded.ma200, golden_cross=excluded.golden_cross,
            rsi14=excluded.rsi14, high_52w=excluded.high_52w,
            low_52w=excluded.low_52w, prices_json=excluded.prices_json
        """,
        [r.model_dump() for r in records],
    )
    conn.commit()


def get_technical_signals(conn: sqlite3.Connection) -> list[TechnicalSignal]:
    cur = conn.execute("SELECT * FROM technical_signals ORDER BY ticker ASC")
    rows = []
    for row in cur.fetchall():
        d = dict(row)
        # SQLite stores bool as 0/1; convert back to bool | None
        gc = d.get("golden_cross")
        d["golden_cross"] = bool(gc) if gc is not None else None
        rows.append(TechnicalSignal(**d))
    return rows


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
