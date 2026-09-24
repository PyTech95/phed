"""
Iteration 9 — Water Bill Survey bugs:
  (a) GPS fallback: submit must NOT be blocked when browser GPS is unavailable.
      Frontend falls back to property.latitude/longitude; verify the draft->submit
      succeeds with the property's own coords and the persisted survey stores them.
  (b) Multi-page PROPERTY_PROOF: two pages both persist as separate attachments.
  (c) Admin can read the PROPERTY_PROOF attachment (view-attachment flow).
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

PROP_LAT, PROP_LNG = 29.9691234, 76.8789876  # distinct from previous tests


# ---- fixtures ---------------------------------------------------------------
@pytest.fixture(scope="module")
def sh():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": "surveyor1", "password": "Survey@2026", "selected_town": TOWN},
                      headers=HB, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    return {"X-Town-Code": TOWN, "Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def ah():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": os.environ.get("TEST_ADMIN_USERNAME", "admin"), "password": os.environ.get("TEST_ADMIN_PASSWORD", "PhedAdmin@2026"), "selected_town": TOWN},
                      headers=HB, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    return {"X-Town-Code": TOWN, "Authorization": f"Bearer {tok}"}


def _sh_json(h):
    return {**h, "Content-Type": "application/json"}


def _mk_property(sh, with_loc=True):
    body = {"owner_name": f"TEST_GPS_{uuid.uuid4().hex[:6]}",
            "mobile": "9998887777", "ward": "1", "address": "TEST_addr",
            "colony": "TEST_Freetext", "category": "Residential"}
    if with_loc:
        body["latitude"] = PROP_LAT
        body["longitude"] = PROP_LNG
    r = requests.post(f"{BASE_URL}/api/phed/field-properties", json=body,
                      headers=_sh_json(sh), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _upload_img(sh, survey_id, att_type, name="reg.jpg"):
    payload = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\x00" * 200 + b"\xff\xd9"
    files = {"file": (name, io.BytesIO(payload), "image/jpeg")}
    data = {"attachment_type": att_type}
    return requests.post(f"{BASE_URL}/api/phed/surveys/{survey_id}/attachments",
                         files=files, data=data, headers=sh, timeout=30)


# ---- 1. GPS FALLBACK (property coords) -------------------------------------
def test_submit_succeeds_with_property_fallback_coords(sh):
    """Simulates frontend GPS-denied path: submit uses property.lat/long."""
    prop = _mk_property(sh, with_loc=True)
    body = {"property_record_id": prop["id"], "survey_type": "WATER_CONNECTION",
            # These are the property's coords -- effGps fallback
            "latitude": PROP_LAT, "longitude": PROP_LNG,
            "gps_accuracy": None, "surveyor_latitude": PROP_LAT, "surveyor_longitude": PROP_LNG,
            "water": {"has_connection": False, "owner_denied": True,
                      "denial_reason": "TENANT", "mobile": "9998887777"}}
    r = requests.post(f"{BASE_URL}/api/phed/surveys/draft", json=body,
                      headers=_sh_json(sh), timeout=30)
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    sub = requests.post(f"{BASE_URL}/api/phed/surveys/{sid}/submit",
                        headers=sh, timeout=30)
    assert sub.status_code == 200, f"Submit blocked with fallback coords: {sub.status_code} {sub.text}"
    # Verify persisted lat/long match the fallback
    got = requests.get(f"{BASE_URL}/api/phed/property/{prop['id']}", headers=sh, timeout=30).json()
    s = got.get("survey") or {}
    assert abs((s.get("latitude") or 0) - PROP_LAT) < 1e-6, s
    assert abs((s.get("longitude") or 0) - PROP_LNG) < 1e-6, s


def test_submit_rejects_when_no_gps_and_no_property_loc(sh):
    """Server guard is still 400 when lat/long are absent (frontend fallback also missing)."""
    prop = _mk_property(sh, with_loc=True)  # need field prop; but omit coords in draft
    body = {"property_record_id": prop["id"], "survey_type": "WATER_CONNECTION",
            # Deliberately omit lat/long -> draft accepted, submit must 400
            "water": {"has_connection": False, "owner_denied": True,
                      "denial_reason": "SELF", "mobile": "9998887777"}}
    r = requests.post(f"{BASE_URL}/api/phed/surveys/draft", json=body,
                      headers=_sh_json(sh), timeout=30)
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    sub = requests.post(f"{BASE_URL}/api/phed/surveys/{sid}/submit",
                        headers=sh, timeout=30)
    assert sub.status_code == 400, f"Expected 400 when GPS missing, got {sub.status_code}: {sub.text}"
    assert "GPS" in sub.text or "location" in sub.text.lower()


# ---- 2. MULTI-PAGE PROPERTY_PROOF ------------------------------------------
def test_multi_page_property_proof_persists(sh):
    prop = _mk_property(sh, with_loc=True)
    body = {"property_record_id": prop["id"], "survey_type": "NO_CONNECTION",
            "latitude": PROP_LAT, "longitude": PROP_LNG,
            "water": {"has_connection": False, "new_connection": True,
                      "new_owner_name": "TEST_MP", "new_locality": "TEST_MP_Loc",
                      "requested_service": "Water", "connection_category": "Domestic",
                      "mobile": "9998887777"}}
    r = requests.post(f"{BASE_URL}/api/phed/surveys/draft", json=body,
                      headers=_sh_json(sh), timeout=30)
    assert r.status_code == 200, r.text
    sid = r.json()["id"]

    # Upload TWO PROPERTY_PROOF pages
    r1 = _upload_img(sh, sid, "PROPERTY_PROOF", name="reg_p1.jpg")
    r2 = _upload_img(sh, sid, "PROPERTY_PROOF", name="reg_p2.jpg")
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    # Required companions so submit is Document-Pending free (not asserted)
    for t in ["APPLICATION", "AADHAAR_FRONT", "AADHAAR_BACK", "HOUSE_PHOTO"]:
        _upload_img(sh, sid, t)

    sub = requests.post(f"{BASE_URL}/api/phed/surveys/{sid}/submit", headers=sh, timeout=30)
    assert sub.status_code == 200, sub.text

    got = requests.get(f"{BASE_URL}/api/phed/property/{prop['id']}", headers=sh, timeout=30).json()
    atts = (got.get("survey") or {}).get("attachments") or []
    proofs = [a for a in atts if a["attachment_type"] == "PROPERTY_PROOF"]
    assert len(proofs) == 2, f"expected 2 PROPERTY_PROOF pages, got {len(proofs)}: {[a['filename'] for a in atts]}"

    # Both pages must be downloadable
    for a in proofs:
        r = requests.get(f"{BASE_URL}/api/phed/surveys/{sid}/attachments/{a['id']}",
                         headers=sh, timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("image/"), r.headers
        assert len(r.content) > 10


# ---- 3. ADMIN can view PROPERTY_PROOF attachment ----------------------------
def test_admin_can_view_property_proof(sh, ah):
    prop = _mk_property(sh, with_loc=True)
    body = {"property_record_id": prop["id"], "survey_type": "NO_CONNECTION",
            "latitude": PROP_LAT, "longitude": PROP_LNG,
            "water": {"has_connection": False, "new_connection": True,
                      "new_owner_name": "TEST_ADM", "new_locality": "TEST_ADM_Loc",
                      "requested_service": "Both", "connection_category": "Domestic",
                      "mobile": "9998887777"}}
    r = requests.post(f"{BASE_URL}/api/phed/surveys/draft", json=body,
                      headers=_sh_json(sh), timeout=30)
    sid = r.json()["id"]
    for t in ["PROPERTY_PROOF", "APPLICATION", "AADHAAR_FRONT", "AADHAAR_BACK", "HOUSE_PHOTO"]:
        assert _upload_img(sh, sid, t).status_code == 200
    sub = requests.post(f"{BASE_URL}/api/phed/surveys/{sid}/submit", headers=sh, timeout=30)
    assert sub.status_code == 200, sub.text

    # Admin fetches the same survey attachments and downloads PROPERTY_PROOF
    got = requests.get(f"{BASE_URL}/api/phed/property/{prop['id']}", headers=ah, timeout=30)
    assert got.status_code == 200, got.text
    atts = (got.json().get("survey") or {}).get("attachments") or []
    proof = next((a for a in atts if a["attachment_type"] == "PROPERTY_PROOF"), None)
    assert proof, f"admin cannot see PROPERTY_PROOF: {[a['attachment_type'] for a in atts]}"
    r = requests.get(f"{BASE_URL}/api/phed/surveys/{sid}/attachments/{proof['id']}",
                     headers=ah, timeout=30)
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("image/")
