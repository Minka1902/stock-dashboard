"""Portfolio merge-on-add and edit/replace behavior (Task 2)."""
from app import db
from app.models import Holding


def _add(conn, ticker, shares, avg_cost, added_at):
    db.upsert_holding(conn, 1, Holding(
        ticker=ticker, shares=shares, avg_cost=avg_cost, added_at=added_at))


def test_upsert_holding_merges_shares_and_weighted_cost(conn):
    _add(conn, "AAPL", 10, 100.0, "2026-01-01T00:00:00+00:00")
    _add(conn, "AAPL", 10, 200.0, "2026-02-02T00:00:00+00:00")

    held = {h.ticker: h for h in db.get_portfolio(conn, 1)}
    aapl = held["AAPL"]
    assert aapl.shares == 20
    assert aapl.avg_cost == 150.0
    # first-buy date preserved
    assert aapl.added_at == "2026-01-01T00:00:00+00:00"


def test_upsert_holding_weighted_average_uneven(conn):
    _add(conn, "MSFT", 5, 100.0, "2026-01-01T00:00:00+00:00")
    _add(conn, "MSFT", 15, 300.0, "2026-01-05T00:00:00+00:00")
    msft = {h.ticker: h for h in db.get_portfolio(conn, 1)}["MSFT"]
    assert msft.shares == 20
    # (5*100 + 15*300) / 20 = 250
    assert msft.avg_cost == 250.0


def test_replace_holding_overwrites(conn):
    _add(conn, "NVDA", 10, 100.0, "2026-01-01T00:00:00+00:00")
    db.replace_holding(conn, 1, "NVDA", 3, 500.0)
    nvda = {h.ticker: h for h in db.get_portfolio(conn, 1)}["NVDA"]
    assert nvda.shares == 3
    assert nvda.avg_cost == 500.0
    # added_at untouched
    assert nvda.added_at == "2026-01-01T00:00:00+00:00"


# ---------- currency (WS-B) ----------

def test_holding_currency_round_trips(conn):
    db.upsert_holding(conn, 1, Holding(ticker="TEVA.TA", shares=10, avg_cost=120.5,
                                       added_at="t", currency="ILS"))
    teva = {h.ticker: h for h in db.get_portfolio(conn, 1)}["TEVA.TA"]
    assert teva.currency == "ILS"
    assert teva.avg_cost == 120.5  # native units, never converted on write


def test_holding_currency_defaults_to_usd(conn):
    _add(conn, "AAPL", 1, 100.0, "t")
    assert db.get_portfolio(conn, 1)[0].currency == "USD"


def test_legacy_rows_without_currency_read_as_usd(conn):
    """Rows written before the column existed get the column default."""
    conn.execute(
        "INSERT INTO portfolio (user_id, ticker, shares, avg_cost, added_at) "
        "VALUES (1, 'MSFT', 2, 300, 't')")
    conn.commit()
    assert db.get_portfolio(conn, 1)[0].currency == "USD"


def test_merge_keeps_the_positions_original_currency(conn):
    db.upsert_holding(conn, 1, Holding(ticker="TEVA.TA", shares=10, avg_cost=100,
                                       added_at="t", currency="ILS"))
    db.upsert_holding(conn, 1, Holding(ticker="TEVA.TA", shares=10, avg_cost=200,
                                       added_at="t2", currency="ILS"))
    teva = db.get_portfolio(conn, 1)[0]
    assert (teva.shares, teva.avg_cost, teva.currency) == (20, 150.0, "ILS")


def test_replace_holding_can_override_currency(conn):
    _add(conn, "TEVA", 1, 10.0, "t")
    db.replace_holding(conn, 1, "TEVA", 1, 10.0, currency="ILS")
    assert db.get_portfolio(conn, 1)[0].currency == "ILS"
    db.replace_holding(conn, 1, "TEVA", 2, 11.0)  # None keeps it
    assert db.get_portfolio(conn, 1)[0].currency == "ILS"


# ---------- FX watch list (per user) ----------

def test_fx_watch_seeds_once_then_respects_an_empty_list(conn):
    uid = db.create_user(conn, "fx@example.com", "hash", "t").id
    assert db.get_fx_watch(conn, uid, seed=["USDILS=X", "EURILS=X"]) == ["USDILS=X", "EURILS=X"]
    assert db.set_fx_watch(conn, uid, []) == []
    # Seeded already: removing every pair sticks.
    assert db.get_fx_watch(conn, uid, seed=["USDILS=X"]) == []


def test_fx_watch_keeps_order_and_drops_duplicates(conn):
    uid = db.create_user(conn, "fx2@example.com", "hash", "t").id
    db.set_fx_watch(conn, uid, ["EURUSD=X", "USDILS=X", "EURUSD=X"])
    assert db.get_fx_watch(conn, uid) == ["EURUSD=X", "USDILS=X"]


def test_fx_watch_is_per_user(conn):
    a = db.create_user(conn, "a@example.com", "hash", "t").id
    b = db.create_user(conn, "b@example.com", "hash", "t").id
    db.set_fx_watch(conn, a, ["GBPUSD=X"])
    assert db.get_fx_watch(conn, b, seed=["USDILS=X"]) == ["USDILS=X"]
    assert db.get_fx_watch(conn, a) == ["GBPUSD=X"]


def test_base_currency_round_trips_on_the_profile(conn):
    from app.models import NotifyProfile
    assert db.get_notify_profile(conn, 1).base_currency == "USD"
    db.upsert_notify_profile(conn, 1, NotifyProfile(base_currency="ILS", updated_at="t"))
    assert db.get_notify_profile(conn, 1).base_currency == "ILS"
