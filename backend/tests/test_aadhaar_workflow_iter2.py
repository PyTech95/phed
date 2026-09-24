"""Backend regression for PHED Aadhaar front/back attachment workflow."""

import io
import os
import re
import uuid

import fitz
import pytest
import requests
from PIL import Image


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
    s = requests.Session()
    s.headers.update({"X-Town-Code": TOWN})
    return s


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


@pytest.fixture(scope="session")
def surveyor_auth(http):
    payload = {
        "username": _read_cred("Synthetic Surveyor (created for Aadhaar crop/upload testing, 2026-09-19)", "Username"),
        "password": _read_cred("Synthetic Surveyor (created for Aadhaar crop/upload testing, 2026-09-19)", "Password"),
        "selected_town": TOWN,
    }
    r = http.post(f"{BASE_URL}/api/auth/login", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    token = r.json().get("token")
    assert token
    return {"Authorization": f"Bearer {token}", "X-Town-Code": TOWN}


def _jpeg(width=2200, height=1400, color=(180, 210, 240)):
    img = Image.new("RGB", (width, height), color=color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def _create_property(http, auth):
    payload = {
        "owner_name": f"TEST_AADHAAR_{uuid.uuid4().hex[:6]}",
        "mobile": "9998887777",
        "ward": "1",
        "address": "Test Aadhaar Street",
        "colony": "TEST_COLONY",
        "category": "Residential",
        "latitude": 29.9695,
        "longitude": 76.8783,
    }
    r = http.post(f"{BASE_URL}/api/phed/field-properties", json=payload, headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _create_draft(http, auth, property_id):
    water = {
        "has_connection": False,
        "new_connection": True,
        "new_owner_name": "TEST Owner",
        "new_locality": "TEST Locality",
        "requested_service": "Both",
        "connection_category": "Domestic",
        "mobile": "9998887777",
    }
    payload = {
        "property_record_id": property_id,
        "survey_type": "NO_CONNECTION",
        "latitude": 29.9695,
        "longitude": 76.8783,
        "water": water,
    }
    r = http.post(f"{BASE_URL}/api/phed/surveys/draft", json=payload, headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _upload(http, auth, survey_id, attachment_type, content, content_type="image/jpeg", name="file.jpg"):
    files = {"file": (name, io.BytesIO(content), content_type)}
    data = {"attachment_type": attachment_type}
    return http.post(f"{BASE_URL}/api/phed/surveys/{survey_id}/attachments", headers=auth, files=files, data=data, timeout=60)


def test_health_ok(http):
    r = http.get(f"{BASE_URL}/api/health", timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"


def test_submit_with_aadhaar_front_back_and_documents_pdf(http, surveyor_auth, admin_auth):
    property_id = _create_property(http, surveyor_auth)
    survey_id = _create_draft(http, surveyor_auth, property_id)

    for att in ["APPLICATION", "PROPERTY_PROOF", "HOUSE_PHOTO", "AADHAAR_FRONT", "AADHAAR_BACK"]:
        r = _upload(http, surveyor_auth, survey_id, att, _jpeg())
        assert r.status_code == 200, f"{att} upload failed: {r.status_code} {r.text}"

    submit = http.post(f"{BASE_URL}/api/phed/surveys/{survey_id}/submit", headers=surveyor_auth, timeout=30)
    assert submit.status_code == 200, submit.text

    prop = http.get(f"{BASE_URL}/api/phed/property/{property_id}", headers=surveyor_auth, timeout=30)
    assert prop.status_code == 200, prop.text
    survey = prop.json().get("survey") or {}
    atts = survey.get("attachments") or []
    types = [a.get("attachment_type") for a in atts]
    assert "AADHAAR_FRONT" in types
    assert "AADHAAR_BACK" in types

    front = next(a for a in atts if a.get("attachment_type") == "AADHAAR_FRONT")
    back = next(a for a in atts if a.get("attachment_type") == "AADHAAR_BACK")

    front_dl = http.get(f"{BASE_URL}/api/phed/surveys/{survey_id}/attachments/{front['id']}", headers=surveyor_auth, timeout=30)
    assert front_dl.status_code == 200
    assert front_dl.headers.get("content-type", "").startswith("image/")

    back_dl_admin = http.get(f"{BASE_URL}/api/phed/surveys/{survey_id}/attachments/{back['id']}", headers=admin_auth, timeout=30)
    assert back_dl_admin.status_code == 200
    assert back_dl_admin.headers.get("content-type", "").startswith("image/")

    no_auth = http.get(f"{BASE_URL}/api/phed/surveys/{survey_id}/attachments/{back['id']}", timeout=30)
    assert no_auth.status_code in (401, 403)

    pdf = http.get(f"{BASE_URL}/api/phed/surveys/{survey_id}/documents.pdf", headers=surveyor_auth, timeout=60)
    assert pdf.status_code == 200, pdf.text
    assert pdf.headers.get("content-type", "").startswith("application/pdf")
    doc = fitz.open(stream=pdf.content, filetype="pdf")
    assert doc.page_count >= 1


def test_invalid_and_oversized_attachment_rejected_without_losing_existing(http, surveyor_auth):
    property_id = _create_property(http, surveyor_auth)
    survey_id = _create_draft(http, surveyor_auth, property_id)

    ok = _upload(http, surveyor_auth, survey_id, "AADHAAR_FRONT", _jpeg(), "image/jpeg", "front.jpg")
    assert ok.status_code == 200, ok.text

    bad = _upload(http, surveyor_auth, survey_id, "AADHAAR_BACK", b"not-an-image", "text/plain", "bad.txt")
    assert bad.status_code == 400

    huge = _upload(http, surveyor_auth, survey_id, "AADHAAR_BACK", b"x" * (21 * 1024 * 1024), "image/jpeg", "huge.jpg")
    assert huge.status_code == 413

    prop = http.get(f"{BASE_URL}/api/phed/property/{property_id}", headers=surveyor_auth, timeout=30)
    assert prop.status_code == 200
    types = [a.get("attachment_type") for a in (prop.json().get("survey") or {}).get("attachments", [])]
    assert "AADHAAR_FRONT" in types
