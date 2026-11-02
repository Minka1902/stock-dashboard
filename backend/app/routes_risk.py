"""Exit rules on holdings and the account's risk switches (STC-9).

- `/api/portfolio/rules` lists a book's rules with a suggested stop for every
  holding that has none; `/api/portfolio/{ticker}/rules` reads, saves and
  deletes one. Rules belong to a held position, so saving one for a ticker
  you don't hold is refused.
- `/api/risk/*` is the drawdown kill switch: its limit, its state and the
  acknowledge that re-enables new entries after a trip.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import auth, db, exits, notify, quotes, risk
from app.models import PositionRule
from app.validation import clean_ticker, validate_exit_rule

RULE_ACCOUNTS = ("manual", "paper")


class RuleBody(BaseModel):
    stop_price: float | str | None = None
    stop_pct: float | str | None = None
    take_profit: float | str | None = None
    trailing_pct: float | str | None = None
    active: bool = True


class RiskSettingsBody(BaseModel):
    max_drawdown_pct: float | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _account(account: str) -> str:
    if account == "live":
        raise HTTPException(status_code=409, detail="no live broker configured")
    if account not in RULE_ACCOUNTS:
        raise HTTPException(status_code=400, detail="account must be 'manual' or 'paper'")
    return account


def _prices(conn, tickers: list[str]) -> dict[str, tuple[float, str]]:
    """{ticker: (price, where it came from)}: the live quote, else the last
    daily close. Tickers with neither are left out."""
    live = {q.ticker: q.price for q in quotes.get_quotes(tickers) if q.price} if tickers else {}
    out = {}
    for t in tickers:
        if t in live:
            out[t] = (live[t], "live")
            continue
        bars = db.get_ohlc(conn, t, "daily")
        if bars:
            out[t] = (bars[-1].close, f"the {bars[-1].date} close")
    return out


def _view(conn, ticker: str, rule: PositionRule | None, holding,
          price: tuple[float, str] | None) -> dict:
    px = price[0] if price else None
    out = {
        "ticker": ticker,
        "held": holding is not None,
        "shares": holding.shares if holding else None,
        "avg_cost": holding.avg_cost if holding else None,
        "currency": holding.currency if holding else None,
        "price": px,
        "price_source": price[1] if price else None,
        "rule": rule.model_dump() if rule else None,
        "levels": None,
        "suggested": None,
    }
    if rule and holding:
        out["levels"] = {"stop": exits.stop_level(rule, holding.avg_cost),
                         "take_profit": rule.take_profit, "trailing": exits.trail_level(rule)}
    if holding and not (rule and exits.stop_level(rule, holding.avg_cost) is not None):
        out["suggested"] = exits.suggested_stop(db.get_analysis(conn, holding.ticker), px)
    return out


def build_router(conn) -> APIRouter:
    router = APIRouter()

    @router.get("/api/portfolio/rules")
    def list_rules(account: str = "manual", user=Depends(auth.get_current_user)):
        acct = _account(account)
        holdings = {h.ticker: h for h in db.get_portfolio(conn, user.id, acct)}
        rules = {r.ticker: r for r in db.get_position_rules(conn, user.id, acct)}
        tickers = sorted(set(holdings) | set(rules))
        prices = _prices(conn, sorted(holdings))
        return {"account": acct, "items": [
            _view(conn, t, rules.get(t), holdings.get(t), prices.get(t)) for t in tickers]}

    @router.get("/api/portfolio/{ticker}/rules")
    def get_rule(ticker: str, account: str = "manual", user=Depends(auth.get_current_user)):
        t, acct = clean_ticker(ticker), _account(account)
        holding = next((h for h in db.get_portfolio(conn, user.id, acct) if h.ticker == t), None)
        return _view(conn, t, db.get_position_rule(conn, user.id, acct, t), holding,
                     _prices(conn, [t]).get(t) if holding else None)

    @router.put("/api/portfolio/{ticker}/rules")
    def put_rule(ticker: str, body: RuleBody, account: str = "manual",
                 user=Depends(auth.get_current_user)):
        t, acct = clean_ticker(ticker), _account(account)
        holding = next((h for h in db.get_portfolio(conn, user.id, acct) if h.ticker == t), None)
        if holding is None:
            raise HTTPException(status_code=409, detail=f"you don't hold {t} in this account")
        price = _prices(conn, [t]).get(t) or (holding.avg_cost, "your average cost")
        clean, errors = validate_exit_rule(body.model_dump(), price[0], holding.avg_cost)
        if errors:
            raise HTTPException(status_code=422, detail={
                "message": "Some fields need attention", "errors": errors})
        existing = db.get_position_rule(conn, user.id, acct, t)
        now = _now()
        # A trail that stays on keeps its high; a new one starts at today's price.
        trail_high = None
        if clean["trailing_pct"] is not None:
            kept = existing.trail_high if existing and existing.trailing_pct is not None else None
            trail_high = max(kept or 0, price[0])
        rule = db.upsert_position_rule(conn, PositionRule(
            user_id=user.id, account=acct, ticker=t, trail_high=trail_high,
            created_at=existing.created_at if existing else now, updated_at=now, **clean))
        return _view(conn, t, rule, holding, price)

    @router.delete("/api/portfolio/{ticker}/rules")
    def delete_rule(ticker: str, account: str = "manual", user=Depends(auth.get_current_user)):
        t, acct = clean_ticker(ticker), _account(account)
        if not db.delete_position_rule(conn, user.id, acct, t):
            raise HTTPException(status_code=404, detail="no rule for that ticker")
        return {"deleted": t}

    @router.get("/api/risk/status")
    def risk_status(user=Depends(auth.get_current_user)):
        return risk.status(conn, user.id)

    @router.put("/api/risk/settings")
    def put_risk_settings(body: RiskSettingsBody, user=Depends(auth.get_current_user)):
        pct = body.max_drawdown_pct
        lo, hi = risk.MAX_DRAWDOWN_RANGE
        if pct is not None and not lo <= pct <= hi:
            raise HTTPException(status_code=422, detail={
                "message": "Some fields need attention",
                "errors": {"max_drawdown_pct": f"Between {lo:g}% and {hi:g}%, or off"}})
        risk.set_max_drawdown(conn, user.id, pct)
        # A limit already exceeded trips now rather than at tonight's snapshot.
        alert = risk.check_user(conn, user.id)
        if alert:
            notify.push_stored(conn, [alert])
        return risk.status(conn, user.id)

    @router.post("/api/risk/drawdown/acknowledge")
    def acknowledge(user=Depends(auth.get_current_user)):
        if not risk.acknowledge(conn, user.id):
            raise HTTPException(status_code=409, detail="the kill switch isn't tripped")
        return risk.status(conn, user.id)

    return router
