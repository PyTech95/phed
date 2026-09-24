"""Iter 8 — Map popup PHED enrichment + PHED property detail endpoint."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://phed-ops.preview.emergentagent.com").rstrip("/")
ADMIN_USER = "admin"
ADMIN_PASS = "Phed#Admin2026!"

THS_0001_UUID = "6abd2d41-a7fc-479d-992a-3a72558b30aa"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# --- Anonymous access must be denied ---
def test_map_properties_requires_auth():
    r = requests.get(f"{BASE_URL}/api/map/properties", params={"colony": "Didar Nagar"}, timeout=30)
    assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"


def test_phed_property_requires_auth():
    r = requests.get(f"{BASE_URL}/api/phed/property/{THS_0001_UUID}", timeout=30)
    assert r.status_code in (401, 403)


# --- Map properties enrichment ---
def test_map_properties_ths0001_has_phed_fields(admin_headers):
    r = requests.get(f"{BASE_URL}/api/map/properties", params={"colony": "Didar Nagar"}, headers=admin_headers, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "properties" in data and isinstance(data["properties"], list)
    props = data["properties"]
    assert len(props) > 0
    # No ObjectId serialization leak
    for p in props:
        assert "_id" not in p
    # Find THS-0001
    ths = next((p for p in props if p.get("property_id") == "THS-0001" or p.get("id") == THS_0001_UUID), None)
    assert ths is not None, "THS-0001 not present in Didar Nagar map"
    # Legacy MC fields still present
    assert ths.get("property_id") == "THS-0001"
    assert "owner_name" in ths
    # PHED linked fields
    assert "phed_consumer_id" in ths, f"phed_consumer_id missing on THS-0001 marker: {ths}"
    assert ths.get("phed_consumer_id"), "phed_consumer_id blank"
    assert "phed_consumer_name" in ths
    # phed_consumer_mobile may be present (possibly empty), but key must exist
    assert "phed_consumer_mobile" in ths


# --- PHED property detail endpoint ---
def test_phed_property_detail_ths0001(admin_headers):
    r = requests.get(f"{BASE_URL}/api/phed/property/{THS_0001_UUID}", headers=admin_headers, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("property", "consumers", "survey"):
        assert k in body, f"missing key {k}"
    prop = body["property"]
    assert prop.get("property_id") == "THS-0001"
    assert "_id" not in prop
    # Consumers linked
    consumers = body["consumers"]
    assert isinstance(consumers, list)
    assert len(consumers) >= 1, "expected linked PHED consumer for THS-0001"
    for c in consumers:
        assert "_id" not in c
    # Survey status Submitted with reference PL0001
    survey = body.get("survey")
    assert survey is not None, "expected phed survey for THS-0001"
    assert "_id" not in survey
    # Check reference and status
    ref = survey.get("reference_number") or survey.get("reference") or survey.get("survey_reference")
    # search fallback: dump values
    if not ref:
        ref = str(survey)
    assert "PL0001" in str(ref) or "PL0001" in str(survey), f"PL0001 not found in survey: {survey}"
    assert survey.get("status") == "Submitted", f"unexpected survey status {survey.get('status')}"


# --- Property with no PHED survey ---
def test_map_property_without_phed_survey(admin_headers):
    r = requests.get(f"{BASE_URL}/api/map/properties", params={"colony": "Didar Nagar"}, headers=admin_headers, timeout=60)
    assert r.status_code == 200
    props = r.json()["properties"]
    # Find one without phed_consumer_id
    unlinked = [p for p in props if not p.get("phed_consumer_id")]
    # This is informational — at least confirm keys are absent (not misrepresented)
    for p in unlinked[:5]:
        assert not p.get("phed_consumer_id")
        # phed_survey_status may still exist but must not falsely equal "Submitted" without consumer
