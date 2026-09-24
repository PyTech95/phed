"""Seed deterministic PHED UI data for iteration-6 end-to-end browser checks."""

import json
import os
import time
import uuid

import pytest
import requests


def _read_test_credentials(path: str = "/app/memory/test_credentials.md"):
    app_url = ""
    section = None
    out = {}
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if line.startswith("- Preview:"):
                app_url = line.split(":", 1)[1].strip()
            elif line.startswith("## Admin"):
                section = "admin"
            elif line.startswith("## Test Surveyor A"):
                section = "a"
            elif line.startswith("## Test Surveyor B"):
                section = "b"
            elif line.startswith("## "):
                section = None
            elif line.startswith("- Username:") and section:
                out[f"{section}_user"] = line.split(":", 1)[1].strip().strip("`")
            elif line.startswith("- Password:") and section:
                out[f"{section}_pass"] = line.split(":", 1)[1].strip().strip("`")
    out["app_url"] = app_url
    return out


CREDS = _read_test_credentials()
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or CREDS.get("app_url") or "").rstrip("/")
TOWN = "THS"


def _login(username: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": username, "password": password, "selected_town": TOWN},
        headers={"X-Town-Code": TOWN},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    token = r.json().get("token") or r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {token}", "X-Town-Code": TOWN})
    return s


@pytest.mark.skipif(not BASE_URL, reason="Missing BASE_URL")
def test_seed_iter6_ui_data():
    admin = _login(CREDS["admin_user"], CREDS["admin_pass"])
    sa = _login(CREDS["a_user"], CREDS["a_pass"])
    sb = _login(CREDS["b_user"], CREDS["b_pass"])

    tag = f"TEST_ITER6_UI_{int(time.time())}"

    # B-assigned property (target for A citywide survey test)
    p_b_body = {
        "owner_name": f"{tag}_B_OWNER",
        "mobile": "9898989811",
        "ward": "27",
        "address": f"{tag}_ADDR_B",
        "colony": f"{tag}_COLONY",
        "category": "Residential",
        "latitude": 29.9695,
        "longitude": 76.8783,
    }
    rb = sb.post(f"{BASE_URL}/api/phed/field-properties", json=p_b_body, timeout=30)
    assert rb.status_code == 200, rb.text
    bdoc = rb.json().get("property") or rb.json()
    b_property_record_id = bdoc.get("id") or rb.json().get("id")
    b_property_id = bdoc.get("property_id") or rb.json().get("property_id")

    # Unlinked consumer for office-receipt linking flow
    cid = f"{tag}_CID"
    c_body = {
        "consumer_name": f"{tag} CONSUMER",
        "fh_name": "FH",
        "address": f"{tag} ADDR",
        "locality": f"{tag}_COLONY",
        "phone": "9876502299",
        "consumer_id": cid,
        "category": "Domestic",
    }
    rc = admin.post(f"{BASE_URL}/api/phed/consumers", json=c_body, timeout=30)
    assert rc.status_code == 200, rc.text

    # One A-assigned property to verify yellow->green state transition
    ra = sa.get(f"{BASE_URL}/api/employee/properties", params={"limit": 5}, timeout=30)
    assert ra.status_code == 200, ra.text
    props = ra.json().get("properties", [])
    if props:
        a_property_id = props[0]["property_id"]
    else:
        p_a_body = {
            "owner_name": f"{tag}_A_OWNER",
            "mobile": "9898989822",
            "ward": "27",
            "address": f"{tag}_ADDR_A",
            "colony": f"{tag}_COLONY",
            "category": "Residential",
            "latitude": 29.9697,
            "longitude": 76.8785,
        }
        ra2 = sa.post(f"{BASE_URL}/api/phed/field-properties", json=p_a_body, timeout=30)
        assert ra2.status_code == 200, ra2.text
        adoc = ra2.json().get("property") or ra2.json()
        a_property_id = adoc.get("property_id") or ra2.json().get("property_id")

    payload = {
        "tag": tag,
        "b_property_id": b_property_id,
        "b_property_record_id": b_property_record_id,
        "consumer_id": cid,
        "a_property_id": a_property_id,
    }
    with open("/app/test_reports/iter6_ui_seed.json", "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    assert payload["b_property_id"] and payload["b_property_record_id"] and payload["consumer_id"] and payload["a_property_id"]
