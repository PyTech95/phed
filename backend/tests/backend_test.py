"""PHED smoke tests - health, auth, guards, town selection."""
import os
import pytest
import requests
from dotenv import dotenv_values

BASE_URL = dotenv_values('/app/frontend/.env')['REACT_APP_BACKEND_URL']
ADMIN_USER = dotenv_values('/app/backend/.env')['ADMIN_USERNAME']
ADMIN_PASS = dotenv_values('/app/backend/.env')['ADMIN_PASSWORD']


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_token(session):
    r = session.post(f"{BASE_URL}/api/auth/login",
                     json={"username": ADMIN_USER, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return r.json()["token"]


# --- Health ---
def test_health(session):
    r = session.get(f"{BASE_URL}/api/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert data["db"] == "connected"


# --- Auth ---
def test_login_success(session):
    r = session.post(f"{BASE_URL}/api/auth/login",
                     json={"username": ADMIN_USER, "password": ADMIN_PASS})
    assert r.status_code == 200
    d = r.json()
    assert "token" in d and "refresh_token" in d
    assert d["user"]["username"] == ADMIN_USER
    assert d["user"]["role"] == "ADMIN"
    assert isinstance(d["accessible_towns"], list) and len(d["accessible_towns"]) >= 1
    assert any(t["code"] == "THS" for t in d["accessible_towns"])


def test_login_wrong_password(session):
    r = session.post(f"{BASE_URL}/api/auth/login",
                     json={"username": ADMIN_USER, "password": "wrong"})
    assert r.status_code == 401


# --- Auth guards on protected admin endpoints ---
@pytest.mark.parametrize("path", [
    "/api/admin/users",
    "/api/admin/audit-log",
    "/api/admin/batches",
    "/api/admin/towns/manage",
    "/api/admin/properties",
])
def test_protected_requires_auth(session, path):
    r = session.get(f"{BASE_URL}{path}")
    assert r.status_code in (401, 403), f"{path} -> {r.status_code}"


# --- Authorized access works ---
def test_admin_can_list_towns(session, admin_token):
    r = session.get(f"{BASE_URL}/api/admin/towns/manage",
                    headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    towns = data["towns"] if isinstance(data, dict) else data
    assert isinstance(towns, list)
    assert any(t.get("code") == "THS" for t in towns)


def test_admin_can_list_users(session, admin_token):
    r = session.get(f"{BASE_URL}/api/admin/users",
                    headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    assert isinstance(r.json(), list)
