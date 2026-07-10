"""Unit tests for the X (Twitter) watcher source (Task 10)."""
import pytest

from app import config
from app.sources import x_posts

_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Donald J. Trump / @realDonaldTrump</title>
    <item>
      <title>Huge day for $TSLA and NVDA — economy is BOOMING!</title>
      <description>Huge day for $TSLA and NVDA — economy is BOOMING!</description>
      <link>https://nitter.net/realDonaldTrump/status/1810000000000000001#m</link>
      <guid>https://nitter.net/realDonaldTrump/status/1810000000000000001#m</guid>
      <pubDate>Tue, 08 Jul 2026 14:30:00 GMT</pubDate>
    </item>
    <item>
      <title>Nothing to see here</title>
      <description>Nothing to see here</description>
      <link>https://nitter.net/realDonaldTrump/status/1810000000000000002#m</link>
      <guid>https://nitter.net/realDonaldTrump/status/1810000000000000002#m</guid>
      <pubDate>Tue, 08 Jul 2026 13:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>"""


# ---- extract_tickers ----

def test_extract_tickers_cashtags():
    assert x_posts.extract_tickers("buy $TSLA and $nvda now", set()) == ["TSLA", "NVDA"]


def test_extract_tickers_word_match_of_known():
    out = x_posts.extract_tickers("I think AAPL will run", {"AAPL", "MSFT"})
    assert out == ["AAPL"]


def test_extract_tickers_no_substring_false_positive():
    # "CAT" must not match inside "category"; word boundaries only.
    assert x_posts.extract_tickers("a new category of products", {"CAT"}) == []


def test_extract_tickers_dedup_cashtag_and_known():
    out = x_posts.extract_tickers("$TSLA is up, TSLA to the moon", {"TSLA"})
    assert out == ["TSLA"]


# ---- parse_rss ----

def test_parse_rss_extracts_items():
    posts = x_posts.parse_rss(_RSS, "realDonaldTrump", {"NVDA"})
    assert len(posts) == 2
    p = posts[0]
    assert p.account == "realDonaldTrump"
    assert p.post_id == "1810000000000000001"
    assert "BOOMING" in p.text
    assert p.url.startswith("https://nitter.net/")
    assert p.posted_at.startswith("2026-07-08T14:30:00")
    assert set(p.tickers.split(",")) == {"TSLA", "NVDA"}


def test_parse_rss_second_item_has_no_tickers():
    posts = x_posts.parse_rss(_RSS, "realDonaldTrump", set())
    assert posts[1].tickers == ""


# ---- fetch: mirror fallback ----

class _Resp:
    def __init__(self, status, text=""):
        self.status_code = status
        self.text = text

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx
            raise httpx.HTTPStatusError("err", request=None, response=None)


def _client_factory(url_map):
    class _Client:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, url, params=None):
            return url_map(url)
    return _Client


def test_fetch_first_mirror_fails_second_succeeds(monkeypatch):
    monkeypatch.setattr(config, "X_BEARER", "")
    monkeypatch.setattr(config, "X_MIRRORS", ["https://bad.mirror", "https://good.mirror"])
    monkeypatch.setattr(x_posts.time, "sleep", lambda s: None)

    def url_map(url):
        if url.startswith("https://bad.mirror"):
            return _Resp(500)
        return _Resp(200, _RSS)

    monkeypatch.setattr(x_posts.httpx, "Client", _client_factory(url_map))

    result = x_posts.fetch(["realDonaldTrump"], {"NVDA"})
    assert len(result) == 2
    assert result.warning  # degraded provenance flagged
    assert "STOCKS_X_BEARER" in result.warning


def test_fetch_all_mirrors_fail_raises(monkeypatch):
    monkeypatch.setattr(config, "X_BEARER", "")
    monkeypatch.setattr(config, "X_MIRRORS", ["https://bad1", "https://bad2"])
    monkeypatch.setattr(x_posts.time, "sleep", lambda s: None)
    monkeypatch.setattr(x_posts.httpx, "Client", _client_factory(lambda url: _Resp(500)))

    with pytest.raises(RuntimeError):
        x_posts.fetch(["realDonaldTrump"], set())


def test_fetch_official_path_builds_api_urls(monkeypatch):
    monkeypatch.setattr(config, "X_BEARER", "TOKEN123")
    calls = []

    class _R:
        def __init__(self, data): self._data = data
        def raise_for_status(self): pass
        def json(self): return self._data

    class _Client:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, url, params=None):
            calls.append(url)
            if "by/username" in url:
                return _R({"data": {"id": "42"}})
            return _R({"data": [{"id": "999", "text": "buy $AAPL", "created_at": "2026-07-08T00:00:00Z"}]})

    monkeypatch.setattr(x_posts.httpx, "Client", _Client)
    result = x_posts.fetch(["realDonaldTrump"], {"AAPL"})
    assert not result.warning
    assert any("users/by/username/realDonaldTrump" in u for u in calls)
    assert any("users/42/tweets" in u for u in calls)
    assert result[0].tickers == "AAPL"
    assert result[0].post_id == "999"
