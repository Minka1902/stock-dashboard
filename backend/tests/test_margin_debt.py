from app.models import MarginDebtPoint
from app.sources import margin_debt

SAMPLE_HTML = """
<html><body>
<h1>Margin Statistics</h1>
<table>
  <tr><th>Month/Year</th><th>Debit Balances in Customers' Securities Margin Accounts</th>
      <th>Free Credit Balances in Customers' Cash Accounts</th></tr>
  <tr><td>May 2026</td><td>1,050,123</td><td>180,000</td></tr>
  <tr><td>April 2026</td><td>1,010,500</td><td>175,250</td></tr>
  <tr><td>March 2026</td><td>995,000</td><td>170,000</td></tr>
</table>
<table>
  <tr><td>May-25</td><td>677,499</td><td>160,000</td></tr>
  <tr><td>Apr-25</td><td>650,000</td><td>158,000</td></tr>
</table>
</body></html>
"""


def test_parse_extracts_first_column_per_month():
    points = margin_debt.parse_response(SAMPLE_HTML)
    by_month = {p.month: p.debit_balances for p in points}
    assert by_month["2026-05"] == 1_050_123.0  # not the 180,000 credit column
    assert by_month["2026-04"] == 1_010_500.0
    assert by_month["2025-05"] == 677_499.0


def test_parse_handles_both_month_formats_sorted_asc():
    points = margin_debt.parse_response(SAMPLE_HTML)
    months = [p.month for p in points]
    assert months == sorted(months)
    assert "2025-04" in months  # "Apr-25" abbreviated form
    assert "2026-03" in months  # "March 2026" full form


def test_parse_drops_implausible_values():
    html = "<table><tr><td>May 2026</td><td>1,234</td></tr></table>"  # < 10,000 → junk
    assert margin_debt.parse_response(html) == []


def test_parse_returns_empty_on_garbage():
    assert margin_debt.parse_response("") == []
    assert margin_debt.parse_response("<html><p>maintenance page</p></html>") == []


def _point(month, value):
    return MarginDebtPoint(month=month, debit_balances=value)


def test_compute_yoy_math():
    points = [_point("2025-05", 677_499.0), _point("2026-05", 1_050_123.0)]
    rows = margin_debt.compute_yoy(points)
    assert rows[0]["yoy_pct"] is None  # no 2024-05
    assert rows[1]["yoy_pct"] == round((1_050_123.0 / 677_499.0 - 1) * 100, 1)  # ≈ 55.0


def test_compute_yoy_missing_prior_year_is_none():
    rows = margin_debt.compute_yoy([_point("2026-05", 1_000_000.0), _point("2026-04", 990_000.0)])
    assert all(r["yoy_pct"] is None for r in rows)


def test_compute_yoy_zero_prior_is_none():
    rows = margin_debt.compute_yoy([_point("2025-05", 0.0), _point("2026-05", 1_000_000.0)])
    assert rows[1]["yoy_pct"] is None


def test_compute_yoy_preserves_month_and_balance():
    rows = margin_debt.compute_yoy([_point("2026-05", 1_000_000.0)])
    assert rows == [{"month": "2026-05", "debit_balances": 1_000_000.0, "yoy_pct": None}]
