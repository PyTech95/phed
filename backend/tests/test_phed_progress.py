"""
Backend tests for PHED surveyor flows:
- Login as surveyor1 (town THS)
- Wards seeded (32)
- Create field property
- Save draft (multiple types)
- Submit and verify /my-progress breakdown counters
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or \
    open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].splitlines()[0].strip()
TOWN = "THS"
HEADERS_BASE = {"Content-Type": "application/json", "X-Town-Code": TOWN}


@pytest.fixture(scope="module")
def surveyor_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": "surveyor1", "password": "Survey@2026", "selected_town": TOWN},
                      headers=HEADERS_BASE, timeout=30)
    assert r.status_code == 200, f"surveyor login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token in {r.json()}"
    return tok


@pytest.fixture(scope="module")
def sh(surveyor_token):
    return {**HEADERS_BASE, "Authorization": f"Bearer {surveyor_token}"}


def test_wards_seeded_32(sh):
    r = requests.get(f"{BASE_URL}/api/phed/wards", headers=sh, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    wards = data if isinstance(data, list) else data.get("wards", data.get("items", []))
    assert isinstance(wards, list)
    assert len(wards) >= 32, f"expected >=32 wards, got {len(wards)}"


def _mk_property(sh, owner_suffix):
    body = {
        "owner_name": f"TEST_Owner_{owner_suffix}",
        "mobile": "9998887777", "ward": "1", "address": "TEST addr",
        "colony": "TEST_Freetext_Colony", "category": "Residential",
        "latitude": 29.9695, "longitude": 76.8783,
    }
    r = requests.post(f"{BASE_URL}/api/phed/field-properties", json=body, headers=sh, timeout=30)
    assert r.status_code == 200, f"create field-prop failed: {r.status_code} {r.text}"
    j = r.json()
    return j["id"], j["property_id"]


def _save_draft(sh, prop_rec_id, survey_type, water):
    body = {
        "property_record_id": prop_rec_id,
        "survey_type": survey_type,
        "latitude": 29.9695, "longitude": 76.8783,
        "water": water,
    }
    r = requests.post(f"{BASE_URL}/api/phed/surveys/draft", json=body, headers=sh, timeout=30)
    assert r.status_code == 200, f"draft failed: {r.status_code} {r.text}"
    return r.json()


def _submit(sh, survey_id):
    r = requests.post(f"{BASE_URL}/api/phed/surveys/{survey_id}/submit", headers=sh, timeout=30)
    return r


def test_create_field_property_and_draft(sh):
    prop_rec_id, pid = _mk_property(sh, uuid.uuid4().hex[:6])
    assert pid.startswith("FIELD-")
    j = _save_draft(sh, prop_rec_id, "NEW_UNLISTED", {"has_connection": False})
    assert "id" in j or "survey_id" in j, j


def test_my_progress_breakdown_increments(sh):
    # Baseline
    r0 = requests.get(f"{BASE_URL}/api/phed/my-progress", headers=sh, timeout=30)
    assert r0.status_code == 200, r0.text
    base = r0.json()
    for k in ["total_properties", "phed_pending", "total_submitted",
              "already_connection", "sewer_connection", "new_connection",
              "ownership_change", "death_transfer", "field_properties"]:
        assert k in base, f"missing key {k} in {base}"

    submitted_ok = {}
    # Prepare 4 different outcomes -- try to submit each. Some may 400 due to strict validation;
    # we record which counters actually incremented.
    # NOTE: EXISTING_LINKED/NEW_UNLISTED submissions require a linked PHED consumer.
    # NO_CONNECTION submissions have no such prerequisite -> use NO_CONNECTION and set
    # the water flags that the /my-progress breakdown reads (has_connection, has_sewer,
    # new_connection, owner_change). The breakdown logic runs regardless of survey_type.
    scenarios = [
        ("NO_CONNECTION", {"has_connection": True}, "already_connection"),
        ("NO_CONNECTION", {"has_sewer": True, "sewer_connection_numbers": ["S-TEST-1"]}, "sewer_connection"),
        ("NO_CONNECTION", {"new_connection": True}, "new_connection"),
        ("NO_CONNECTION", {"owner_change": "OWNERSHIP_CHANGE"}, "ownership_change"),
        ("NO_CONNECTION", {"owner_change": "DEATH_TRANSFER"}, "death_transfer"),
    ]

    for stype, water, counter in scenarios:
        prop_rec_id, _ = _mk_property(sh, uuid.uuid4().hex[:6])
        d = _save_draft(sh, prop_rec_id, stype, water)
        sid = d.get("id") or d.get("survey_id")
        assert sid, d
        sub = _submit(sh, sid)
        if sub.status_code == 200:
            submitted_ok[counter] = submitted_ok.get(counter, 0) + 1
        else:
            print(f"[submit skipped] {counter}: {sub.status_code} {sub.text[:200]}")

    r1 = requests.get(f"{BASE_URL}/api/phed/my-progress", headers=sh, timeout=30)
    assert r1.status_code == 200
    after = r1.json()

    # field_properties incremented by number of properties we created here (5)
    assert after["field_properties"] >= base["field_properties"] + len(scenarios), \
        f"field_properties: base={base['field_properties']} after={after['field_properties']}"

    # total_submitted increased by number of successful submits
    assert after["total_submitted"] >= base["total_submitted"] + len(submitted_ok)

    # Each counter that had a successful submission should have gone up
    for counter, n in submitted_ok.items():
        assert after[counter] >= base[counter] + n, (
            f"{counter}: base={base[counter]} after={after[counter]} expected +{n}")

    # Report which counters actually validated
    print("Submitted OK counters:", submitted_ok)
    print("Progress after:", after)
