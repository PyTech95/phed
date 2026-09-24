"""Deployment smoke tests for PHED production readiness."""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://phed-prod-ready.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

ADMIN_USER = "phedadmin"
ADMIN_PASS = "PhedAdmin@2026"
TOWN = "THS"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS, "town_code": TOWN}, timeout=30)
    if r.status_code != 200:
        # try without town_code
        r = requests.post(f"{API}/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    return data.get("access_token") or data.get("token")


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_health():
    r = requests.get(f"{API}/health", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("status") in ("ok", "healthy", "OK")
    # db connected indicator
    db_ok = data.get("db") in ("connected", "ok", True) or data.get("database") in ("connected", "ok", True) or data.get("mongo") in ("connected", True, "ok")
    assert db_ok, f"DB not reported connected: {data}"


def test_login_success(token):
    assert token and isinstance(token, str) and len(token) > 10


def test_login_wrong_password():
    r = requests.post(f"{API}/auth/login", json={"username": ADMIN_USER, "password": "wrong", "town_code": TOWN}, timeout=15)
    assert r.status_code in (400, 401, 403)


def test_auth_me(auth_headers):
    r = requests.get(f"{API}/auth/me", headers=auth_headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("username") == ADMIN_USER or data.get("user", {}).get("username") == ADMIN_USER


def test_towns_list(auth_headers):
    r = requests.get(f"{API}/towns", headers=auth_headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    towns = data if isinstance(data, list) else data.get("towns", [])
    codes = [t.get("code") or t.get("town_code") for t in towns]
    assert "THS" in codes or any("Thanesar" in str(t.get("name", "")) for t in towns), f"THS not found: {towns}"


def test_wards_thanesar(auth_headers):
    r = requests.get(f"{API}/admin/wards", headers=auth_headers, params={"town_code": TOWN}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    wards = data if isinstance(data, list) else data.get("wards", data.get("data", []))
    assert isinstance(wards, list)
    # Not strictly required to have data, but should be a valid list


def test_admin_users_list(auth_headers):
    r = requests.get(f"{API}/admin/users", headers=auth_headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list)


def test_create_and_delete_user(auth_headers):
    import uuid
    uname = f"TEST_user_{uuid.uuid4().hex[:6]}"
    payload = {
        "username": uname,
        "password": "TestPass@2026",
        "name": "Test User",
        "full_name": "Test User",
        "role": "EMPLOYEE",
        "town_code": TOWN,
    }
    r = requests.post(f"{API}/admin/users", headers=auth_headers, json=payload, timeout=20)
    assert r.status_code in (200, 201), f"Create user failed: {r.status_code} {r.text}"
    created = r.json()
    uid = created.get("id") or created.get("user_id") or created.get("_id")
    assert uid, f"No id in response: {created}"

    # Verify listed
    r2 = requests.get(f"{API}/admin/users", headers=auth_headers, timeout=15)
    usernames = [u.get("username") for u in r2.json()]
    assert uname in usernames

    # Cleanup
    rd = requests.delete(f"{API}/admin/users/{uid}", headers=auth_headers, timeout=15)
    assert rd.status_code in (200, 204)
