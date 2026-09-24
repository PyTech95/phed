"""PHED office-document declaration backend regression tests (iteration 3)."""

import os
import re
import uuid

import pytest
import requests


def _base_url() -> str:
    env_url = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if env_url:
        return env_url.rstrip("/")
    with open("/app/frontend/.env", "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                val = line.split("=", 1)[1].strip()
                if val:
                    return val.rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL is missing")


def _read_cred(label: str, field: str) -> str:
    text = open("/app/memory/test_credentials.md", "r", encoding="utf-8").read()
    section = re.search(rf"##\s+{re.escape(label)}[\s\S]*?(?=\n##\s+|\Z)", text)
    if not section:
        raise RuntimeError(f"Credentials section missing: {label}")
    m = re.search(rf"-\s+{re.escape(field)}:\s+`([^`]+)`", section.group(0))
    if not m:
        raise RuntimeError(f"{field} missing for {label}")
    return m.group(1)


BASE_URL = _base_url()
TOWN = "THS"


@pytest.fixture(scope="session")
def http():
    session = requests.Session()
    session.headers.update({"X-Town-Code": TOWN})
    return session


@pytest.fixture(scope="session")
def surveyor_auth(http):
    payload = {
        "username": _read_cred("Synthetic Surveyor (created for Aadhaar crop/upload testing, 2026-09-19)", "Username"),
        "password": _read_cred("Synthetic Surveyor (created for Aadhaar crop/upload testing, 2026-09-19)", "Password"),
        "selected_town": TOWN,
    }
    r = http.post(f"{BASE_URL}/api/auth/login", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    token = body.get("token")
    assert token
    return {
        "Authorization": f"Bearer {token}",
        "X-Town-Code": TOWN,
        "surveyor_id": body["user"]["id"],
        "surveyor_name": body["user"].get("name"),
    }


@pytest.fixture(scope="session")
def admin_auth(http):
    payload = {
        "username": _read_cred("Admin (seeded from env on first boot, 2026-09-19)", "Username"),
        "password": _read_cred("Admin (seeded from env on first boot, 2026-09-19)", "Password"),
        "selected_town": TOWN,
    }
    r = http.post(f"{BASE_URL}/api/auth/login", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    token = r.json().get("token")
    assert token
    return {"Authorization": f"Bearer {token}", "X-Town-Code": TOWN}


def _create_property(http, auth_headers):
    payload = {
        "owner_name": f"TEST_OFFICE_{uuid.uuid4().hex[:6]}",
        "mobile": "9898989898",
        "ward": "1",
        "address": "TEST office declaration lane",
        "colony": "TEST_COLONY",
        "category": "Residential",
        "latitude": 29.9695,
        "longitude": 76.8783,
    }
    r = http.post(f"{BASE_URL}/api/phed/field-properties", json=payload, headers=auth_headers, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _draft_payload(property_id, *, office_submitted=True, with_mobile=True, with_locality=True, with_gps=True):
    mobile = "9998887777" if with_mobile else ""
    locality = "TEST Locality" if with_locality else ""
    payload = {
        "property_record_id": property_id,
        "survey_type": "NO_CONNECTION",
        "water": {
            "has_connection": False,
            "new_connection": True,
            "new_owner_name": "TEST Owner",
            "new_locality": locality,
            "requested_service": "Water",
            "connection_category": "Domestic",
            "mobile": mobile,
            "phone": mobile,
        },
        "office_documents_submitted": office_submitted,
    }
    if with_gps:
        payload.update({"latitude": 29.9695, "longitude": 76.8783})
    return payload


# Module and feature: strict bool validation + office declaration submit path
def test_office_documents_submitted_accepts_only_boolean(http, surveyor_auth):
    prop = _create_property(http, surveyor_auth)
    bad_string = _draft_payload(prop["id"], office_submitted="true")
    bad_int = _draft_payload(prop["id"], office_submitted=1)

    r1 = http.post(f"{BASE_URL}/api/phed/surveys/draft", json=bad_string, headers=surveyor_auth, timeout=30)
    r2 = http.post(f"{BASE_URL}/api/phed/surveys/draft", json=bad_int, headers=surveyor_auth, timeout=30)

    assert r1.status_code == 422, r1.text
    assert r2.status_code == 422, r2.text


# Module and feature: forged nested office recorder fields must be ignored and server-generated
def test_forged_nested_office_recorder_fields_cannot_override_server_values(http, surveyor_auth):
    prop = _create_property(http, surveyor_auth)
    payload = _draft_payload(prop["id"], office_submitted=True)
    payload["water"].update({
        "office_documents_submitted": False,
        "office_documents_recorded_by": "FORGED_USER",
        "office_documents_recorded_by_name": "FORGED_NAME",
        "office_documents_recorded_at": "2000-01-01T00:00:00Z",
    })

    draft = http.post(f"{BASE_URL}/api/phed/surveys/draft", json=payload, headers=surveyor_auth, timeout=30)
    assert draft.status_code == 200, draft.text
    survey = draft.json()
    water = survey.get("water") or {}

    assert water.get("office_documents_submitted") is True
    assert water.get("office_documents_recorded_by") == surveyor_auth["surveyor_id"]
    assert water.get("office_documents_recorded_by") != "FORGED_USER"
    assert water.get("office_documents_recorded_by_name") != "FORGED_NAME"
    assert isinstance(water.get("office_documents_recorded_at"), str)
    assert water.get("missing_documents") == []
    assert water.get("document_pending") is False

    submit = http.post(f"{BASE_URL}/api/phed/surveys/{survey['id']}/submit", headers=surveyor_auth, timeout=30)
    assert submit.status_code == 200, submit.text
    submit_body = submit.json()

    assert isinstance(submit_body.get("office_documents_submitted"), bool)
    assert submit_body.get("office_documents_submitted") is True
    assert submit_body.get("status") in ("Submitted", "Requires Review")

    detail = http.get(f"{BASE_URL}/api/phed/property/{prop['id']}", headers=surveyor_auth, timeout=30)
    assert detail.status_code == 200, detail.text
    detail_body = detail.json()
    assert "_id" not in detail_body
    survey_detail = detail_body.get("survey") or {}
    assert "_id" not in survey_detail
    assert (survey_detail.get("water") or {}).get("office_documents_submitted") is True


# Module and feature: submit must still enforce GPS + required details under office declaration
def test_submit_with_office_declaration_still_requires_gps_and_required_fields(http, surveyor_auth):
    # Missing GPS
    prop1 = _create_property(http, surveyor_auth)
    draft1 = http.post(
        f"{BASE_URL}/api/phed/surveys/draft",
        json=_draft_payload(prop1["id"], office_submitted=True, with_gps=False),
        headers=surveyor_auth,
        timeout=30,
    )
    assert draft1.status_code == 200, draft1.text
    submit1 = http.post(f"{BASE_URL}/api/phed/surveys/{draft1.json()['id']}/submit", headers=surveyor_auth, timeout=30)
    assert submit1.status_code == 400, submit1.text
    assert "GPS" in submit1.text or "location" in submit1.text.lower()

    # Missing locality + mobile should fail office submit validation
    prop2 = _create_property(http, surveyor_auth)
    draft2 = http.post(
        f"{BASE_URL}/api/phed/surveys/draft",
        json=_draft_payload(prop2["id"], office_submitted=True, with_mobile=False, with_locality=False),
        headers=surveyor_auth,
        timeout=30,
    )
    assert draft2.status_code == 200, draft2.text
    submit2 = http.post(f"{BASE_URL}/api/phed/surveys/{draft2.json()['id']}/submit", headers=surveyor_auth, timeout=30)
    assert submit2.status_code == 400, submit2.text
    assert ("Mobile" in submit2.text) or ("locality" in submit2.text.lower())


# Module and feature: office declaration audit event and list/detail response shape
def test_office_declaration_audit_and_list_visibility(http, surveyor_auth, admin_auth):
    prop = _create_property(http, surveyor_auth)
    base_payload = _draft_payload(prop["id"], office_submitted=False)

    d1 = http.post(f"{BASE_URL}/api/phed/surveys/draft", json=base_payload, headers=surveyor_auth, timeout=30)
    assert d1.status_code == 200, d1.text
    sid = d1.json()["id"]

    base_payload["office_documents_submitted"] = True
    d2 = http.post(f"{BASE_URL}/api/phed/surveys/draft", json=base_payload, headers=surveyor_auth, timeout=30)
    assert d2.status_code == 200, d2.text
    assert (d2.json().get("water") or {}).get("office_documents_submitted") is True

    s = http.post(f"{BASE_URL}/api/phed/surveys/{sid}/submit", headers=surveyor_auth, timeout=30)
    assert s.status_code == 200, s.text

    logs = http.get(
        f"{BASE_URL}/api/phed/audit",
        params={"entity_id": sid, "action": "SURVEY_OFFICE_DOCUMENTS", "limit": 10},
        headers=admin_auth,
        timeout=30,
    )
    assert logs.status_code == 200, logs.text
    entries = logs.json().get("logs") or []
    assert len(entries) >= 1
    assert all("_id" not in e for e in entries)
    assert any((e.get("after") or {}).get("office_documents_submitted") in (True, False) for e in entries)

    # Ensure office declaration is returned in survey list response (used by admin UI rows)
    lst = http.get(
        f"{BASE_URL}/api/phed/surveys",
        params={"search": prop["property_id"], "limit": 10},
        headers=admin_auth,
        timeout=30,
    )
    assert lst.status_code == 200, lst.text
    rows = lst.json().get("surveys") or []
    assert any((row.get("water") or {}).get("office_documents_submitted") is True for row in rows)
    assert all("_id" not in row for row in rows)


# Module and feature: auth protections remain enforced
def test_auth_guard_still_blocks_phed_survey_listing_without_token(http):
    r = http.get(f"{BASE_URL}/api/phed/surveys", timeout=30)
    assert r.status_code in (401, 403)
