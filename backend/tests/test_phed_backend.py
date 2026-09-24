"""PHED backend smoke tests: health + auth + basic authenticated endpoints."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://phed-fullstack.preview.emergentagent.com").rstrip("/")
ADMIN_USER = "admin"
ADMIN_PASS = "PhedAdmin@2026!"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def token(client):
    r = client.post(f"{BASE_URL}/api/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def auth_client(client, token):
    client.headers.update({"Authorization": f"Bearer {token}"})
    return client


# Health
def test_health(client):
    r = client.get(f"{BASE_URL}/api/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert data["db"] == "connected"


# Auth
def test_login_success(client):
    r = client.post(f"{BASE_URL}/api/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS})
    assert r.status_code == 200
    d = r.json()
    assert "token" in d and "user" in d
    assert d["user"].get("role", "").upper() == "ADMIN"


def test_login_wrong_password(client):
    r = client.post(f"{BASE_URL}/api/auth/login", json={"username": ADMIN_USER, "password": "wrong-xxx"})
    assert r.status_code == 401


def test_login_missing_fields(client):
    r = client.post(f"{BASE_URL}/api/auth/login", json={"username": ADMIN_USER})
    assert r.status_code in (400, 422)


def test_me_requires_auth(client):
    # ensure no auth header
    s = requests.Session()
    r = s.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code in (401, 403)


def test_me_with_token(auth_client):
    r = auth_client.get(f"{BASE_URL}/api/auth/me")
    # some apis expose /api/auth/me, otherwise skip
    if r.status_code == 404:
        pytest.skip("No /api/auth/me endpoint")
    assert r.status_code == 200


# Seed data checks
def test_towns_endpoint(auth_client):
    r = auth_client.get(f"{BASE_URL}/api/towns")
    if r.status_code == 404:
        pytest.skip("No /api/towns endpoint")
    assert r.status_code == 200
    data = r.json()
    # expect at least THS Thanesar
    items = data if isinstance(data, list) else data.get("items", data.get("towns", []))
    assert any((t.get("code") == "THS" or "Thanesar" in str(t.get("name", ""))) for t in items), items


def test_wards_endpoint(auth_client):
    # try common variants
    for path in ["/api/wards", "/api/towns/THS/wards"]:
        r = auth_client.get(f"{BASE_URL}{path}")
        if r.status_code == 200:
            data = r.json()
            items = data if isinstance(data, list) else data.get("items", data.get("wards", []))
            assert len(items) >= 1, f"expected wards from {path}"
            return
    pytest.skip("No wards endpoint found")
