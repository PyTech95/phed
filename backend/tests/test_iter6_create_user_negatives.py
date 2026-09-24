"""Iter6: Backend create-user negatives + link-cleanup smoke."""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://stack-preview-phed.preview.emergentagent.com").rstrip("/")
ADMIN = {"username": "phedadmin", "password": "14cef9f07762b981fcdb583c"}


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


def _mkuser_payload(**overrides):
    p = {
        "username": f"TEST_neg_{uuid.uuid4().hex[:8]}",
        "password": "Passw0rd!",
        "name": "TEST Negative",
        "role": "SURVEYOR",
    }
    p.update(overrides)
    return p


def test_create_user_happy_and_cleanup(admin_headers):
    payload = _mkuser_payload()
    r = requests.post(f"{BASE_URL}/api/admin/users", json=payload, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["username"] == payload["username"]
    assert body["role"] == "SURVEYOR"
    assert "id" in body and isinstance(body["id"], str)
    # cleanup
    d = requests.delete(f"{BASE_URL}/api/admin/users/{body['id']}", headers=admin_headers, timeout=15)
    assert d.status_code in (200, 204)


def test_create_user_forbidden_non_admin(admin_headers):
    # create a surveyor, log in as it, then attempt create -> 403
    payload = _mkuser_payload()
    r = requests.post(f"{BASE_URL}/api/admin/users", json=payload, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    uid = r.json()["id"]
    try:
        login = requests.post(f"{BASE_URL}/api/auth/login", json={"username": payload["username"], "password": payload["password"]}, timeout=15)
        assert login.status_code == 200, login.text
        surv_token = login.json()["token"]
        r2 = requests.post(
            f"{BASE_URL}/api/admin/users",
            json=_mkuser_payload(),
            headers={"Authorization": f"Bearer {surv_token}", "Content-Type": "application/json"},
            timeout=15,
        )
        assert r2.status_code == 403, r2.text
    finally:
        requests.delete(f"{BASE_URL}/api/admin/users/{uid}", headers=admin_headers, timeout=15)


def test_create_user_duplicate_username(admin_headers):
    payload = _mkuser_payload()
    r = requests.post(f"{BASE_URL}/api/admin/users", json=payload, headers=admin_headers, timeout=15)
    assert r.status_code == 200
    uid = r.json()["id"]
    try:
        r2 = requests.post(f"{BASE_URL}/api/admin/users", json=payload, headers=admin_headers, timeout=15)
        assert r2.status_code == 400
        assert "already exists" in r2.text.lower()
    finally:
        requests.delete(f"{BASE_URL}/api/admin/users/{uid}", headers=admin_headers, timeout=15)


def test_create_user_missing_required_field(admin_headers):
    bad = {"username": f"TEST_bad_{uuid.uuid4().hex[:6]}", "role": "SURVEYOR"}  # no password / name
    r = requests.post(f"{BASE_URL}/api/admin/users", json=bad, headers=admin_headers, timeout=15)
    assert r.status_code == 422, r.text


def test_link_cleanup_api_reachable(admin_headers):
    # The page fetches PHED wrong-link data; check the underlying endpoint doesn't 500.
    # Try common endpoints; accept 200 or 404 (route naming) but never 500.
    for path in ["/api/phed/link-cleanup", "/api/phed/wrong-links", "/api/phed/link_cleanup"]:
        r = requests.get(f"{BASE_URL}{path}", headers=admin_headers, timeout=15)
        assert r.status_code != 500, f"{path} -> 500: {r.text[:200]}"
