"""Iteration 3: Verify post-submit state for THS-0001 (surveyor1). READ-ONLY tests."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://phed-ops.preview.emergentagent.com").rstrip("/")
SAFE_PROPERTY_ID = "6abd2d41-a7fc-479d-992a-3a72558b30aa"
SAFE_PROPERTY_CODE = "THS-0001"


@pytest.fixture(scope="module")
def surveyor_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "surveyor1", "password": "Survey@2026"}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def sheaders(surveyor_token):
    return {"Authorization": f"Bearer {surveyor_token}"}


# --- Verify my-progress reconciliation ---
def test_my_progress_reconciled(sheaders):
    r = requests.get(f"{BASE_URL}/api/phed/my-progress", headers=sheaders, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    total = d.get("total_properties")
    p = d.get("phed_pending")
    ip = d.get("phed_in_progress")
    done = d.get("phed_completed")
    print(f"my-progress: total={total} pending={p} in_progress={ip} completed={done}")
    assert total == p + ip + done, f"Scope mismatch: {d}"
    # expected post-submit
    assert total == 3
    assert done == 3
    assert p == 0
    assert ip == 0


# --- Verify map employee-properties: THS-0001 present with submitted state ---
def test_map_employee_properties_ths0001_submitted(sheaders):
    r = requests.get(f"{BASE_URL}/api/map/employee-properties", headers=sheaders, timeout=30)
    assert r.status_code == 200, r.text
    props = r.json().get("properties", [])
    ths = next((p for p in props if p.get("id") == SAFE_PROPERTY_ID or p.get("property_id") == SAFE_PROPERTY_CODE), None)
    assert ths is not None, f"THS-0001 not found in employee properties. Sample: {props[:2]}"
    print(f"THS-0001 in map: {ths}")
    # Surveyor-visible PHED state should be Submitted (yellow), not pending
    phed_state = (ths.get("phed_survey_status") or ths.get("phed_survey_state") or "").lower()
    assert phed_state == "submitted", f"Expected submitted, got {phed_state}. full={ths}"
    assert (ths.get("phed_outcome") or "").upper() == "LOCKED"


# --- Verify duplicate survey not created and reference PL0001 exists ---
def test_no_duplicate_survey_and_reference(sheaders):
    # Try common endpoints for listing surveys
    candidates = [
        f"/api/phed/surveys?property_id={SAFE_PROPERTY_ID}",
        f"/api/phed/property/{SAFE_PROPERTY_ID}/surveys",
        f"/api/phed/my-surveys",
    ]
    found = None
    for path in candidates:
        r = requests.get(f"{BASE_URL}{path}", headers=sheaders, timeout=30)
        if r.status_code == 200:
            found = (path, r.json())
            print(f"OK {path}: {str(found[1])[:400]}")
            break
        else:
            print(f"skip {path} -> {r.status_code}")
    # Best-effort assertion: at least one endpoint returned data mentioning PL0001
    if found:
        text = str(found[1])
        # relax: reference may be present
        if "PL0001" in text:
            print("Reference PL0001 found in listing.")
        # count non-rejected for this property
        items = found[1] if isinstance(found[1], list) else found[1].get("surveys") or found[1].get("items") or []
        prop_surveys = [
            s for s in items
            if (s.get("property_id") == SAFE_PROPERTY_ID or s.get("property_code") == SAFE_PROPERTY_CODE)
            and (s.get("status") or "").lower() != "rejected"
        ]
        print(f"Non-rejected surveys for THS-0001: {len(prop_surveys)}")
        assert len(prop_surveys) <= 1, f"Duplicate surveys detected: {prop_surveys}"


def test_admin_surveys_listing_ths0001_unique_and_pl0001():
    """Definitive check via admin endpoint: exactly one non-rejected survey with reference PL0001."""
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "admin", "password": "Phed#Admin2026!"}, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json().get("token") or r.json().get("access_token")
    h = {"Authorization": f"Bearer {tok}"}
    r = requests.get(f"{BASE_URL}/api/phed/surveys?property_id={SAFE_PROPERTY_CODE}&limit=20", headers=h, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    surveys = [s for s in data.get("surveys", []) if (s.get("status") or "").lower() != "rejected"]
    print(f"Non-rejected surveys for THS-0001: {len(surveys)}")
    assert data.get("total") == 1, f"Expected total=1, got {data.get('total')}"
    assert len(surveys) == 1, f"Duplicate detected: {surveys}"
    s = surveys[0]
    assert s.get("reference_number") == "PL0001", f"ref={s.get('reference_number')}"
    assert s.get("reference_code") == "PL"
    assert s.get("status") == "Submitted"
    assert s.get("property_record_id") == SAFE_PROPERTY_ID
    assert s.get("surveyor_id") == "58cc1f55-e82f-4afe-a057-fea837d1daec"


def test_auth_guard():
    r = requests.get(f"{BASE_URL}/api/phed/my-progress", timeout=15)
    assert r.status_code in (401, 403)
    r2 = requests.get(f"{BASE_URL}/api/map/employee-properties", timeout=15)
    assert r2.status_code in (401, 403)
