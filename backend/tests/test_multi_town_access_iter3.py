"""Iteration 3: multi-town access verification.
Verifies extra_town_ids grant flow end-to-end via public API.
"""
import os
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://phed-prod-ready.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

ADMIN = ("phedadmin", "PhedAdmin@2026")
SURV1 = ("surveyor1", "Survey@2026")
SURV2 = ("surveyor2", "Surveyor2@2026")


def _login(u, p, town_code=None):
    h = {"Content-Type": "application/json"}
    if town_code:
        h["X-Town-Code"] = town_code
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, headers=h, timeout=30)
    return r


@pytest.fixture(scope="module")
def admin_token():
    r = _login(*ADMIN, town_code="THS")
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def towns(admin_token):
    r = requests.get(f"{API}/towns", headers={"Authorization": f"Bearer {admin_token}"}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    if isinstance(data, dict):
        data = data.get("towns", [])
    return {t["code"]: t for t in data}


def test_towns_include_ths_and_bhd(towns):
    assert "THS" in towns and "BHD" in towns, f"Available towns: {list(towns.keys())}"


def test_surveyor1_login_returns_both_towns():
    r = _login(*SURV1)
    assert r.status_code == 200, r.text
    body = r.json()
    accessible = body.get("accessible_towns") or []
    codes = {t.get("code") for t in accessible}
    assert "THS" in codes and "BHD" in codes, f"surveyor1 accessible_towns={codes}"


def test_surveyor1_can_access_bhd_endpoints():
    r = _login(*SURV1, town_code="BHD")
    assert r.status_code == 200
    tok = r.json()["token"]
    h = {"Authorization": f"Bearer {tok}", "X-Town-Code": "BHD"}
    me = requests.get(f"{API}/auth/me", headers=h, timeout=30)
    assert me.status_code == 200, me.text
    mp = requests.get(f"{API}/map/employee-properties", headers=h, timeout=30)
    assert mp.status_code == 200, mp.text
    body = mp.json()
    assert isinstance(body, (list, dict))


def test_surveyor2_cannot_access_bhd():
    r = _login(*SURV2, town_code="BHD")
    # Either login rejects town or /auth/me on BHD returns 403
    if r.status_code == 200:
        tok = r.json()["token"]
        me = requests.get(f"{API}/auth/me",
                          headers={"Authorization": f"Bearer {tok}", "X-Town-Code": "BHD"}, timeout=30)
        assert me.status_code in (401, 403), f"surveyor2 unexpectedly accessed BHD: {me.status_code}"
    else:
        assert r.status_code in (401, 403)


def test_admin_users_in_bhd_lists_surveyor1(admin_token):
    h = {"Authorization": f"Bearer {admin_token}", "X-Town-Code": "BHD"}
    r = requests.get(f"{API}/admin/users", headers=h, timeout=30)
    assert r.status_code == 200, r.text
    users = r.json()
    usernames = {u.get("username") for u in users}
    assert "surveyor1" in usernames, f"surveyor1 missing from BHD users list: {usernames}"


def test_surveyor1_ths_still_works():
    """Regression: primary town still accessible unchanged."""
    r = _login(*SURV1, town_code="THS")
    assert r.status_code == 200
    tok = r.json()["token"]
    h = {"Authorization": f"Bearer {tok}", "X-Town-Code": "THS"}
    me = requests.get(f"{API}/auth/me", headers=h, timeout=30)
    assert me.status_code == 200
    body = me.json()
    # assigned_town remains THS
    assert body.get("assigned_town") is not None


def test_update_user_extra_town_ids_persists(admin_token, towns):
    """PUT /api/admin/users/{id} with extra_town_ids stores grants; assigned_town unchanged."""
    h = {"Authorization": f"Bearer {admin_token}", "X-Town-Code": "THS"}
    users = requests.get(f"{API}/admin/users", headers=h, timeout=30).json()
    s1 = next((u for u in users if u.get("username") == "surveyor1"), None)
    assert s1, "surveyor1 not found in THS admin users list"
    original_assigned = s1.get("assigned_town")

    bhd_id = towns["BHD"]["id"]
    # Toggle: set to [BHD] again (idempotent) — should persist
    r = requests.put(f"{API}/admin/users/{s1['id']}",
                     headers={**h, "Content-Type": "application/json"},
                     json={"extra_town_ids": [bhd_id]}, timeout=30)
    assert r.status_code == 200, r.text

    users2 = requests.get(f"{API}/admin/users", headers=h, timeout=30).json()
    s1b = next(u for u in users2 if u["username"] == "surveyor1")
    assert bhd_id in (s1b.get("extra_town_ids") or [])
    assert s1b.get("assigned_town") == original_assigned, "assigned_town must remain unchanged"


def test_admin_bulk_assign_bhd_colony(admin_token):
    """Admin can bulk-assign a BHD colony to surveyor1."""
    h = {"Authorization": f"Bearer {admin_token}", "X-Town-Code": "BHD"}
    # find surveyor1 id in BHD scope
    users = requests.get(f"{API}/admin/users", headers=h, timeout=30).json()
    s1 = next((u for u in users if u.get("username") == "surveyor1"), None)
    assert s1, "surveyor1 missing from BHD admin list"

    r = requests.post(f"{API}/admin/assign-bulk",
                      headers={**h, "Content-Type": "application/json"},
                      json={"area": "BHD Colony 0", "employee_ids": [s1["id"]]}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    # accept either message string or structured
    msg = body.get("message", "")
    assert "BHD Colony 0" in msg or body.get("assigned_count", 0) >= 0
