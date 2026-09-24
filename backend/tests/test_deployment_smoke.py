"""Smoke tests for PHED deployment (iteration 1)."""
import os
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://stack-preview-phed.preview.emergentagent.com").rstrip("/")
ADMIN_USER = "phedadmin"
ADMIN_PASS = "14cef9f07762b981fcdb583c"


def test_health():
    r = requests.get(f"{BASE_URL}/api/health", timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j.get("status") == "ok"
    assert j.get("db") == "connected"


def test_auth_me_unauthenticated_rejected():
    r = requests.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


def test_towns_public_has_thanesar():
    r = requests.get(f"{BASE_URL}/api/towns", timeout=15)
    assert r.status_code == 200
    data = r.json()
    towns = data if isinstance(data, list) else data.get("towns") or data.get("items") or []
    codes = [t.get("code") or t.get("town_code") for t in towns]
    assert "THS" in codes, f"THS not in {codes}"


def test_admin_login_and_me():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    token = r.json().get("access_token") or r.json().get("token")
    assert token
    me = requests.get(f"{BASE_URL}/api/auth/me",
                      headers={"Authorization": f"Bearer {token}"}, timeout=15)
    assert me.status_code == 200, me.text
    body = me.json()
    role = (body.get("role") or (body.get("user") or {}).get("role") or "").upper()
    assert role == "ADMIN", body


def test_admin_login_wrong_password():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": ADMIN_USER, "password": "wrong"}, timeout=15)
    assert r.status_code in (400, 401, 403)
