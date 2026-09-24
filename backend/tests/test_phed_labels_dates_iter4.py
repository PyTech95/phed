"""PHED regression (iter4): connection labels/categories, filters, and IST date boundaries."""

import os
import re
import uuid
from datetime import datetime

import pytest
import requests
from pymongo import MongoClient


def _read_base_url() -> str:
    env_url = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if env_url:
        return env_url.rstrip("/")
    with open("/app/frontend/.env", "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL missing")


def _cred(section: str, field: str) -> str:
    text = open("/app/memory/test_credentials.md", "r", encoding="utf-8").read()
    sec = re.search(rf"##\s+{re.escape(section)}[\s\S]*?(?=\n##\s+|\Z)", text)
    if not sec:
        raise RuntimeError(f"Credential section missing: {section}")
    m = re.search(rf"-\s+{re.escape(field)}:\s+`([^`]+)`", sec.group(0))
    if not m:
        raise RuntimeError(f"Missing field {field} in {section}")
    return m.group(1)


BASE = _read_base_url()
TOWN = "THS"


@pytest.fixture(scope="session")
def http():
    s = requests.Session()
    s.headers.update({"X-Town-Code": TOWN})
    return s


def _login(http, username: str, password: str):
    payload = {"username": username, "password": password, "selected_town": TOWN}
    r = http.post(f"{BASE}/api/auth/login", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    token = r.json().get("token")
    assert token
    return {"Authorization": f"Bearer {token}", "X-Town-Code": TOWN}


@pytest.fixture(scope="session")
def admin_h(http):
    return _login(
        http,
        _cred("Admin (seeded from env on first boot, 2026-09-19)", "Username"),
        _cred("Admin (seeded from env on first boot, 2026-09-19)", "Password"),
    )


@pytest.fixture(scope="session")
def surveyor_h(http):
    return _login(
        http,
        _cred("Synthetic Surveyor (created for Aadhaar crop/upload testing, 2026-09-19)", "Username"),
        _cred("Synthetic Surveyor (created for Aadhaar crop/upload testing, 2026-09-19)", "Password"),
    )


@pytest.fixture(scope="session")
def surveyor_user_id(http):
    payload = {
        "username": _cred("Synthetic Surveyor (created for Aadhaar crop/upload testing, 2026-09-19)", "Username"),
        "password": _cred("Synthetic Surveyor (created for Aadhaar crop/upload testing, 2026-09-19)", "Password"),
        "selected_town": TOWN,
    }
    r = http.post(f"{BASE}/api/auth/login", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["user"]["id"]


@pytest.fixture(scope="session")
def db_collection():
    mongo = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
    db_name = os.environ.get("DB_NAME") or "test_database"
    client = MongoClient(mongo)
    return client[db_name].phed_surveys


def _create_property(http, auth, owner_suffix: str):
    payload = {
        "owner_name": f"TEST_IT4_{owner_suffix}",
        "mobile": "9990011223",
        "ward": "1",
        "address": "Iter4 test lane",
        "colony": "TEST_COLONY",
        "category": "Residential",
        "latitude": 29.9695,
        "longitude": 76.8783,
    }
    r = http.post(f"{BASE}/api/phed/field-properties", json=payload, headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _draft_and_submit(http, auth, property_id: str, payload: dict):
    draft = http.post(f"{BASE}/api/phed/surveys/draft", json=payload, headers=auth, timeout=30)
    assert draft.status_code == 200, draft.text
    sid = draft.json()["id"]
    submit = http.post(f"{BASE}/api/phed/surveys/{sid}/submit", headers=auth, timeout=30)
    assert submit.status_code == 200, submit.text
    return sid, submit.json()


@pytest.fixture(scope="module")
def synthetic_surveys(http, surveyor_h):
    """Module/features: submit six exclusive categories + one UNKNOWN via actual APIs."""
    cases = []
    marker = f"IT4-{uuid.uuid4().hex[:6]}"

    def make_payload(prop_id, water_obj, survey_type="WATER_CONNECTION"):
        return {
            "property_record_id": prop_id,
            "survey_type": survey_type,
            "latitude": 29.9695,
            "longitude": 76.8783,
            "water": water_obj,
            "remarks": marker,
        }

    # BOTH -> ALREADY_CONNECTION
    p1 = _create_property(http, surveyor_h, f"BOTH_{marker}")
    sid, sub = _draft_and_submit(http, surveyor_h, p1["id"], make_payload(p1["id"], {
        "has_connection": True, "consumer_name": "TEST BOTH", "mobile": "9991110001",
        "connection_numbers": [f"W-{marker}-1"], "sewer_connection_numbers": [f"S-{marker}-1"],
    }))
    cases.append({"survey_id": sid, "property_id": p1["property_id"], "property_record_id": p1["id"], "expected": "ALREADY_CONNECTION", "submit": sub})

    # WATER only
    p2 = _create_property(http, surveyor_h, f"WATER_{marker}")
    sid, sub = _draft_and_submit(http, surveyor_h, p2["id"], make_payload(p2["id"], {
        "has_connection": True, "consumer_name": "TEST WATER", "mobile": "9991110002",
        "connection_numbers": [f"W-{marker}-2"], "sewer_connection_numbers": [],
    }))
    cases.append({"survey_id": sid, "property_id": p2["property_id"], "property_record_id": p2["id"], "expected": "WATER_CONNECTION", "submit": sub})

    # SEWER only
    p3 = _create_property(http, surveyor_h, f"SEWER_{marker}")
    sid, sub = _draft_and_submit(http, surveyor_h, p3["id"], make_payload(p3["id"], {
        "has_connection": True, "consumer_name": "TEST SEWER", "mobile": "9991110003",
        "connection_numbers": [], "sewer_connection_numbers": [f"S-{marker}-3"],
    }))
    cases.append({"survey_id": sid, "property_id": p3["property_id"], "property_record_id": p3["id"], "expected": "SEWER_CONNECTION", "submit": sub})

    # NEW connection
    p4 = _create_property(http, surveyor_h, f"NEW_{marker}")
    sid, sub = _draft_and_submit(http, surveyor_h, p4["id"], make_payload(p4["id"], {
        "has_connection": False, "new_connection": True, "new_owner_name": "TEST NEW", "new_locality": "TEST_COLONY",
        "requested_service": "Both", "connection_category": "Domestic", "mobile": "9991110004",
    }, survey_type="NO_CONNECTION"))
    cases.append({"survey_id": sid, "property_id": p4["property_id"], "property_record_id": p4["id"], "expected": "NEW_CONNECTION", "submit": sub})

    # DEATH transfer (should override service flags)
    p5 = _create_property(http, surveyor_h, f"DEATH_{marker}")
    sid, sub = _draft_and_submit(http, surveyor_h, p5["id"], make_payload(p5["id"], {
        "has_connection": True, "consumer_name": "TEST DEATH", "mobile": "9991110005",
        "connection_numbers": [f"W-{marker}-5"], "sewer_connection_numbers": [f"S-{marker}-5"],
        "owner_change": "DEATH_TRANSFER", "new_owner_name": "NEW OWNER",
    }))
    cases.append({"survey_id": sid, "property_id": p5["property_id"], "property_record_id": p5["id"], "expected": "DEATH_TRANSFER", "submit": sub})

    # OWNERSHIP change (should override service flags)
    p6 = _create_property(http, surveyor_h, f"OWN_{marker}")
    sid, sub = _draft_and_submit(http, surveyor_h, p6["id"], make_payload(p6["id"], {
        "has_connection": True, "consumer_name": "TEST OWN", "mobile": "9991110006",
        "connection_numbers": [f"W-{marker}-6"], "sewer_connection_numbers": [f"S-{marker}-6"],
        "owner_change": "OWNERSHIP_CHANGE", "new_owner_name": "NEW OWNER",
    }))
    cases.append({"survey_id": sid, "property_id": p6["property_id"], "property_record_id": p6["id"], "expected": "OWNERSHIP_CHANGE", "submit": sub})

    # UNKNOWN (no service metadata, not new, not transfers)
    p7 = _create_property(http, surveyor_h, f"UNK_{marker}")
    sid, sub = _draft_and_submit(http, surveyor_h, p7["id"], make_payload(p7["id"], {
        "has_connection": True, "consumer_name": "TEST UNKNOWN", "mobile": "9991110007",
        "connection_numbers": [], "sewer_connection_numbers": [],
    }))
    cases.append({"survey_id": sid, "property_id": p7["property_id"], "property_record_id": p7["id"], "expected": "UNKNOWN", "submit": sub})

    return {"marker": marker, "cases": cases}


# Module/features: submit response + list/detail labels use exclusive connection categories
def test_submit_response_and_list_labels(http, admin_h, synthetic_surveys, surveyor_user_id):
    case_map = {c["survey_id"]: c for c in synthetic_surveys["cases"]}
    for c in synthetic_surveys["cases"]:
        assert c["submit"]["connection_type"] == c["expected"]

    lst = http.get(f"{BASE}/api/phed/surveys", headers=admin_h, params={"limit": 200, "surveyor_id": surveyor_user_id}, timeout=30)
    assert lst.status_code == 200, lst.text
    rows = [r for r in lst.json().get("surveys", []) if r.get("id") in case_map]
    assert len(rows) == len(case_map)
    for row in rows:
        expected = case_map[row["id"]]["expected"]
        assert row.get("connection_type") == expected
        assert isinstance(row.get("connection_label"), str) and row.get("connection_label")


# Module/features: each connection_type filter returns only matching surveys (no overlap by code)
@pytest.mark.parametrize(
    "code",
    [
        "ALREADY_CONNECTION",
        "WATER_CONNECTION",
        "SEWER_CONNECTION",
        "NEW_CONNECTION",
        "DEATH_TRANSFER",
        "OWNERSHIP_CHANGE",
        "UNKNOWN",
    ],
)
def test_connection_type_filter_exclusive(http, admin_h, synthetic_surveys, surveyor_user_id, code):
    r = http.get(
        f"{BASE}/api/phed/surveys",
        headers=admin_h,
        params={"connection_type": code, "limit": 200, "surveyor_id": surveyor_user_id},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    rows = r.json().get("surveys", [])
    assert all(row.get("connection_type") == code for row in rows)
    expected_ids = {c["survey_id"] for c in synthetic_surveys["cases"] if c["expected"] == code}
    if expected_ids:
        got_ids = {row.get("id") for row in rows}
        assert expected_ids.issubset(got_ids)


# Module/features: malformed/reversed date validation on list filter
def test_survey_date_filter_validation(http, admin_h):
    bad = http.get(
        f"{BASE}/api/phed/surveys",
        headers=admin_h,
        params={"date_from": "31/02/2026"},
        timeout=30,
    )
    assert bad.status_code == 400
    assert "YYYY-MM-DD" in bad.text

    reversed_range = http.get(
        f"{BASE}/api/phed/surveys",
        headers=admin_h,
        params={"date_from": "2026-09-21", "date_to": "2026-09-20"},
        timeout=30,
    )
    assert reversed_range.status_code == 400
    assert "From date" in reversed_range.text


# Module/features: IST boundary conversion in backend filters includes/excludes exact UTC boundaries
def test_backend_date_boundary_inclusion(http, admin_h, synthetic_surveys, db_collection, surveyor_user_id):
    ids = [c["survey_id"] for c in synthetic_surveys["cases"][:4]]
    boundary_values = [
        "2026-09-19T18:29:59",  # exclude (before IST day start)
        "2026-09-19T18:30:00",  # include
        "2026-09-20T18:29:59",  # include
        "2026-09-20T18:30:00",  # exclude
    ]
    for sid, ts in zip(ids, boundary_values):
        db_collection.update_one({"id": sid}, {"$set": {"submitted_at": ts, "updated_at": ts}})

    r = http.get(
        f"{BASE}/api/phed/surveys",
        headers=admin_h,
        params={"date_from": "2026-09-20", "date_to": "2026-09-20", "limit": 500, "surveyor_id": surveyor_user_id},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    got = {row["id"] for row in r.json().get("surveys", [])}
    assert ids[0] not in got
    assert ids[1] in got
    assert ids[2] in got
    assert ids[3] not in got


# Module/features: dashboard/my-progress categories include transfer buckets and don't collapse as already-connection
def test_dashboard_and_my_progress_outcome_categories(http, admin_h, surveyor_h):
    dash = http.get(f"{BASE}/api/phed/dashboard", headers=admin_h, timeout=30)
    assert dash.status_code == 200, dash.text
    by_outcome = dash.json().get("by_outcome", {})
    for key in ["water_connection", "sewer_connection", "death_transfer", "ownership_change", "new_connection"]:
        assert key in by_outcome

    myp = http.get(f"{BASE}/api/phed/my-progress", headers=surveyor_h, timeout=30)
    assert myp.status_code == 200, myp.text
    body = myp.json()
    for key in ["already_connection", "water_connection", "sewer_connection", "death_transfer", "ownership_change", "new_connection"]:
        assert key in body


# Module/features: today dashboard report date uses Asia/Kolkata day format source (YYYY-MM-DD)
def test_today_dashboard_report_date_format(http, admin_h):
    r = http.get(f"{BASE}/api/phed/dashboard/today", headers=admin_h, timeout=30)
    assert r.status_code == 200, r.text
    report_date = r.json().get("report_date")
    assert re.match(r"^\d{4}-\d{2}-\d{2}$", str(report_date))
    # parseable date
    datetime.strptime(report_date, "%Y-%m-%d")
