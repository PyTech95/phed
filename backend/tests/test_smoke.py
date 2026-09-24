"""Phase-4 smoke test for PHED9500 deployment."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://phed-deploy-v1.preview.emergentagent.com").rstrip("/")
ADMIN_USER = os.environ.get("TEST_ADMIN_USERNAME", "admin")
ADMIN_PASS = os.environ.get("TEST_ADMIN_PASSWORD", "PhedAdmin@2026")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def token(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    assert tok, f"No token in response: {data}"
    return tok


# --- health ---
def test_health(api):
    r = api.get(f"{BASE_URL}/api/health")
    assert r.status_code == 200
    d = r.json()
    assert d.get("status") == "ok"
    assert d.get("db") == "connected"
    assert d.get("env") == "production"


# --- auth ---
def test_login_success(token):
    assert isinstance(token, str) and len(token) > 10


def test_login_invalid(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"username": "admin", "password": "wrongpassword!"})
    assert r.status_code in (400, 401, 403)


def test_me(api, token):
    r = api.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    d = r.json()
    assert d.get("username") == ADMIN_USER or d.get("user", {}).get("username") == ADMIN_USER


# --- towns ---
def test_towns_list_and_ths_exists(api, token):
    r = api.get(f"{BASE_URL}/api/towns", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    body = r.json()
    towns = body if isinstance(body, list) else body.get("towns", body.get("data", []))
    assert isinstance(towns, list) and len(towns) > 0
    codes = [str(t.get("code", "")).upper() for t in towns]
    assert "THS" in codes, f"THS not seeded. Got: {codes}"


# --- authenticated dashboard read ---
def test_dashboard_stats(api, token):
    headers = {"Authorization": f"Bearer {token}", "X-Town-Code": "THS"}
    # try common endpoints
    tried = []
    for path in ["/api/phed/dashboard/stats", "/api/phed/dashboard", "/api/dashboard/stats", "/api/phed/consumers"]:
        r = api.get(f"{BASE_URL}{path}", headers=headers)
        tried.append((path, r.status_code))
        if r.status_code == 200:
            return
    pytest.fail(f"No dashboard endpoint returned 200. Tried: {tried}")
