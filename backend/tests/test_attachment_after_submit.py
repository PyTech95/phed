"""
Iteration 5 - verify backend change:
upload_attachment should ALLOW uploads while status is Submitted or Document Pending,
and only reject (409) when status is Approved.
"""
import io
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "http://localhost:8001"
TOWN = "THS"
HB = {"Content-Type": "application/json", "X-Town-Code": TOWN}


@pytest.fixture(scope="module")
def sh():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": "surveyor1", "password": "Survey@2026", "selected_town": TOWN},
                      headers=HB, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    return {"X-Town-Code": TOWN, "Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_sh():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": "admin", "password": "PhedAdmin@2026", "selected_town": TOWN},
                      headers=HB, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    return {"X-Town-Code": TOWN, "Authorization": f"Bearer {tok}"}


def _hj(sh):
    return {**sh, "Content-Type": "application/json"}


def _mk_prop(sh):
    body = {"owner_name": f"TEST_AS_{uuid.uuid4().hex[:6]}", "mobile": "9998887777",
            "ward": "1", "address": "TEST addr", "colony": "TEST_AS",
            "category": "Residential", "latitude": 29.9695, "longitude": 76.8783}
    r = requests.post(f"{BASE_URL}/api/phed/field-properties", json=body,
                      headers=_hj(sh), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _draft(sh, prop_id, water, survey_type="WATER_CONNECTION"):
    body = {"property_record_id": prop_id, "survey_type": survey_type,
            "latitude": 29.9695, "longitude": 76.8783, "water": water}
    r = requests.post(f"{BASE_URL}/api/phed/surveys/draft", json=body,
                      headers=_hj(sh), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _submit(sh, sid):
    return requests.post(f"{BASE_URL}/api/phed/surveys/{sid}/submit", headers=sh, timeout=30)


def _upload(sh, sid, att_type="HOUSE_PHOTO"):
    jpg = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\x00" * 200 + b"\xff\xd9"
    files = {"file": (f"{att_type}.jpg", io.BytesIO(jpg), "image/jpeg")}
    data = {"attachment_type": att_type}
    return requests.post(f"{BASE_URL}/api/phed/surveys/{sid}/attachments",
                         files=files, data=data, headers=sh, timeout=30)


def _get_prop(sh, prop_id):
    r = requests.get(f"{BASE_URL}/api/phed/property/{prop_id}", headers=sh, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# ---- Case A: submitted (has_connection=yes) then upload photo -> allowed ----
def test_attachment_after_submit_allowed(sh):
    prop_id = _mk_prop(sh)
    water = {"has_connection": True, "mobile": "9998887777"}
    d = _draft(sh, prop_id, water)
    sid = d.get("id") or d.get("survey_id")

    # First upload one photo before submit, so submit has an attachment
    r0 = _upload(sh, sid, "HOUSE_PHOTO")
    assert r0.status_code == 200, r0.text

    # Submit
    sub = _submit(sh, sid)
    assert sub.status_code == 200, sub.text
    prop = _get_prop(sh, prop_id)
    status = (prop.get("survey") or {}).get("status")
    print(f"[case-A] status after submit = {status}")
    assert status in ("Submitted", "Document Pending", "Requires Review"), status

    # Now upload another attachment AFTER submit -> should return 200 (was 409 before fix)
    r1 = _upload(sh, sid, "AADHAAR_FRONT")
    assert r1.status_code == 200, f"attachment after submit rejected: {r1.status_code} {r1.text}"

    # Verify it landed on the survey
    prop2 = _get_prop(sh, prop_id)
    types = [a["attachment_type"] for a in (prop2.get("survey") or {}).get("attachments", [])]
    assert "AADHAAR_FRONT" in types, types


# ---- Case B: document_pending flow -> uploads after submit still allowed ----
def test_attachment_after_document_pending_allowed(sh):
    prop_id = _mk_prop(sh)
    water = {"has_connection": False, "new_connection": True,
             "new_owner_name": "TEST_DP2", "new_locality": "TEST_DP2_Loc",
             "requested_service": "Water", "connection_category": "Domestic",
             "mobile": "9998887777",
             "document_pending": True,
             "missing_documents": ["PROPERTY_PROOF", "HOUSE_PHOTO"]}
    d = _draft(sh, prop_id, water, survey_type="NO_CONNECTION")
    sid = d.get("id") or d.get("survey_id")
    # Upload one non-blocking type before submit
    r0 = _upload(sh, sid, "APPLICATION")
    assert r0.status_code == 200, r0.text
    sub = _submit(sh, sid)
    assert sub.status_code == 200, sub.text
    prop = _get_prop(sh, prop_id)
    status = (prop.get("survey") or {}).get("status")
    print(f"[case-B] status = {status}")

    # Upload the missing docs AFTER submit
    for t in ["PROPERTY_PROOF", "HOUSE_PHOTO"]:
        r = _upload(sh, sid, t)
        assert r.status_code == 200, f"{t}: {r.status_code} {r.text}"


# ---- Case C: admin approves -> further attachment upload must return 409 ----
def test_attachment_after_approved_rejected(sh, admin_sh):
    prop_id = _mk_prop(sh)
    water = {"has_connection": True, "mobile": "9998887777"}
    d = _draft(sh, prop_id, water)
    sid = d.get("id") or d.get("survey_id")
    _upload(sh, sid, "HOUSE_PHOTO")
    sub = _submit(sh, sid)
    assert sub.status_code == 200, sub.text

    # Approve as admin
    r = requests.post(f"{BASE_URL}/api/phed/surveys/{sid}/approve",
                      headers=admin_sh, timeout=30)
    assert r.status_code == 200, r.text

    # Now upload as surveyor should be blocked with 409
    r2 = _upload(sh, sid, "AADHAAR_FRONT")
    assert r2.status_code == 409, f"expected 409 after approve, got {r2.status_code} {r2.text}"
