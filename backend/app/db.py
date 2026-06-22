"""All SQLite access lives here."""
import sqlite3

from app.models import (
    ContractRecord,
    InsiderTrade,
    NewsArticle,
    SourceStatus,
    WatchItem,
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
