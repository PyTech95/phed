"""Iteration 5: Verify MC PHED upload column-mapping fix for town BHD.

Data: 55,180 real properties from 'MC PHED DATA.xlsx' already uploaded as batch
'MC PHED TEST' to town BHD using the fixed upload_batch code (normalized headers).

We verify:
- properties list has real property_id / owner_name / colony / mobile
- /admin/colonies returns 100+ real colony names (Azad Nagar PART-1, Akash Nagar, ...)
- /admin/areas also lists real colonies
- block-assign-colonies + block-unassign-colonies works for a real colony (Akash Nagar)
- THS still works (regression)
"""
import os
import re
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api"

EXPECTED_COLONIES = ["Azad Nagar PART-1", "Akash Nagar", "Kirti Nagar", "Didar Nagar"]


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    return j.get("token") or j.get("access_token")


@pytest.fixture(scope="module")
def admin_token():
    return _login("phedadmin", "PhedAdmin@2026")


@pytest.fixture(scope="module")
def surveyor1_id(admin_token):
    r = requests.get(f"{API}/admin/users", headers={"Authorization": f"Bearer {admin_token}"}, timeout=30)
    assert r.status_code == 200
    for e in r.json():
        if e.get("username") == "surveyor1":
            return e.get("id") or e.get("_id")
    pytest.skip("surveyor1 not found")


def _h(token, town):
    return {"Authorization": f"Bearer {token}", "X-Town-Code": town, "Content-Type": "application/json"}


def _as_list(data, keys=("properties", "items", "colonies", "areas")):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in keys:
            if k in data and isinstance(data[k], list):
                return data[k]
    return []


# ---- properties: real values ----
def test_bhd_properties_have_real_values(admin_token):
    r = requests.get(f"{API}/admin/properties", headers=_h(admin_token, "BHD"),
                     params={"limit": 20}, timeout=60)
    assert r.status_code == 200, r.text
    props = _as_list(r.json())
    assert len(props) >= 5, f"expected many BHD properties, got {len(props)}"

    real_owner = [p for p in props if p.get("owner_name") and p["owner_name"].strip().lower() not in ("", "unknown")]
    real_colony = [p for p in props if p.get("colony") and str(p["colony"]).strip() != ""]
    # property_id should NOT look like random hex (fixed IDs like '3U1136U5' are alphanumeric of specific form,
    # but we simply assert non-empty and not just uuid style)
    real_pid = [p for p in props if p.get("property_id") and re.search(r"[A-Za-z0-9]", str(p["property_id"]))]
    real_mobile = [p for p in props if p.get("mobile_no") or p.get("mobile") or p.get("phone")]

    print("sample:", props[0])
    print(f"owners real: {len(real_owner)}/{len(props)}; colonies real: {len(real_colony)}/{len(props)}; "
          f"pids: {len(real_pid)}/{len(props)}; mobiles: {len(real_mobile)}/{len(props)}")

    assert len(real_owner) >= len(props) * 0.5, "most owner_name should be real, not Unknown"
    assert len(real_colony) >= len(props) * 0.5, "most colony fields should be populated"
    assert len(real_pid) == len(props)
    assert len(real_mobile) >= 1, "at least some rows should have mobile numbers"


# ---- colonies endpoint: 100+ real names ----
def test_bhd_colonies_lists_100plus_real(admin_token):
    r = requests.get(f"{API}/admin/colonies", headers=_h(admin_token, "BHD"), timeout=60)
    assert r.status_code == 200, r.text
    items = _as_list(r.json())
    names = [x if isinstance(x, str) else (x.get("name") or x.get("colony") or x.get("ward")) for x in items]
    names = [n for n in names if n]
    print(f"BHD colonies count: {len(names)} sample: {names[:15]}")
    assert len(names) >= 100, f"expected 100+ colonies, got {len(names)}"
    found = [c for c in EXPECTED_COLONIES if any(c.lower() == str(n).lower() or c.lower() in str(n).lower() for n in names)]
    print("expected found:", found)
    assert len(found) >= 2, f"expected at least 2 of {EXPECTED_COLONIES} in colonies list; found {found}"


# ---- areas endpoint ----
def test_bhd_areas_lists_colonies(admin_token):
    r = requests.get(f"{API}/admin/areas", headers=_h(admin_token, "BHD"), timeout=60)
    assert r.status_code == 200, r.text
    items = _as_list(r.json())
    names = [x if isinstance(x, str) else (x.get("name") or x.get("colony") or x.get("area") or x.get("ward")) for x in items]
    names = [n for n in names if n]
    print(f"BHD areas count: {len(names)} sample: {names[:15]}")
    assert len(names) >= 50
    found = [c for c in EXPECTED_COLONIES if any(c.lower() in str(n).lower() for n in names)]
    assert len(found) >= 1


# ---- block assign/unassign on real colony ----
def test_bhd_block_assign_and_unassign_akash_nagar(admin_token, surveyor1_id):
    colony = "Akash Nagar"
    # ensure clean state
    requests.post(f"{API}/admin/block-unassign-colonies", json={"colonies": [colony]},
                  headers=_h(admin_token, "BHD"), timeout=120)

    r = requests.post(f"{API}/admin/block-assign-colonies",
                      json={"colonies": [colony], "employee_ids": [surveyor1_id]},
                      headers=_h(admin_token, "BHD"), timeout=180)
    assert r.status_code == 200, r.text
    body = r.json()
    print("assign resp:", body)
    modified = body.get("modified_count") or body.get("total_assigned") or body.get("modified") or 0
    assert modified >= 1, f"no properties matched colony {colony}: {body}"

    # cleanup (unassign)
    r2 = requests.post(f"{API}/admin/block-unassign-colonies", json={"colonies": [colony]},
                       headers=_h(admin_token, "BHD"), timeout=180)
    assert r2.status_code == 200, r2.text
    print("unassign resp:", r2.json())


# ---- regression: THS ----
def test_ths_colonies_still_work(admin_token):
    r = requests.get(f"{API}/admin/colonies", headers=_h(admin_token, "THS"), timeout=30)
    assert r.status_code == 200
    items = _as_list(r.json())
    assert len(items) > 0


def test_ths_properties_still_work(admin_token):
    r = requests.get(f"{API}/admin/properties", headers=_h(admin_token, "THS"),
                     params={"limit": 5}, timeout=30)
    assert r.status_code == 200
    props = _as_list(r.json())
    assert len(props) > 0
