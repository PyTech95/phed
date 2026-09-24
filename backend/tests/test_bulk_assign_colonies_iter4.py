"""Iteration 4: Bulk Assign COLONIES dialog backend tests (block-assign/unassign-colonies)."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api"


def _login(username, password):
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed {username}: {r.status_code} {r.text}"
    j = r.json()
    return j.get("token") or j.get("access_token")


@pytest.fixture(scope="module")
def admin_token():
    return _login("phedadmin", "PhedAdmin@2026")


@pytest.fixture(scope="module")
def surveyor1_id(admin_token):
    r = requests.get(f"{API}/admin/users", headers={"Authorization": f"Bearer {admin_token}"}, timeout=30)
    assert r.status_code == 200, r.text
    for e in r.json():
        if e.get("username") == "surveyor1":
            return e.get("id") or e.get("_id")
    pytest.skip("surveyor1 not found")


def _h(token, town):
    return {"Authorization": f"Bearer {token}", "X-Town-Code": town, "Content-Type": "application/json"}


# GET /admin/colonies for BHD should include colony-field colonies
def test_admin_colonies_bhd_returns_colony_names(admin_token):
    r = requests.get(f"{API}/admin/colonies", headers=_h(admin_token, "BHD"), timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    if isinstance(data, dict):
        data = data.get("colonies") or data.get("items") or []
    # response may be list of strings or list of dicts
    items = [x if isinstance(x, str) else (x.get("name") or x.get("colony") or x.get("ward")) for x in data]
    print("BHD colonies:", items)
    assert any("BHD Colony 0" in str(i) for i in items), f"BHD Colony 0 missing: {items}"
    assert any("BHD Colony 1" in str(i) for i in items), f"BHD Colony 1 missing: {items}"


def test_admin_colonies_ths_still_works(admin_token):
    r = requests.get(f"{API}/admin/colonies", headers=_h(admin_token, "THS"), timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    if isinstance(data, dict):
        data = data.get("colonies") or data.get("items") or []
    assert isinstance(data, list)
    assert len(data) > 0, "THS colonies should not be empty"


def test_block_assign_and_unassign_colonies_bhd(admin_token, surveyor1_id):
    # First unassign to have a clean state
    requests.post(f"{API}/admin/block-unassign-colonies", json={"colonies": ["BHD Colony 0"]},
                  headers=_h(admin_token, "BHD"), timeout=60)

    # Assign
    payload = {"colonies": ["BHD Colony 0"], "employee_ids": [surveyor1_id]}
    r = requests.post(f"{API}/admin/block-assign-colonies", json=payload, headers=_h(admin_token, "BHD"), timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    print("assign resp:", body)
    modified = body.get("modified_count") or body.get("total_assigned") or body.get("modified") or 0
    assert modified >= 1, f"expected >=1 modified, got {body}"

    # Verify via properties list
    r2 = requests.get(f"{API}/admin/properties", headers=_h(admin_token, "BHD"),
                      params={"colony": "BHD Colony 0", "limit": 50}, timeout=30)
    assert r2.status_code == 200, r2.text
    props = r2.json() if isinstance(r2.json(), list) else r2.json().get("properties", r2.json().get("items", []))
    print(f"BHD Colony 0 props count: {len(props)}")
    assigned = [p for p in props if p.get("assigned_employee_name") or p.get("assigned_employee_id")]
    assert len(assigned) >= 1, f"no assigned properties after assign: {props[:2]}"

    # Unassign
    r3 = requests.post(f"{API}/admin/block-unassign-colonies", json={"colonies": ["BHD Colony 0"]},
                       headers=_h(admin_token, "BHD"), timeout=60)
    assert r3.status_code == 200, r3.text
    print("unassign resp:", r3.json())
    modified_u = r3.json().get("modified_count") or r3.json().get("total_unassigned") or r3.json().get("modified") or 0
    assert modified_u >= 1
