"""Order execution (STC-40, STC-42): every order goes through `submit`.

`submit` is the single choke point — validation now, the guardrails and the
audit log hook in here too — and then hands the order to the account's broker:

- `PaperBroker` ("paper"): market orders fill at the next tradable quote moved
  against you by the shared cost model (costs.apply); limit and stop orders
  rest until a quote crosses them. Resting orders are evaluated every minute
  (`poll`), only while the ticker's market is LIVE and on a fresh quote. A day
  order still open after its session is cancelled as expired. Fills go to the
  ledger as account "paper", atomically with the order's status.
- Engine-priced fills (the demo bots): the bot engine has already priced the
  fill on a tradable quote; `submit(..., fill=...)` runs the same checks and
  then lets the engine write the fill together with its own state.

There is no live broker. "live" is refused until one is connected (STC-55).
"""
import math
import statistics
from datetime import datetime, timezone
from typing import Callable, Protocol
from zoneinfo import ZoneInfo

from app import audit, config, costs, db, ledger, quotes
from app.ledger import BOT_ACCOUNT
from app.market_calendar import exchange_for_ticker, is_trading_day, market_status, next_trading_day
from app.models import Holding, Order, Transaction

SIDES = ("BUY", "SELL")
TYPES = ("market", "limit", "stop")
TIFS = ("day", "gtc")
PAPER = "paper"
_EXCHANGE_TZ = {"NYSE": ZoneInfo("America/New_York"), "TASE": ZoneInfo("Asia/Jerusalem")}


class OrderRejected(Exception):
    """An order the checks refuse. `fields` names the bad inputs, if any."""

    def __init__(self, reason: str, fields: dict | None = None):
        super().__init__(reason)
        self.reason = reason
        self.fields = fields or {}


class Broker(Protocol):
    def account(self, conn, user_id: int) -> dict: ...
    def positions(self, conn, user_id: int) -> list[Holding]: ...
    def place_order(self, conn, order: Order, now: datetime, quote_getter=None) -> Order: ...
    def cancel(self, conn, order: Order, reason: str) -> bool: ...
    def orders(self, conn, user_id: int, statuses: tuple[str, ...] | None = None) -> list[Order]: ...
    def poll_fills(self, conn, now: datetime, quote_getter=None) -> list[Order]: ...


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def _local_date(ticker: str, dt: datetime):
    return dt.astimezone(_EXCHANGE_TZ.get(exchange_for_ticker(ticker), timezone.utc)).date()


def session_for(ticker: str, placed: datetime):
    """The session a day order belongs to: today's if placed before or during
    it, else the next one (an order entered after the close is for tomorrow)."""
    exchange = exchange_for_ticker(ticker) or "NYSE"
    local = _local_date(ticker, placed)
    if is_trading_day(local, exchange) and market_status(placed, exchange) in ("PRE", "LIVE"):
        return local
    return next_trading_day(local, exchange)


def _is_live(ticker: str, now: datetime) -> bool:
    exchange = exchange_for_ticker(ticker)
    return exchange is not None and market_status(now, exchange) == "LIVE"


def slippage_bps(side: str, fill: float, reference: float | None) -> float | None:
    """Fill against the price the decision was made at, in bps; + is a cost."""
    if not reference:
        return None
    move = (fill / reference - 1) * 10_000
    return round(move if side == "BUY" else -move, 2)


def fill_price_for(order: Order, price: float) -> float | None:
    """What a resting order fills at on a quote of `price`, or None when the
    quote doesn't reach it. Costs always move against you; a limit never
    fills worse than its limit; a stop that gaps fills at the gapped price."""
    if order.type == "market":
        return costs.apply(price, order.side)
    if order.type == "limit":
        if order.side == "BUY" and price <= order.limit_price:
            return min(costs.apply(price, "BUY"), order.limit_price)
        if order.side == "SELL" and price >= order.limit_price:
            return max(costs.apply(price, "SELL"), order.limit_price)
        return None
    if order.side == "BUY" and price >= order.stop_price:
        return costs.apply(price, "BUY")
    if order.side == "SELL" and price <= order.stop_price:
        return costs.apply(price, "SELL")
    return None


def validate(order: Order) -> None:
    """Field-level checks every order passes before anything else."""
    errors = {}
    if order.side not in SIDES:
        errors["side"] = "BUY or SELL"
    if order.type not in TYPES:
        errors["type"] = f"One of: {', '.join(TYPES)}"
    if order.tif not in TIFS:
        errors["tif"] = "day or gtc"
    if not (isinstance(order.qty, (int, float)) and math.isfinite(order.qty) and order.qty > 0):
        errors["qty"] = "Enter a quantity above 0"
    if order.type == "limit" and not (order.limit_price and order.limit_price > 0):
        errors["limit_price"] = "A limit order needs a limit price above 0"
    if order.type == "stop" and not (order.stop_price and order.stop_price > 0):
        errors["stop_price"] = "A stop order needs a stop price above 0"
    if order.account == "live":
        raise OrderRejected("no live broker is connected — paper only")
    if order.account != PAPER and not BOT_ACCOUNT.fullmatch(order.account):
        errors["account"] = "paper or a bot account"
    if errors:
        raise OrderRejected("Some fields need attention", errors)


# Checks run by submit after validation, in order: each returns a refusal
# reason or None. app/guardrails.py installs the guardrails (STC-50).
CHECKS: list[Callable[[object, Order, datetime], str | None]] = []


def _run_checks(conn, order: Order, now: datetime) -> None:
    for check in CHECKS:
        reason = check(conn, order, now)
        if reason:
            audit.record(conn, order.user_id, "order_refused", account=order.account, ticker=order.ticker,
                         side=order.side, qty=order.qty, type=order.type, guardrail=check.__name__,
                         reason=reason)
            raise OrderRejected(reason)


class PaperBroker:
    """The simulated broker behind account "paper"."""

    def account(self, conn, user_id: int) -> dict:
        return {"cash": [c.model_dump() for c in db.get_cash(conn, user_id, PAPER)]}

    def positions(self, conn, user_id: int) -> list[Holding]:
        return db.get_portfolio(conn, user_id, PAPER)

    def orders(self, conn, user_id: int, statuses=None) -> list[Order]:
        return db.get_orders(conn, user_id, PAPER, statuses)

    def place_order(self, conn, order: Order, now: datetime, quote_getter=None) -> Order:
        order = db.insert_order(conn, order.model_copy(update={"status": "submitted", "submitted_at": _iso(now)}))
        if _is_live(order.ticker, now):
            q = next(iter((quote_getter or quotes.get_quotes)([order.ticker])), None)
            return self._try_fill(conn, order, q, now) or order
        return order

    def cancel(self, conn, order: Order, reason: str = "cancelled by you") -> bool:
        return db.set_order_status(conn, order.id, "cancelled", reason)

    def _try_fill(self, conn, order: Order, q, now: datetime) -> Order | None:
        price, _ = quotes.tradable_price(q, now)
        if price is None:
            return None
        px = fill_price_for(order, price)
        if px is None:
            return None
        try:
            tx = ledger.build(order.user_id, ticker=order.ticker, side=order.side, qty=order.qty,
                              price=px, currency_code=order.currency, account=PAPER,
                              executed_at=_iso(now), source="paper_fill")
            done = db.fill_order(conn, order, tx, slippage_bps(order.side, px, order.reference_price))
        except ledger.LedgerError as exc:
            db.set_order_status(conn, order.id, "rejected", str(exc))
            audit.record(conn, order.user_id, "order_rejected", order_id=order.id, reason=str(exc))
            return db.get_order(conn, order.id)
        if done is not None:
            audit.record(conn, order.user_id, "order_filled", order_id=order.id, ticker=order.ticker,
                         side=order.side, qty=order.qty, price=px)
        return done

    def poll_fills(self, conn, now: datetime, quote_getter=None) -> list[Order]:
        """Expire day orders whose session has passed, then fill whatever a
        fresh live quote now crosses. One quote call for every live ticker."""
        open_orders = db.get_orders(conn, account=PAPER, statuses=("submitted",), limit=10_000)
        resting = []
        for o in open_orders:
            if o.tif == "day" and _local_date(o.ticker, now) > session_for(
                    o.ticker, datetime.fromisoformat(o.submitted_at or o.created_at)):
                db.set_order_status(conn, o.id, "cancelled", "expired — day order past its session")
            else:
                resting.append(o)
        live = sorted({o.ticker for o in resting if _is_live(o.ticker, now)})
        if not live:
            return []
        by_ticker = {q.ticker: q for q in (quote_getter or quotes.get_quotes)(live)}
        filled = []
        for o in resting:
            if o.ticker in by_ticker:
                done = self._try_fill(conn, o, by_ticker[o.ticker], now)
                if done is not None and done.status == "filled":
                    filled.append(done)
        return filled


PAPER_BROKER = PaperBroker()


def submit(conn, order: Order, now: datetime | None = None, quote_getter=None,
           fill: Callable[[Order], Transaction | None] | None = None) -> Order | None:
    """The one way an order enters the system. Raises OrderRejected.

    Without `fill`, the order goes to the paper broker. With `fill` (a bot
    engine that has priced the fill itself), the checks run and then `fill`
    writes order, ledger row and engine state in one transaction; a None from
    it means the bot stopped meanwhile, nothing was written, and submit
    returns None."""
    now = now or _now()
    order = order.model_copy(update={"created_at": order.created_at or _iso(now)})
    validate(order)
    _run_checks(conn, order, now)
    if fill is not None:
        done = order.model_copy(update={
            "status": "filled", "submitted_at": _iso(now), "filled_at": _iso(now),
            "slippage_bps": slippage_bps(order.side, order.fill_price, order.reference_price)})
        tx = fill(done)
        if tx is None:
            return None
        audit.record(conn, order.user_id, "order_filled", order_id=tx.order_id, account=order.account,
                     ticker=order.ticker, side=order.side, qty=order.qty, price=order.fill_price)
        return done.model_copy(update={"id": tx.order_id})
    if order.account != PAPER:
        raise OrderRejected("orders on this account are placed by its bot")
    placed = PAPER_BROKER.place_order(conn, order, now, quote_getter)
    audit.record(conn, order.user_id, "order_placed", order_id=placed.id, account=PAPER, ticker=order.ticker,
                 side=order.side, qty=order.qty, type=order.type, limit=order.limit_price,
                 stop=order.stop_price, tif=order.tif, status=placed.status)
    return placed


def cancel(conn, user_id: int, order_id: int) -> Order:
    """Cancel one of the user's open paper orders. Raises OrderRejected when
    it isn't theirs, isn't paper, or has already filled or been cancelled."""
    o = db.get_order(conn, order_id)
    if o is None or o.user_id != user_id:
        raise OrderRejected("no such order")
    if o.account != PAPER or not PAPER_BROKER.cancel(conn, o):
        raise OrderRejected(f"this order is {o.status} and can't be cancelled")
    audit.record(conn, user_id, "order_cancelled", order_id=order_id)
    return db.get_order(conn, order_id)


def poll(conn, now: datetime | None = None, quote_getter=None) -> int:
    """The minute job's paper pass. Returns the number of fills."""
    return len(PAPER_BROKER.poll_fills(conn, now or _now(), quote_getter))


def median_slippage(conn, user_id: int | None, account: str) -> dict:
    """Measured slippage of filled orders: {median_bps, n}. For a live
    account this is what COST_BPS_PER_SIDE should be calibrated to; paper
    fills are simulated with the cost model itself, so theirs only confirms
    the model and must never feed back into it."""
    values = db.get_slippage(conn, user_id, account)
    return {"median_bps": round(statistics.median(values), 2) if values else None, "n": len(values),
            "calibrates_costs": account == "live"}


def reset_paper(conn, user_id: int, amount: float, ccy: str, now: datetime | None = None) -> None:
    """Start the paper account over: cancel open orders, clear the positions
    and cash, then deposit `amount` of `ccy`. Every step is a ledger row, so
    the account still replays from its history."""
    if not (math.isfinite(amount) and amount > 0):
        raise OrderRejected("Some fields need attention", {"amount": "Enter an amount above 0"})
    at = _iso(now or _now())
    for o in db.get_orders(conn, user_id, PAPER, ("submitted",), limit=10_000):
        db.set_order_status(conn, o.id, "cancelled", "paper account reset")
    for h in db.get_portfolio(conn, user_id, PAPER):
        ledger.record(conn, user_id, ticker=h.ticker, side="ADJUST", qty=0, price=h.avg_cost,
                      currency_code=h.currency, account=PAPER, executed_at=at, source="paper_reset")
    for c in db.get_cash(conn, user_id, PAPER):
        if c.balance > 0:
            ledger.record(conn, user_id, ticker=c.currency, side="WITHDRAW", qty=c.balance,
                          currency_code=c.currency, account=PAPER, executed_at=at, source="paper_reset")
    ledger.record(conn, user_id, ticker=ccy, side="DEPOSIT", qty=amount, currency_code=ccy,
                  account=PAPER, executed_at=at, source="paper_init")
    audit.record(conn, user_id, "paper_reset", amount=amount, currency=ccy)


# The guardrails install themselves into CHECKS; importing them here means
# every path that can submit an order has them, whatever imported it first.
from app import guardrails  # noqa: E402,F401
