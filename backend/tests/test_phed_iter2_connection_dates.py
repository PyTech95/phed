"""Iteration 2 backend tests: connection type highlighting on admin submissions + phed surveys.

Validates:
- GET /api/admin/submissions attaches phed_connection_type per property (MC-TEST-001 = ALREADY_CONNECTION)
- GET /api/phed/surveys returns the 5 seeded surveys with correct connection_type and connection_label
- Submitted timestamps are ISO-8601 UTC (frontend converts to IST DD/MM/YYYY HH:MM:SS)
"""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://phed-fullstack.preview.emergentagent.com").rstrip("/")
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "PhedAdmin@2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE}/api/auth/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "X-Town": "THS"}


# --- Admin submissions: PHED Connection column data ---
def test_admin_submissions_attaches_phed_connection_type(headers):
    r = requests.get(f"{BASE}/api/admin/submissions", headers=headers, params={"limit": 20}, timeout=20)
    assert r.status_code == 200, r.text
    subs = r.json()["submissions"]
    target = next((s for s in subs if s.get("property_id") == "MC-TEST-001"), None)
    assert target is not None, f"MC-TEST-001 submission missing. Got: {[s.get('property_id') for s in subs]}"
    assert target.get("phed_connection_type") == "ALREADY_CONNECTION", target
    # submitted_at is UTC ISO-8601 (frontend converts to IST)
    assert "submitted_at" in target and target["submitted_at"], target
    assert "T" in target["submitted_at"]


# --- PHED surveys: 5 seeded, distinct connection labels ---
EXPECTED_LABELS = {
    "REF-BOTH":  ("ALREADY_CONNECTION",  "Already Connection"),
    "REF-WATER": ("WATER_CONNECTION",    "Water Connection Only — Sewer Missing"),
    "REF-SEWER": ("SEWER_CONNECTION",    "Sewer Connection Only — Water Missing"),
    "REF-NEW":   ("NEW_CONNECTION",      "New Connection"),
    "REF-DT":    ("DEATH_TRANSFER",      "Death Transfer"),
}


def test_phed_surveys_distinct_connection_labels(headers):
    r = requests.get(f"{BASE}/api/phed/surveys", headers=headers, params={"limit": 50}, timeout=20)
    assert r.status_code == 200, r.text
    surveys = r.json()["surveys"]
    by_ref = {s.get("reference_number"): s for s in surveys if s.get("reference_number") in EXPECTED_LABELS}
    missing = set(EXPECTED_LABELS) - set(by_ref)
    assert not missing, f"Missing seeded surveys: {missing}"
    for ref, (exp_code, exp_label) in EXPECTED_LABELS.items():
        s = by_ref[ref]
        assert s.get("connection_type") == exp_code, f"{ref}: code={s.get('connection_type')} exp={exp_code}"
        assert s.get("connection_label") == exp_label, f"{ref}: label={s.get('connection_label')!r} exp={exp_label!r}"
        assert s.get("submitted_at"), f"{ref} missing submitted_at"


def test_phed_surveys_date_filter_accepts_iso(headers):
    # IndianDateInput emits ISO YYYY-MM-DD to the API
    r = requests.get(f"{BASE}/api/phed/surveys", headers=headers,
                     params={"limit": 50, "date_from": "2020-01-01", "date_to": "2030-12-31"}, timeout=20)
    assert r.status_code == 200, r.text
    assert isinstance(r.json().get("surveys"), list)
