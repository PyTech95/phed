"""
Backend tests for the surveyor Water Bill Survey flows (iteration 6):
- PROPERTY_PROOF (Registry) attachment upload + persistence + download (bug #19)
- AADHAAR_FRONT / AADHAAR_BACK upload
- New Connection water fields (requested_service, connection_category, new_locality)
- Owner denied flow (no docs required)
- Document Pending flow (missing_documents populated)
- Both-connections mobile-only flow
"""
import io
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or \
    open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].splitlines()[0].strip()
TOWN = "THS"
HB = {"Content-Type": "application/json", "X-Town-Code": TOWN}


@pytest.fixture(scope="module")
def sh():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": "surveyor1", "password": "Survey@2026", "selected_town": TOWN},
                      headers=HB, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return {"X-Town-Code": TOWN, "Authorization": f"Bearer {tok}"}


def _sh_json(sh):
    return {**sh, "Content-Type": "application/json"}


def _mk_property(sh):
    body = {"owner_name": f"TEST_Owner_{uuid.uuid4().hex[:6]}",
            "mobile": "9998887777", "ward": "1", "address": "TEST addr",
            "colony": "TEST_Freetext", "category": "Residential",
            "latitude": 29.9695, "longitude": 76.8783}
    r = requests.post(f"{BASE_URL}/api/phed/field-properties", json=body,
                      headers=_sh_json(sh), timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    return j["id"]


def _draft(sh, prop_id, survey_type, water):
    body = {"property_record_id": prop_id, "survey_type": survey_type,
            "latitude": 29.9695, "longitude": 76.8783, "water": water}
    r = requests.post(f"{BASE_URL}/api/phed/surveys/draft", json=body,
                      headers=_sh_json(sh), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _upload(sh, survey_id, att_type, filename="reg.jpg", ctype="image/jpeg"):
    # minimal valid JPEG bytes (SOI + EOI is not enough for imghdr;
    # backend accepts by content_type header and file size)
    payload = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\x00" * 128 + b"\xff\xd9"
    files = {"file": (filename, io.BytesIO(payload), ctype)}
    data = {"attachment_type": att_type}
    r = requests.post(f"{BASE_URL}/api/phed/surveys/{survey_id}/attachments",
                      files=files, data=data, headers=sh, timeout=30)
    return r


def _submit(sh, survey_id):
    return requests.post(f"{BASE_URL}/api/phed/surveys/{survey_id}/submit",
                         headers=sh, timeout=30)


def _get_property(sh, prop_id):
    r = requests.get(f"{BASE_URL}/api/phed/property/{prop_id}", headers=sh, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- 1. Property Proof / Registry upload persistence (bug #19) ----------
def test_property_proof_upload_persists_and_downloadable(sh):
    prop_id = _mk_property(sh)
    water = {"has_connection": False, "new_connection": True,
             "new_owner_name": "TEST_NC", "new_locality": "TEST_Loc",
             "requested_service": "Both", "connection_category": "Domestic",
             "mobile": "9998887777"}
    d = _draft(sh, prop_id, "NO_CONNECTION", water)
    sid = d.get("id") or d.get("survey_id")

    # Upload registry (PROPERTY_PROOF) + Aadhaar front/back + Application + House photo
    for t in ["PROPERTY_PROOF", "AADHAAR_FRONT", "AADHAAR_BACK", "APPLICATION", "HOUSE_PHOTO"]:
        r = _upload(sh, sid, t)
        assert r.status_code == 200, f"{t}: {r.status_code} {r.text}"

    # Verify via GET /property/{id} that attachments include PROPERTY_PROOF etc.
    prop = _get_property(sh, prop_id)
    atts = (prop.get("survey") or {}).get("attachments", [])
    types = [a["attachment_type"] for a in atts]
    assert "PROPERTY_PROOF" in types, f"PROPERTY_PROOF missing after upload: {types}"
    assert "AADHAAR_FRONT" in types
    assert "AADHAAR_BACK" in types

    # Download the PROPERTY_PROOF attachment
    proof = next(a for a in atts if a["attachment_type"] == "PROPERTY_PROOF")
    r = requests.get(f"{BASE_URL}/api/phed/surveys/{sid}/attachments/{proof['id']}",
                     headers=sh, timeout=30)
    assert r.status_code == 200, r.text
    assert len(r.content) > 10

    # Submit and reopen -> attachments should persist
    sub = _submit(sh, sid)
    assert sub.status_code == 200, sub.text
    prop2 = _get_property(sh, prop_id)
    atts2 = (prop2.get("survey") or {}).get("attachments", [])
    types2 = {a["attachment_type"] for a in atts2}
    assert "PROPERTY_PROOF" in types2, f"PROPERTY_PROOF lost after submit: {types2}"


# ---------- 2. New Connection extra fields persist ----------
def test_new_connection_fields_persist(sh):
    prop_id = _mk_property(sh)
    water = {"has_connection": False, "new_connection": True,
             "new_owner_name": "TEST_NC_Owner", "new_ward": "5",
             "new_locality": "TEST_Sector_5", "new_address": "H.No 12",
             "requested_service": "Sewer", "connection_category": "Commercial",
             "mobile": "9998887777"}
    d = _draft(sh, prop_id, "NO_CONNECTION", water)
    sid = d.get("id") or d.get("survey_id")
    for t in ["APPLICATION", "AADHAAR_FRONT", "AADHAAR_BACK", "PROPERTY_PROOF", "HOUSE_PHOTO"]:
        r = _upload(sh, sid, t)
        assert r.status_code == 200, r.text
    sub = _submit(sh, sid)
    assert sub.status_code == 200, sub.text

    prop = _get_property(sh, prop_id)
    w = (prop.get("survey") or {}).get("water") or {}
    assert w.get("requested_service") == "Sewer", w
    assert w.get("connection_category") == "Commercial", w
    assert w.get("new_locality") == "TEST_Sector_5", w


# ---------- 3. Owner denied: no docs required, submit ok ----------
def test_owner_denied_no_docs_required(sh):
    prop_id = _mk_property(sh)
    water = {"has_connection": False, "owner_denied": True,
             "denial_reason": "TENANT", "mobile": "9998887777"}
    d = _draft(sh, prop_id, "WATER_CONNECTION", water)
    sid = d.get("id") or d.get("survey_id")
    sub = _submit(sh, sid)
    assert sub.status_code == 200, sub.text
    prop = _get_property(sh, prop_id)
    w = (prop.get("survey") or {}).get("water") or {}
    assert w.get("owner_denied") is True


# ---------- 4. Document Pending flow ----------
def test_document_pending_flow(sh):
    prop_id = _mk_property(sh)
    water = {"has_connection": False, "new_connection": True,
             "new_owner_name": "TEST_DP", "new_locality": "TEST_DP_Loc",
             "requested_service": "Water", "connection_category": "Domestic",
             "mobile": "9998887777",
             "document_pending": True,
             "missing_documents": ["PROPERTY_PROOF", "HOUSE_PHOTO"]}
    d = _draft(sh, prop_id, "NO_CONNECTION", water)
    sid = d.get("id") or d.get("survey_id")
    # Upload only APPLICATION + Aadhaar; skip PROPERTY_PROOF/HOUSE_PHOTO
    for t in ["APPLICATION", "AADHAAR_FRONT", "AADHAAR_BACK"]:
        r = _upload(sh, sid, t)
        assert r.status_code == 200, r.text
    sub = _submit(sh, sid)
    assert sub.status_code == 200, sub.text
    prop = _get_property(sh, prop_id)
    s = prop.get("survey") or {}
    w = s.get("water") or {}
    assert w.get("missing_documents"), w
    # Status should be either "Document Pending" or "Submitted" (backend decides)
    print(f"[doc-pending] status={s.get('status')} missing={w.get('missing_documents')}")


# ---------- 5. Verify ATTACHMENT_TYPES list on server ----------
def test_attachment_types_supported(sh):
    prop_id = _mk_property(sh)
    d = _draft(sh, prop_id, "WATER_CONNECTION",
               {"has_connection": True, "mobile": "9998887777"})
    sid = d.get("id") or d.get("survey_id")
    for t in ["PROPERTY_PROOF", "AADHAAR_FRONT", "AADHAAR_BACK", "APPLICATION",
              "HOUSE_PHOTO", "DEATH_CERTIFICATE"]:
        r = _upload(sh, sid, t)
        assert r.status_code == 200, f"upload {t} failed: {r.status_code} {r.text}"
