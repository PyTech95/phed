"""Iter6 backend coverage for PHED standard import safety and deletion protections."""

import io
import os
import re
import time
import uuid
from typing import Dict, List, Tuple

import pytest
import requests
from openpyxl import Workbook
from pymongo import MongoClient


# Module: credentials + HTTP helpers for PHED flows
def _read_test_credentials(path: str = "/app/memory/test_credentials.md") -> Dict[str, str]:
    data = {
        "app_url": "",
        "admin_username": "",
        "admin_password": "",
        "surveyor_a_username": "",
        "surveyor_a_password": "",
        "surveyor_b_username": "",
        "surveyor_b_password": "",
    }
    section = None
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if line.startswith("- Preview:"):
                data["app_url"] = line.split(":", 1)[1].strip()
            elif line.startswith("## Admin"):
                section = "admin"
            elif line.startswith("## Test Surveyor A"):
                section = "a"
            elif line.startswith("## Test Surveyor B"):
                section = "b"
            elif line.startswith("## "):
                section = None
            elif line.startswith("- Username:") and section:
                key = {
                    "admin": "admin_username",
                    "a": "surveyor_a_username",
                    "b": "surveyor_b_username",
                }[section]
                data[key] = line.split(":", 1)[1].strip().strip("`")
            elif line.startswith("- Password:") and section:
                key = {
                    "admin": "admin_password",
                    "a": "surveyor_a_password",
                    "b": "surveyor_b_password",
                }[section]
                data[key] = line.split(":", 1)[1].strip().strip("`")
    return data


CREDS = _read_test_credentials()
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or CREDS["app_url"]).rstrip("/")
assert BASE_URL, "Missing BASE_URL from env/test credentials"
assert CREDS["admin_username"] and CREDS["admin_password"], "Missing admin credentials"
TOWN_CODE = "THS"
TEST_TAG = f"TEST_ITER6_{uuid.uuid4().hex[:8].upper()}"


def _login(username: str, password: str) -> requests.Session:
    session = requests.Session()
    resp = session.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": username, "password": password, "selected_town": TOWN_CODE},
        headers={"X-Town-Code": TOWN_CODE},
        timeout=30,
    )
    assert resp.status_code == 200, f"login failed for {username}: {resp.status_code} {resp.text}"
    token = resp.json().get("token") or resp.json().get("access_token")
    assert token, "missing token"
    session.headers.update({"Authorization": f"Bearer {token}", "X-Town-Code": TOWN_CODE})
    return session


def _xlsx_bytes(rows: List[List[str]]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append([
        "Consumer Name",
        "F/H Name",
        "Head of Family in PPP",
        "Address",
        "Locality",
        "Phone No.",
        "Consumer ID",
        "Property ID",
        "Water Connection No.",
        "Sewer Connection No.",
        "Type of Connection",
    ])
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _wait_import_status(admin: requests.Session, import_id: str, wanted=("Completed", "Validated Only"), timeout_s=90):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        r = admin.get(f"{BASE_URL}/api/phed/import/{import_id}", timeout=30)
        assert r.status_code == 200, r.text
        status = r.json().get("status")
        if status in wanted:
            return r.json()
        if status in ("Failed", "Delete Failed"):
            pytest.fail(f"import failed with status={status}: {r.text}")
        time.sleep(1.0)
    pytest.fail(f"timed out waiting for import {import_id} completion")


def _validate_import(admin: requests.Session, ward_id: str, mode: str, filename: str, rows: List[List[str]]):
    files = {
        "file": (
            filename,
            _xlsx_bytes(rows),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    }
    data = {"ward_id": ward_id, "default_colony": f"{TEST_TAG}_COLONY", "mode": mode}
    r = admin.post(f"{BASE_URL}/api/phed/import/validate", data=data, files=files, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()


def _commit_import(admin: requests.Session, import_id: str):
    r = admin.post(f"{BASE_URL}/api/phed/import/{import_id}/commit", timeout=30)
    assert r.status_code == 200, r.text
    return _wait_import_status(admin, import_id)


def _find_consumer_by_cid(admin: requests.Session, cid: str) -> Dict:
    r = admin.get(f"{BASE_URL}/api/phed/consumers/search", params={"q": cid, "limit": 25}, timeout=30)
    assert r.status_code == 200, r.text
    cid_norm = re.sub(r"[\s\-/]+", "", cid).upper()
    for item in r.json().get("results", []):
        if re.sub(r"[\s\-/]+", "", item.get("consumer_id", "")).upper() == cid_norm:
            return item
    return {}


# Module: fixture setup + cleanup with isolated IDs only
@pytest.fixture(scope="module")
def sessions_and_state():
    admin = _login(CREDS["admin_username"], CREDS["admin_password"])
    surveyor_a = _login(CREDS["surveyor_a_username"], CREDS["surveyor_a_password"])

    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    mongo = MongoClient(mongo_url) if mongo_url and db_name else None
    db = mongo[db_name] if mongo and db_name else None

    state = {
        "ward_ids": [],
        "property_ids": [],
        "consumer_ids": [],
        "connection_ids": [],
        "survey_ids": [],
        "import_ids": [],
    }

    yield {"admin": admin, "surveyor_a": surveyor_a, "db": db, "state": state}

    if db is None:
        return

    for sid in state["survey_ids"]:
        db.phed_surveys.delete_one({"id": sid})
    for cid in state["connection_ids"]:
        db.phed_connections.delete_one({"id": cid})
    for cid in state["consumer_ids"]:
        db.phed_consumers.delete_one({"id": cid})
    for pid in state["property_ids"]:
        db.properties.delete_one({"id": pid})
    for wid in state["ward_ids"]:
        db.phed_wards.delete_one({"id": wid})
    for batch_id in state["import_ids"]:
        db.phed_import_changes.delete_many({"batch_id": batch_id})
        db.phed_import_staging.delete_many({"import_id": batch_id})
        db.phed_imports.delete_one({"id": batch_id})
        db.phed_office_imports.delete_one({"id": batch_id})
        db.phed_connections.delete_many({"import_id": batch_id})
        db.phed_consumers.delete_many({"import_id": batch_id})
        db.phed_surveys.delete_many({"office_batch_id": batch_id})


def _create_ward(admin: requests.Session, state: dict) -> Dict:
    payload = {"ward_number": f"{900 + int(uuid.uuid4().hex[:2], 16)}", "name": f"{TEST_TAG}_WARD", "is_active": True, "colonies": [f"{TEST_TAG}_COLONY"]}
    r = admin.post(f"{BASE_URL}/api/phed/wards", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    ward = r.json()
    state["ward_ids"].append(ward["id"])
    return ward


def _create_property(surveyor: requests.Session, state: dict, suffix: str) -> Dict:
    payload = {
        "owner_name": f"{TEST_TAG}_OWNER_{suffix}",
        "mobile": "9898989801",
        "ward": "27",
        "address": f"{TEST_TAG}_ADDR_{suffix}",
        "colony": f"{TEST_TAG}_COLONY",
        "category": "Residential",
        "latitude": 29.9695,
        "longitude": 76.8783,
    }
    r = surveyor.post(f"{BASE_URL}/api/phed/field-properties", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    prop = body.get("property") or body
    if "id" not in prop:
        prop["id"] = body.get("id")
    if "property_id" not in prop:
        prop["property_id"] = body.get("property_id")
    state["property_ids"].append(prop["id"])
    return prop


def _create_consumer(admin: requests.Session, state: dict, cid: str, name: str) -> Dict:
    body = {
        "consumer_name": name,
        "fh_name": "TEST FH",
        "address": f"{TEST_TAG} ADDR",
        "locality": f"{TEST_TAG}_COLONY",
        "phone": "9876501234",
        "consumer_id": cid,
        "category": "Domestic",
    }
    r = admin.post(f"{BASE_URL}/api/phed/consumers", json=body, timeout=30)
    assert r.status_code == 200, r.text
    c = r.json()
    state["consumer_ids"].append(c["id"])
    return c


def _add_connection(admin: requests.Session, state: dict, consumer_ref: str, service: str, number: str) -> Dict:
    r = admin.post(
        f"{BASE_URL}/api/phed/consumers/{consumer_ref}/connections",
        json={"service": service, "connection_number": number, "category": "Domestic"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    conn = r.json()
    state["connection_ids"].append(conn["id"])
    return conn


# Module: standard import + commit + reversible deletion tests
def test_standard_import_new_only_uses_consumer_id_only(sessions_and_state):
    admin = sessions_and_state["admin"]
    surveyor_a = sessions_and_state["surveyor_a"]
    state = sessions_and_state["state"]

    ward = _create_ward(admin, state)
    prop = _create_property(surveyor_a, state, "NEWONLY")

    existing_cid = f"{TEST_TAG}_EXIST"
    existing = _create_consumer(admin, state, existing_cid, "TEST_ITER6_EXISTING_NAME")
    _add_connection(admin, state, existing["id"], "Water", f"{TEST_TAG[-4:]}W1")

    before = admin.get(f"{BASE_URL}/api/phed/consumers/{existing['id']}", timeout=30).json()
    before_conn_count = len(before.get("connections", []))

    cid2 = f"{TEST_TAG}_CID2"
    cid3 = f"{TEST_TAG}_CID3"
    rows = [
        ["Same Person", "FH", "", "A1", f"{TEST_TAG}_COLONY", "9000000001", existing_cid, "", f"{TEST_TAG[-4:]}W2", "", "Domestic"],
        ["Same Person", "FH", "", "A2", f"{TEST_TAG}_COLONY", "9000000001", cid2, prop["property_id"], f"{TEST_TAG[-4:]}W3", "", "Domestic"],
        ["Same Person", "FH", "", "A3", f"{TEST_TAG}_COLONY", "9000000001", cid3, "", "", f"{TEST_TAG[-4:]}S3", "Domestic"],
        ["Bad Blank", "FH", "", "A4", f"{TEST_TAG}_COLONY", "9000000002", "-", "", "", "", "Domestic"],
        ["Bad NA", "FH", "", "A5", f"{TEST_TAG}_COLONY", "9000000003", "NA", "", "", "", "Domestic"],
    ]
    filename = f"{TEST_TAG}_NEWONLY.xlsx"
    validated = _validate_import(admin, ward["id"], "new_only", filename, rows)
    state["import_ids"].append(validated["id"])

    assert validated["counts"]["total_rows"] == 5
    assert validated["counts"]["invalid_rows"] >= 2
    assert validated["counts"]["new_consumers"] >= 2

    _commit_import(admin, validated["id"])

    after = admin.get(f"{BASE_URL}/api/phed/consumers/{existing['id']}", timeout=30).json()
    assert after.get("consumer_name") == "TEST_ITER6_EXISTING_NAME"
    assert len(after.get("connections", [])) == before_conn_count

    c2 = _find_consumer_by_cid(admin, cid2)
    c3 = _find_consumer_by_cid(admin, cid3)
    assert c2 and c3 and c2["id"] != c3["id"]
    state["consumer_ids"].extend([c2["id"], c3["id"]])


def test_import_delete_restores_existing_and_removes_new_records(sessions_and_state):
    admin = sessions_and_state["admin"]
    surveyor_a = sessions_and_state["surveyor_a"]
    state = sessions_and_state["state"]

    ward = _create_ward(admin, state)
    prop = _create_property(surveyor_a, state, "ROLLBACK")
    cid_existing = f"{TEST_TAG}_UPD"
    cid_new = f"{TEST_TAG}_NEW"

    existing = _create_consumer(admin, state, cid_existing, "TEST_ITER6_BEFORE")
    _add_connection(admin, state, existing["id"], "Water", f"{TEST_TAG[-4:]}W9")
    before = admin.get(f"{BASE_URL}/api/phed/consumers/{existing['id']}", timeout=30).json()

    rows = [
        ["TEST_ITER6_AFTER", "FH", "", "Upd Addr", f"{TEST_TAG}_COLONY", "9111111111", cid_existing, prop["property_id"], f"{TEST_TAG[-4:]}W9", f"{TEST_TAG[-4:]}S9", "Domestic"],
        ["TEST_ITER6_NEW", "FH", "", "New Addr", f"{TEST_TAG}_COLONY", "9222222222", cid_new, "", f"{TEST_TAG[-4:]}W10", "", "Domestic"],
    ]
    filename = f"{TEST_TAG}_ROLLBACK.xlsx"
    validated = _validate_import(admin, ward["id"], "import_and_update", filename, rows)
    state["import_ids"].append(validated["id"])

    _commit_import(admin, validated["id"])

    changed = admin.get(f"{BASE_URL}/api/phed/consumers/{existing['id']}", timeout=30).json()
    assert changed.get("consumer_name") == "TEST_ITER6_AFTER"
    assert any(c.get("service") == "Sewer" for c in changed.get("connections", []))

    new_consumer = _find_consumer_by_cid(admin, cid_new)
    assert new_consumer and new_consumer.get("id")
    state["consumer_ids"].append(new_consumer["id"])

    delete = admin.delete(
        f"{BASE_URL}/api/phed/import-batches/consumer/{validated['id']}",
        json={"confirmation": validated["filename"]},
        timeout=30,
    )
    assert delete.status_code == 200, delete.text

    reverted = admin.get(f"{BASE_URL}/api/phed/consumers/{existing['id']}", timeout=30).json()
    assert reverted.get("consumer_name") == before.get("consumer_name")
    assert reverted.get("phone") == before.get("phone")
    assert len(reverted.get("connections", [])) == len(before.get("connections", []))

    gone = admin.get(f"{BASE_URL}/api/phed/consumers/{new_consumer['id']}", timeout=30)
    assert gone.status_code == 404


def test_deletion_is_blocked_for_used_or_later_updated_import_data(sessions_and_state):
    admin = sessions_and_state["admin"]
    surveyor_a = sessions_and_state["surveyor_a"]
    state = sessions_and_state["state"]

    ward = _create_ward(admin, state)
    prop = _create_property(surveyor_a, state, "BLOCK")
    cid = f"{TEST_TAG}_BLK1"

    base_rows = [[
        "TEST_ITER6_BLOCK_BASE", "FH", "", "Addr1", f"{TEST_TAG}_COLONY", "9333333333",
        cid, prop["property_id"], f"{TEST_TAG[-4:]}WB", "", "Domestic",
    ]]
    base = _validate_import(admin, ward["id"], "import_and_update", f"{TEST_TAG}_BLOCK_BASE.xlsx", base_rows)
    state["import_ids"].append(base["id"])
    _commit_import(admin, base["id"])

    imported_consumer = _find_consumer_by_cid(admin, cid)
    assert imported_consumer and imported_consumer.get("id")
    state["consumer_ids"].append(imported_consumer["id"])

    draft_payload = {
        "property_record_id": prop["id"],
        "survey_type": "WATER_CONNECTION",
        "latitude": prop["latitude"],
        "longitude": prop["longitude"],
        "gps_accuracy": 5,
        "consumer_refs": [imported_consumer["id"]],
        "water": {"has_connection": True, "consumer_ref": imported_consumer["id"], "consumer_id": cid, "consumer_name": "TEST_ITER6_BLOCK_BASE", "mobile": "9333333333"},
    }
    draft = surveyor_a.post(f"{BASE_URL}/api/phed/surveys/draft", json=draft_payload, timeout=30)
    assert draft.status_code == 200, draft.text
    survey_id = draft.json()["id"]
    state["survey_ids"].append(survey_id)
    submit = surveyor_a.post(f"{BASE_URL}/api/phed/surveys/{survey_id}/submit", timeout=30)
    assert submit.status_code == 200, submit.text

    blocked_1 = admin.delete(
        f"{BASE_URL}/api/phed/import-batches/consumer/{base['id']}",
        json={"confirmation": base["filename"]},
        timeout=30,
    )
    assert blocked_1.status_code == 409

    update_rows = [[
        "TEST_ITER6_BLOCK_UPDATED", "FH", "", "Addr2", f"{TEST_TAG}_COLONY", "9444444444",
        cid, prop["property_id"], f"{TEST_TAG[-4:]}WB", f"{TEST_TAG[-4:]}SB", "Domestic",
    ]]
    upd = _validate_import(admin, ward["id"], "import_and_update", f"{TEST_TAG}_BLOCK_UPDATE.xlsx", update_rows)
    state["import_ids"].append(upd["id"])
    _commit_import(admin, upd["id"])

    blocked_2 = admin.delete(
        f"{BASE_URL}/api/phed/import-batches/consumer/{base['id']}",
        json={"confirmation": base["filename"]},
        timeout=30,
    )
    assert blocked_2.status_code == 409

    still_there = admin.get(f"{BASE_URL}/api/phed/consumers/{imported_consumer['id']}", timeout=30)
    assert still_there.status_code == 200
    assert still_there.json().get("consumer_name") == "TEST_ITER6_BLOCK_UPDATED"


# Module: legacy no-snapshot safety test with direct Mongo fixture
def test_legacy_batch_without_snapshot_warns_and_preserves_older_edited_record(sessions_and_state):
    admin = sessions_and_state["admin"]
    state = sessions_and_state["state"]
    db = sessions_and_state["db"]
    if db is None:
        pytest.skip("MONGO_URL/DB_NAME unavailable in test environment")

    batch_id = str(uuid.uuid4())
    consumer_id = str(uuid.uuid4())
    filename = f"{TEST_TAG}_LEGACY.xlsx"
    ts_old = "2026-01-01T00:00:00+00:00"
    ts_new = "2026-02-01T00:00:00+00:00"

    db.phed_imports.insert_one({
        "id": batch_id,
        "filename": filename,
        "ward_id": None,
        "ward_number": "27",
        "status": "Completed",
        "created_at": ts_old,
    })
    db.phed_consumers.insert_one({
        "id": consumer_id,
        "consumer_id": f"{TEST_TAG}_LEG",
        "consumer_id_norm": re.sub(r"[\s\-/]+", "", f"{TEST_TAG}_LEG").upper(),
        "consumer_name": "TEST_ITER6_LEGACY",
        "name_norm": "test iter6 legacy",
        "import_id": batch_id,
        "is_active": True,
        "created_at": ts_old,
        "updated_at": ts_new,
    })

    state["import_ids"].append(batch_id)
    state["consumer_ids"].append(consumer_id)

    preview = admin.get(f"{BASE_URL}/api/phed/import-batches/consumer/{batch_id}/deletion-preview", timeout=30)
    assert preview.status_code == 200, preview.text
    pdata = preview.json()
    assert any("older/edited record has no restore snapshot" in w for w in pdata.get("warnings", []))
    assert any("no restore snapshot" in b for b in pdata.get("blocked", []))

    blocked = admin.delete(
        f"{BASE_URL}/api/phed/import-batches/consumer/{batch_id}",
        json={"confirmation": filename},
        timeout=30,
    )
    assert blocked.status_code == 409

    still = admin.get(f"{BASE_URL}/api/phed/consumers/{consumer_id}", timeout=30)
    assert still.status_code == 200
