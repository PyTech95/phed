"""
Iteration 2: Test colony-based bulk assign fixes.
- GET /api/admin/areas should include colonies
- GET /api/admin/properties?ward=<colony> should match colony
- POST /api/admin/assign-bulk with {area: <colony>} should assign
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
TOWN = "THS"
ADMIN_USER = "phedadmin"
ADMIN_PASS = "PhedAdmin@2026"
SURVEYOR_USER = "surveyor2"
SURVEYOR_PASS = "Surveyor2@2026"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_USER, "password": ADMIN_PASS, "town_code": TOWN},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    token = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {token}", "X-Town-Code": TOWN}


@pytest.fixture(scope="module")
def surveyor2_id(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/employees", headers=admin_headers, timeout=30)
    if r.status_code != 200:
        r = requests.get(f"{BASE_URL}/api/admin/users", headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    users = data if isinstance(data, list) else data.get("users") or data.get("employees") or []
    for u in users:
        if u.get("username") == SURVEYOR_USER:
            return u.get("id") or u.get("_id") or u.get("user_id")
    pytest.skip("surveyor2 not found")


def test_areas_include_colonies(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/areas", headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    areas = data if isinstance(data, list) else data.get("areas") or data.get("items") or []
    # Normalize
    names = [a if isinstance(a, str) else (a.get("name") or a.get("area")) for a in areas]
    print("Areas:", names[:30], "count=", len(names))
    assert len(names) > 0
    # Expect at least one colony-like name
    expected_any = ["Didar Nagar", "Kirti Nagar"]
    assert any(n in names for n in expected_any), f"No expected colony present: {names}"


def test_properties_by_colony(admin_headers):
    r = requests.get(
        f"{BASE_URL}/api/admin/properties",
        params={"ward": "Kirti Nagar", "limit": 100},
        headers=admin_headers,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    props = data if isinstance(data, list) else data.get("properties") or data.get("items") or []
    print("Kirti Nagar count=", len(props))
    assert len(props) > 0, "Expected properties for colony Kirti Nagar"
    # Each should match colony or ward
    for p in props[:5]:
        assert (p.get("colony") == "Kirti Nagar") or (p.get("ward") == "Kirti Nagar")


def test_bulk_assign_by_colony(admin_headers, surveyor2_id):
    payload = {"area": "Kirti Nagar", "employee_ids": [surveyor2_id]}
    r = requests.post(
        f"{BASE_URL}/api/admin/assign-bulk", json=payload, headers=admin_headers, timeout=60
    )
    assert r.status_code == 200, r.text
    body = r.json()
    print("Assign result:", body)
    count = body.get("assigned") or body.get("count") or body.get("modified_count") or 0
    msg = body.get("message", "")
    import re
    m = re.search(r"(\d+)\s+propert", msg)
    if m:
        count = int(m.group(1))
    assert count >= 1 or body.get("success") is True, f"No assignment happened: {body}"

    # Verify persistence
    r2 = requests.get(
        f"{BASE_URL}/api/admin/properties",
        params={"ward": "Kirti Nagar", "limit": 20},
        headers=admin_headers,
        timeout=30,
    )
    assert r2.status_code == 200
    d2 = r2.json()
    props = d2 if isinstance(d2, list) else d2.get("properties") or d2.get("items") or []
    assigned_names = [p.get("assigned_employee_name") or p.get("assigned_to_name") for p in props]
    print("Assigned names sample:", assigned_names[:5])
    assert any(n for n in assigned_names), "Expected at least one property to show assigned name"
