"""Tests for PHED Today dashboard endpoint + admin login + main dashboard shape."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://phed-ops.preview.emergentagent.com").rstrip("/")
ADMIN_USER = "admin"
ADMIN_PASS = "Phed#Admin2026!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_USER, "password": ADMIN_PASS},
        timeout=15,
    )
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok, f"No token in login response: {data}"
    return tok


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


def test_today_dashboard_shape(auth_headers):
    r = requests.get(f"{BASE_URL}/api/phed/dashboard/today", headers=auth_headers, timeout=30)
    assert r.status_code == 200, f"Unexpected status {r.status_code} body={r.text[:400]}"
    data = r.json()
    for k in ("report_date", "summary", "by_surveyor", "recent_surveys"):
        assert k in data, f"Missing key {k}"
    assert isinstance(data["by_surveyor"], list)
    assert isinstance(data["recent_surveys"], list)
    summary = data["summary"]
    for sk in (
        "total", "awaiting_approval", "approved", "already_verified", "new_connection",
        "property_locked", "owner_denied", "no_phed_connection", "properties_linked", "in_progress",
    ):
        assert sk in summary, f"Missing summary key {sk}"
        assert isinstance(summary[sk], int)


def test_main_dashboard_returns_consumer_fields(auth_headers):
    r = requests.get(f"{BASE_URL}/api/phed/dashboard", headers=auth_headers, timeout=30)
    assert r.status_code == 200
    data = r.json()
    for k in ("total_consumers", "water_connections", "sewer_connections"):
        assert k in data, f"Missing key {k} in main dashboard"


def test_today_dashboard_requires_auth():
    r = requests.get(f"{BASE_URL}/api/phed/dashboard/today", timeout=15)
    assert r.status_code in (401, 403)
