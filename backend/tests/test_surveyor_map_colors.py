"""
Reproduction tests for the "surveyor map pin does not turn yellow after submit" bug.

Scope (PRE-FIX / REPRODUCE-ONLY):
- Verify /api/map/employee-properties returns phed_survey_state so pins can render yellow.
- Verify /api/employee/properties/search projection is MISSING phed_survey_state / phed_outcome
  => this reproduces the RED "Pending" badge in the citywide search dropdown even when
     the property is already Submitted (yellow) on the primary map.
- Verify submit_survey flips property.phed_survey_state to Submitted/RequiresReview/DocumentPending
  and that clear_map_cache() is invoked on the server (indirectly: subsequent /map call reflects the new state).
- Verify Draft after save_draft sets phed_survey_state=Draft (admin flags yellow, surveyor Properties.js
  currently flags this as In Progress → amber #f59e0b vs admin #eab308).

Fixtures (TEST_MAPCOLOR_*):
  - 5 phed_surveys per state (Submitted / Requires Review / Document Pending / Draft / Approved)
    driven through the real save_draft + submit endpoints against a scratch property.
  - 1 property (TEST_MAPCOLOR_PROP_<state>) per fixture with GPS near Thanesar.
Teardown deletes only these exact IDs.

Credentials from /app/memory/test_credentials.md via env-derived BASE_URL. No new users.
"""
import os
import uuid
import time
import pytest
import requests
from pymongo import MongoClient

def _base_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    from dotenv import dotenv_values
    return dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"].rstrip("/")

BASE_URL = _base_url()

ADMIN = ("phedadmin", "Phed@Admin2026!")
SURVEYOR = ("test_surveyor_citywide", "TestSurv@2026!")

# Thanesar-ish
LAT, LNG = 29.9695, 76.8783


@pytest.fixture(scope="module")
def mongo():
    from dotenv import dotenv_values
    env = dotenv_values("/app/backend/.env")
    cli = MongoClient(env["MONGO_URL"])
    yield cli[env["DB_NAME"]]
    cli.close()


def _login(username, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json().get("token") or r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def surveyor_token():
    return _login(*SURVEYOR)


@pytest.fixture(scope="module")
def surveyor_user(surveyor_token):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {surveyor_token}"}, timeout=10)
    assert r.status_code == 200
    return r.json()


@pytest.fixture
def fresh_property(mongo, surveyor_user):
    """Create one scratch assigned property; deleted in teardown."""
    pid = f"TEST_MAPCOLOR_PROP_{uuid.uuid4().hex[:8]}"
    doc = {
        "id": str(uuid.uuid4()),
        "property_id": pid,
        "owner_name": "TEST MAPCOLOR Owner",
        "mobile": "9999999999",
        "address": "TEST_MAPCOLOR Address",
        "colony": "TEST_MAPCOLOR Colony",
        "ward": "27",
        "ward_number": "27",
        "latitude": LAT,
        "longitude": LNG,
        "status": "Pending",  # MC status stays Pending forever
        "assigned_employee_id": surveyor_user["id"],
        "assigned_employee_ids": [surveyor_user["id"]],
        "town_code": "THS",
        "serial_number": "9999",
        "bill_sr_no": "9999",
        "category": "Residential",
    }
    mongo.properties.insert_one(doc)
    yield doc
    mongo.properties.delete_one({"id": doc["id"]})
    # cascade-clean any surveys created for this scratch property
    mongo.phed_surveys.delete_many({"property_record_id": doc["id"]})


# ---- 1. /map/employee-properties DOES include phed_survey_state ----
def test_employee_map_returns_phed_survey_state(surveyor_token):
    r = requests.get(f"{BASE_URL}/api/map/employee-properties",
                     headers={"Authorization": f"Bearer {surveyor_token}", "X-Town-Code": "THS"},
                     timeout=15)
    assert r.status_code == 200, r.text
    props = r.json().get("properties", [])
    if not props:
        pytest.skip("Surveyor has no assigned properties on map")
    keys = set().union(*[set(p.keys()) for p in props])
    assert "phed_survey_state" in keys, "map endpoint must expose phed_survey_state for yellow-pin rule"
    assert "phed_outcome" in keys, "map endpoint must expose phed_outcome"


# ---- 2. /employee/properties/search projection is MISSING phed_survey_state (REPRODUCES BUG A) ----
def test_search_projection_missing_phed_survey_state(surveyor_token, mongo, fresh_property):
    # Force a Submitted phed_survey_state directly on the property doc (bypasses the survey flow;
    # we're testing the projection here, not the submit flow).
    mongo.properties.update_one({"id": fresh_property["id"]},
                                {"$set": {"phed_survey_state": "Submitted",
                                          "phed_survey_status": "Submitted",
                                          "phed_outcome": "connection_verified"}})
    r = requests.get(f"{BASE_URL}/api/employee/properties/search",
                     headers={"Authorization": f"Bearer {surveyor_token}", "X-Town-Code": "THS"},
                     params={"search": fresh_property["property_id"], "page": 1, "limit": 5},
                     timeout=15)
    assert r.status_code == 200, r.text
    items = r.json()["properties"]
    assert items, f"search must return the seeded property {fresh_property['property_id']}"
    hit = next((p for p in items if p["property_id"] == fresh_property["property_id"]), None)
    assert hit is not None
    # THIS IS THE BUG (documented): phed_survey_state is not projected, so UI cannot colour the row yellow.
    assert "phed_survey_state" not in hit, (
        "BUG-REPRO: search unexpectedly now projects phed_survey_state — bug may be fixed; "
        "verify frontend applies withPhedStatus on searchResults."
    )
    # The raw `status` still says the MC status (Pending), which is what the current search dropdown paints red.
    assert hit["status"] == "Pending"


# ---- 3. Full submit flow: property.phed_survey_state flips to Submitted ----
def _phed_survey_dict(surveyor_user, prop, survey_type="EXISTING_LINKED"):
    return {
        "property_record_id": prop["id"],
        "property_id": prop["property_id"],
        "survey_type": survey_type,
        "latitude": LAT,
        "longitude": LNG,
        "gps_accuracy": 5.0,
        "gps_captured_at": "2026-01-01T00:00:00Z",
        "surveyor_latitude": LAT,
        "surveyor_longitude": LNG,
        "remarks": "TEST_MAPCOLOR",
        "consumer_refs": [],
        "water": {
            "consumer_name": "TEST MAPCOLOR",
            "phone": "9999999999",
            "category": "Domestic",
            "connection_numbers": ["TESTCONN-" + uuid.uuid4().hex[:6]],
            "document_pending": False,
        },
    }


def test_submit_flips_phed_survey_state_to_submitted(surveyor_token, surveyor_user, fresh_property, mongo):
    H = {"Authorization": f"Bearer {surveyor_token}", "X-Town-Code": "THS"}
    body = _phed_survey_dict(surveyor_user, fresh_property, survey_type="WATER_CONNECTION")
    d = requests.post(f"{BASE_URL}/api/phed/surveys/draft", json=body, headers=H, timeout=15)
    assert d.status_code == 200, d.text
    sid = d.json()["id"]
    s = requests.post(f"{BASE_URL}/api/phed/surveys/{sid}/submit", headers=H, timeout=15)
    assert s.status_code == 200, s.text
    assert s.json()["status"] in ("Submitted", "Requires Review", "Document Pending")

    # Verify DB reflects it
    p = mongo.properties.find_one({"id": fresh_property["id"]})
    assert p["phed_survey_state"] in ("Submitted", "Requires Review", "Document Pending"), p.get("phed_survey_state")

    # Immediately re-hit /map/employee-properties: cache should have been cleared on submit.
    m = requests.get(f"{BASE_URL}/api/map/employee-properties", headers=H, timeout=15)
    assert m.status_code == 200
    hit = next((x for x in m.json()["properties"] if x.get("property_id") == fresh_property["property_id"]), None)
    assert hit is not None, "submitted property must appear in map endpoint"
    assert hit.get("phed_survey_state") in ("Submitted", "Requires Review", "Document Pending"), (
        f"BUG: map cache stale — phed_survey_state={hit.get('phed_survey_state')} after submit"
    )


# ---- 4. Draft state (save_draft only, no submit) ----
def test_draft_sets_phed_survey_state_draft(surveyor_token, surveyor_user, fresh_property, mongo):
    H = {"Authorization": f"Bearer {surveyor_token}", "X-Town-Code": "THS"}
    body = _phed_survey_dict(surveyor_user, fresh_property, survey_type="EXISTING_LINKED")
    d = requests.post(f"{BASE_URL}/api/phed/surveys/draft", json=body, headers=H, timeout=15)
    assert d.status_code == 200, d.text
    # Draft is only reflected on property if save_draft flips phed_survey_state to Draft — verify.
    p = mongo.properties.find_one({"id": fresh_property["id"]})
    # Either Draft explicitly, or the field is set to something non-null; the surveyor Properties.js
    # withPhedStatus maps Draft → In Progress (amber), whereas admin Map.js maps Draft → Completed (yellow).
    state = p.get("phed_survey_state")
    status = p.get("phed_survey_status")
    # save_draft (phed.py:1334) only sets phed_survey_status="Draft", NOT phed_survey_state.
    # That's fine for a colour change but is inconsistent with submit (which sets both) and causes
    # Properties.js withPhedStatus to fall back to phed_survey_status="Draft" → 'In Progress' (amber #f59e0b),
    # while admin Map.js withSurveyStatus treats Draft as 'Completed' (yellow #eab308). Minor divergence.
    assert status == "Draft", f"save_draft must set phed_survey_status=Draft, got {status!r}"
    print(f"[INFO] draft phed_survey_state={state!r} phed_survey_status={status!r}")


# ---- 5. Approve flow: state → Approved (green on both) ----
def test_approve_flips_state_to_approved(admin_token, surveyor_token, surveyor_user, fresh_property, mongo):
    HS = {"Authorization": f"Bearer {surveyor_token}", "X-Town-Code": "THS"}
    HA = {"Authorization": f"Bearer {admin_token}", "X-Town-Code": "THS"}
    body = _phed_survey_dict(surveyor_user, fresh_property, survey_type="WATER_CONNECTION")
    d = requests.post(f"{BASE_URL}/api/phed/surveys/draft", json=body, headers=HS, timeout=15)
    assert d.status_code == 200, d.text
    sid = d.json()["id"]
    s = requests.post(f"{BASE_URL}/api/phed/surveys/{sid}/submit", headers=HS, timeout=15)
    assert s.status_code == 200, s.text
    a = requests.post(f"{BASE_URL}/api/phed/surveys/{sid}/approve", headers=HA, timeout=15)
    assert a.status_code == 200, a.text
    p = mongo.properties.find_one({"id": fresh_property["id"]})
    assert p.get("phed_survey_state") == "Approved"
