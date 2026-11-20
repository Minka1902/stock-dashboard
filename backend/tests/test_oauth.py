"""Social-login (OAuth) flow: provider gating + TOTP-preserving resolution.

The provider network calls are faked by monkeypatching the module's
token-exchange / identity-fetch helpers, so these tests exercise the real
callback route (state check, user resolution, session creation, redirect)
without any network.
"""
import importlib

import pytest
from fastapi.testclient import TestClient

from app import auth, db
from app.models import OAuthIdentity


@pytest.fixture
def oauth(tmp_path, monkeypatch):
    monkeypatch.setenv("STOCKS_DB_PATH", str(tmp_path / "oauth.db"))
    monkeypatch.setenv("STOCKS_OAUTH_GITHUB_CLIENT_ID", "gh-id")
    monkeypatch.setenv("STOCKS_OAUTH_GITHUB_CLIENT_SECRET", "gh-secret")
    from app import config, main as main_module, routes_oauth
    importlib.reload(config)
    importlib.reload(routes_oauth)
    importlib.reload(main_module)
    with TestClient(main_module.app) as c:
        yield c, main_module, routes_oauth


def _fake_provider(routes_oauth, monkeypatch, provider_user_id, email):
    monkeypatch.setattr(routes_oauth, "_exchange_code", lambda client, provider, code: "tok")
    monkeypatch.setattr(routes_oauth, "_fetch_identity",
                        lambda client, provider, tok: (provider_user_id, email))


def _session_state(main_module, client):
    token = client.cookies.get("session")
    assert token, "no session cookie set"
    sess = db.get_session(main_module.conn, auth._hash_token(token))
    return sess.state if sess else None


def _callback(client, state="s1"):
    client.cookies.set("oauth_state", state)
    return client.get(
        f"/api/auth/oauth/github/callback?code=x&state={state}", follow_redirects=False)


# ---- provider gating ----

def test_providers_lists_only_configured(oauth):
    c, _, _ = oauth
    body = c.get("/api/auth/oauth/providers").json()
    assert body["providers"] == ["github"]  # google/facebook creds unset


def test_start_unconfigured_provider_404(oauth):
    c, _, _ = oauth
    r = c.get("/api/auth/oauth/google/start", follow_redirects=False)
    assert r.status_code == 404


# ---- callback: TOTP is preserved ----

def test_callback_new_user_needs_totp_setup(oauth, monkeypatch):
    c, main_module, routes_oauth = oauth
    _fake_provider(routes_oauth, monkeypatch, "gh-1", "new@example.com")
    r = _callback(c)
    assert r.status_code == 302
    assert _session_state(main_module, c) == auth.STATE_SETUP
    # A user + identity were created.
    user = db.get_user_by_email(main_module.conn, "new@example.com")
    assert user is not None and user.is_admin  # first-ever account


def test_callback_existing_enrolled_user_pending_totp(oauth, monkeypatch):
    c, main_module, routes_oauth = oauth
    conn = main_module.conn
    user = db.create_user(conn, "e@x.com", auth.hash_password("x" * 12), "2026-01-01", is_admin=True)
    db.enable_totp(conn, user.id)
    db.create_oauth_identity(conn, OAuthIdentity(
        provider="github", provider_user_id="gh-9", user_id=user.id,
        email="e@x.com", created_at="2026-01-01"))
    _fake_provider(routes_oauth, monkeypatch, "gh-9", "e@x.com")
    r = _callback(c)
    assert r.status_code == 302
    assert _session_state(main_module, c) == auth.STATE_PENDING


def test_callback_links_by_verified_email(oauth, monkeypatch):
    c, main_module, routes_oauth = oauth
    conn = main_module.conn
    # Existing password user (TOTP enrolled) with no OAuth identity yet.
    user = db.create_user(conn, "dup@x.com", auth.hash_password("x" * 12), "2026-01-01", is_admin=True)
    db.enable_totp(conn, user.id)
    _fake_provider(routes_oauth, monkeypatch, "gh-new", "dup@x.com")
    r = _callback(c)
    assert r.status_code == 302
    # Linked to the existing account (no duplicate user), challenged for TOTP.
    assert _session_state(main_module, c) == auth.STATE_PENDING
    ident = db.get_oauth_identity(conn, "github", "gh-new")
    assert ident is not None and ident.user_id == user.id
    assert db.count_users(conn) == 1


# ---- CSRF: state must match the cookie ----

def test_callback_rejects_state_mismatch(oauth, monkeypatch):
    c, main_module, routes_oauth = oauth
    _fake_provider(routes_oauth, monkeypatch, "gh-x", "x@example.com")
    c.cookies.set("oauth_state", "real")
    r = c.get("/api/auth/oauth/github/callback?code=x&state=forged", follow_redirects=False)
    assert r.status_code == 302
    assert "oauth_error" in r.headers["location"]
    assert c.cookies.get("session") is None


# ---- every refusal says why, and for which provider ----

def _reason(location):
    from urllib.parse import parse_qs, urlparse
    query = parse_qs(urlparse(location).query)
    return query["oauth_error"][0], query["provider"][0]


def test_a_forged_state_is_reported_as_state(oauth, monkeypatch):
    c, _, routes_oauth = oauth
    _fake_provider(routes_oauth, monkeypatch, "gh-x", "x@example.com")
    c.cookies.set("oauth_state", "real")
    r = c.get("/api/auth/oauth/github/callback?code=x&state=forged", follow_redirects=False)
    assert _reason(r.headers["location"]) == ("state", "github")


def test_no_verified_email_is_reported_as_identity_not_exchange(oauth, monkeypatch):
    c, main_module, routes_oauth = oauth
    _fake_provider(routes_oauth, monkeypatch, "gh-9", "")
    r = _callback(c)
    assert _reason(r.headers["location"]) == ("identity", "github")
    assert c.cookies.get("session") is None
    assert db.count_users(main_module.conn) == 0


def test_a_provider_failure_is_reported_as_exchange(oauth, monkeypatch):
    c, _, routes_oauth = oauth

    def boom(client, provider, code):
        raise routes_oauth.httpx.ConnectError("down")

    monkeypatch.setattr(routes_oauth, "_exchange_code", boom)
    r = _callback(c)
    assert _reason(r.headers["location"]) == ("exchange", "github")


def test_facebook_uses_a_supported_graph_version(monkeypatch):
    from app import config, routes_oauth
    monkeypatch.setenv("STOCKS_OAUTH_FACEBOOK_GRAPH_VERSION", "v99.0")
    importlib.reload(config)
    importlib.reload(routes_oauth)
    try:
        assert "/v99.0/" in routes_oauth.PROVIDERS["facebook"]["authorize"]
        assert "/v99.0/" in routes_oauth.PROVIDERS["facebook"]["token"]
    finally:
        monkeypatch.delenv("STOCKS_OAUTH_FACEBOOK_GRAPH_VERSION")
        importlib.reload(config)
        importlib.reload(routes_oauth)
    # v18.0 (the old pin) was retired by Meta on 2026-01-26.
    assert config.OAUTH_FACEBOOK_GRAPH_VERSION == "v25.0"
