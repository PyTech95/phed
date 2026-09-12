"""Iter5: PHED Survey Review filters: colony, date range, connection_type + filter_options."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_USER = "admin"
ADMIN_PASS = "Phed#Admin2026!"

EXPECTED_CONN_TYPES = [
    ("PROPERTY_LOCKED", "Property locked"),
    ("OWNER_DENIED", "Owner denied"),
    ("WATER_CONNECTION", "Water connection"),
    ("SEWER_CONNECTION", "Sewer connection"),
    ("ALREADY_CONNECTION", "Already connection"),
    ("NEW_CONNECTION", "New connection"),
    ("DEATH_TRANSFER", "Death transfer"),
    ("OWNERSHIP_CHANGE", "Ownership change"),
]


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    return s


def test_filters_endpoint_has_all_8_connection_types(admin_client):
    r = admin_client.get(f"{API}/phed/filters", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "survey_connection_types" in data
    got = [tuple(x) for x in data["survey_connection_types"]]
    assert got == EXPECTED_CONN_TYPES, f"Got: {got}"


def test_surveys_baseline_no_filters(admin_client):
    r = admin_client.get(f"{API}/phed/surveys", timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "surveys" in data and "total" in data


def test_surveys_colony_case_insensitive_trim(admin_client):
    # Use colony from the safe PL0001 record: "Didar Nagar"
    for variant in ("Didar Nagar", "didar nagar", "  DIDAR NAGAR  "):
        r = admin_client.get(f"{API}/phed/surveys", params={"colony": variant}, timeout=20)
        assert r.status_code == 200, f"{variant}: {r.text}"
        # every returned row should match colony
        for s in r.json()["surveys"]:
            assert (s.get("colony_name") or "").strip().lower() == "didar nagar"


def test_surveys_date_range_inclusive(admin_client):
    # PL0001 submitted_at is 2026-09-12; date_to must be inclusive
    r = admin_client.get(
        f"{API}/phed/surveys",
        params={"date_from": "2026-09-12", "date_to": "2026-09-12"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    refs = [s.get("reference_number") for s in r.json()["surveys"]]
    assert "PL0001" in refs, f"PL0001 not in date-inclusive result: {refs}"


def test_surveys_date_bad_format_returns_400(admin_client):
    r = admin_client.get(f"{API}/phed/surveys", params={"date_from": "12-09-2026"}, timeout=15)
    assert r.status_code == 400


def test_surveys_all_connection_types_no_500(admin_client):
    for code, _label in EXPECTED_CONN_TYPES:
        r = admin_client.get(f"{API}/phed/surveys", params={"connection_type": code}, timeout=20)
        assert r.status_code == 200, f"{code}: {r.status_code} {r.text}"
        # Ensure returned rows contain no ObjectId
        for s in r.json()["surveys"]:
            assert "_id" not in s


def test_surveys_invalid_connection_type_400(admin_client):
    r = admin_client.get(f"{API}/phed/surveys", params={"connection_type": "BOGUS"}, timeout=15)
    assert r.status_code == 400


def test_surveys_combined_filter_pl0001(admin_client):
    r = admin_client.get(
        f"{API}/phed/surveys",
        params={"date_from": "2026-09-12", "date_to": "2026-09-12", "connection_type": "PROPERTY_LOCKED"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    refs = [s.get("reference_number") for s in data["surveys"]]
    assert refs == ["PL0001"], f"Expected exactly PL0001, got {refs}"
    row = data["surveys"][0]
    # Verify essential fields
    assert row.get("colony_name") == "Didar Nagar"
    assert row.get("ward_number") == "27" or row.get("ward_number") == 27
    w = row.get("water") or {}
    assert w.get("property_locked") is True
    assert (w.get("consumer_name") or row.get("owner_name")) == "Verify Owner 1"
    assert w.get("mobile") == "9000000001" or w.get("phone") == "9000000001"
    assert row.get("status") == "Submitted"
    assert (row.get("submitted_at") or "").startswith("2026-09-12")


def test_unauth_rejected():
    r = requests.get(f"{API}/phed/surveys", timeout=10)
    assert r.status_code in (401, 403)
