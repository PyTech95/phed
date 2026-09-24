"""Iter5 regression: office import safety, import deletion, survey scope, PHED submission queues."""

import io
import os
import uuid
from dataclasses import dataclass

import pytest
import requests
from openpyxl import Workbook
from test_phed_iter6_import_safety_and_flows import CREDS


def _read_test_credentials(path: str = "/app/memory/test_credentials.md"):
    app_url = ""
    admin_user = ""
    admin_pass = ""
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if line.startswith("- Preview:"):
                app_url = line.split(":", 1)[1].strip()
            elif line.startswith("- Username:") and not admin_user:
                admin_user = line.split(":", 1)[1].strip().strip("`")
            elif line.startswith("- Password:") and not admin_pass:
                admin_pass = line.split(":", 1)[1].strip().strip("`")
    return app_url.rstrip("/"), admin_user, admin_pass


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_test_credentials()[0]).rstrip("/")
ADMIN_USER = _read_test_credentials()[1]
ADMIN_PASS = _read_test_credentials()[2]
assert BASE_URL and ADMIN_USER and ADMIN_PASS, "Missing BASE_URL/admin credentials"

TOWN_CODE = "THS"


@dataclass
class Actor:
    username: str
    password: str
    name: str


SURVEYOR_A = Actor(
    username=CREDS["surveyor_a_username"],
    password=CREDS["surveyor_a_password"],
    name="Test Surveyor Iter5 A",
)
SURVEYOR_B = Actor(
    username=CREDS["surveyor_b_username"],
    password=CREDS["surveyor_b_password"],
    name="Test Surveyor Iter5 B",
)


def _login(username: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": username, "password": password, "selected_town": TOWN_CODE},
        headers={"X-Town-Code": TOWN_CODE},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed for {username}: {r.status_code} {r.text}"
    token = r.json().get("token") or r.json().get("access_token")
    assert token
    s.headers.update({"Authorization": f"Bearer {token}", "X-Town-Code": TOWN_CODE})
    return s


@pytest.fixture(scope="session")
def admin_session():
    return _login(ADMIN_USER, ADMIN_PASS)


@pytest.fixture(scope="session")
def test_surveyors(admin_session):
    # Feature: provision two isolated surveyors for cross-user authorization checks.
    users = admin_session.get(f"{BASE_URL}/api/admin/users", timeout=30)
    assert users.status_code == 200, users.text
    existing = {u["username"]: u for u in users.json()}

    for actor in (SURVEYOR_A, SURVEYOR_B):
        if actor.username not in existing:
            payload = {
                "username": actor.username,
                "password": actor.password,
                "name": actor.name,
                "role": "SURVEYOR",
                "gps_radius_required": False,
            }
            created = admin_session.post(
                f"{BASE_URL}/api/admin/users",
                json=payload,
                timeout=30,
            )
            assert created.status_code == 200, f"create {actor.username} failed: {created.status_code} {created.text}"

    # Validate credentials actually work
    sa = _login(SURVEYOR_A.username, SURVEYOR_A.password)
    sb = _login(SURVEYOR_B.username, SURVEYOR_B.password)
    me_a = sa.get(f"{BASE_URL}/api/auth/me", timeout=30)
    me_b = sb.get(f"{BASE_URL}/api/auth/me", timeout=30)
    assert me_a.status_code == 200 and me_b.status_code == 200
    return {
        "a": {"actor": SURVEYOR_A, "session": sa, "me": me_a.json()},
        "b": {"actor": SURVEYOR_B, "session": sb, "me": me_b.json()},
    }


def _create_field_property(session: requests.Session, tag: str):
    payload = {
        "owner_name": f"TEST_ITER5_OWNER_{tag}",
        "mobile": "9876500001",
        "ward": "27",
        "address": f"TEST_ITER5_ADDR_{tag}",
        "colony": f"TEST_ITER5_COLONY_{tag}",
        "category": "Residential",
        "latitude": 29.9695,
        "longitude": 76.8783,
    }
    r = session.post(f"{BASE_URL}/api/phed/field-properties", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["property"]


def _create_consumer(admin_session: requests.Session, cid: str, name: str, linked_property_id=None):
    body = {
        "consumer_name": name,
        "fh_name": "TEST FH",
        "address": "TEST ADDR",
        "locality": "TEST LOCALITY",
        "phone": "9876500002",
        "consumer_id": cid,
        "category": "Domestic",
        "linked_property_id": linked_property_id,
    }
    r = admin_session.post(f"{BASE_URL}/api/phed/consumers", json=body, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _add_connection(admin_session: requests.Session, consumer_ref: str, service: str, number: str):
    r = admin_session.post(
        f"{BASE_URL}/api/phed/consumers/{consumer_ref}/connections",
        json={"service": service, "connection_number": number, "category": "Domestic"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def seeded_scope(admin_session, test_surveyors):
    # Feature: seed deterministic records for import safety, submission queue, and authorization checks.
    sa = test_surveyors["a"]["session"]
    sb = test_surveyors["b"]["session"]

    p_valid = _create_field_property(sa, "OFFICE_VALID")
    p_linked = _create_field_property(sa, "OFFICE_LINKED")
    p_b = _create_field_property(sb, "B_ASSIGNED")
    p_receipt = _create_field_property(sa, "OFFICE_RECEIPT")
    p_water = _create_field_property(sa, "WATER_EXISTING")

    c_valid = _create_consumer(admin_session, f"TESTCIDV{uuid.uuid4().hex[:6].upper()}", "TEST Valid Consumer")
    _add_connection(admin_session, c_valid["id"], "Water", f"TW{uuid.uuid4().hex[:5].upper()}")
    _add_connection(admin_session, c_valid["id"], "Sewer", f"TS{uuid.uuid4().hex[:5].upper()}")

    c_only = _create_consumer(admin_session, f"TESTCIDO{uuid.uuid4().hex[:6].upper()}", "TEST CID ONLY")
    c_linked = _create_consumer(
        admin_session,
        f"TESTCIDL{uuid.uuid4().hex[:6].upper()}",
        "TEST LINKED CONSUMER",
        linked_property_id=p_linked["id"],
    )
    c_receipt = _create_consumer(admin_session, f"TESTCIDR{uuid.uuid4().hex[:6].upper()}", "TEST RECEIPT")
    c_water = _create_consumer(
        admin_session,
        f"TESTCIDW{uuid.uuid4().hex[:6].upper()}",
        "TEST WATER EXISTING",
        linked_property_id=p_water["id"],
    )

    return {
        "admin": admin_session,
        "sa": sa,
        "sb": sb,
        "props": {
            "valid": p_valid,
            "linked": p_linked,
            "b": p_b,
            "receipt": p_receipt,
            "water": p_water,
        },
        "consumers": {
            "valid": c_valid,
            "only": c_only,
            "linked": c_linked,
            "receipt": c_receipt,
            "water": c_water,
        },
    }


@pytest.fixture(scope="module")
def office_batch(seeded_scope):
    # Feature: office import must use explicit PID/CID matching with no name/mobile fallback.
    admin = seeded_scope["admin"]
    props = seeded_scope["props"]
    consumers = seeded_scope["consumers"]

    wb = Workbook()
    ws = wb.active
    ws.append(["Property ID (PID)", "Consumer ID", "Owner Name", "Mobile", "Remarks"])
    ws.append([props["valid"]["property_id"], consumers["valid"]["consumer_id"], "Owner", "9999999999", "valid pair"])
    ws.append(["", consumers["only"]["consumer_id"], "TEST_ITER5_OWNER_OFFICE_VALID", "9876500001", "cid only should not fallback"])
    ws.append(["TEST_INVALID_PID_001", consumers["linked"]["consumer_id"], "Owner", "9999999999", "invalid pid should not fallback to linked cid"])
    ws.append(["-", "NA", "Owner", "9999999999", "blank ids should be skipped"])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = f"TEST_ITER5_OFFICE_{uuid.uuid4().hex[:6].upper()}.xlsx"
    files = {
        "file": (
            filename,
            buf.getvalue(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    }
    r = admin.post(f"{BASE_URL}/api/phed/office-import", files=files, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["approved"] == 1, data
    assert data["not_found"] >= 2, data
    reasons = " | ".join((u.get("reason") or "") for u in data.get("unmatched", []))
    assert "no name/mobile fallback" in reasons
    assert "explicit Property ID" in reasons or "existing verified consumer-property link" in reasons
    data["filename"] = filename
    return data


def test_office_import_links_consumer_and_connections(seeded_scope, office_batch):
    # Feature: successful explicit PID+CID office pair links consumer and active connections.
    admin = seeded_scope["admin"]
    c_valid = seeded_scope["consumers"]["valid"]
    p_valid = seeded_scope["props"]["valid"]

    consumer = admin.get(f"{BASE_URL}/api/phed/consumers/{c_valid['id']}", timeout=30)
    assert consumer.status_code == 200, consumer.text
    payload = consumer.json()
    assert payload.get("linked_property_id") == p_valid["id"]
    assert payload.get("linked_property_number") == p_valid["property_id"]
    assert payload.get("connections"), payload
    assert all(conn.get("linked_property_id") == p_valid["id"] for conn in payload.get("connections", []))


def test_import_deletion_preview_and_permissions(seeded_scope, office_batch):
    # Feature: deletion preview counts and role restrictions for import-batches APIs.
    admin = seeded_scope["admin"]
    sa = seeded_scope["sa"]
    batch_id = office_batch["batch_id"]

    p = admin.get(f"{BASE_URL}/api/phed/import-batches/office/{batch_id}/deletion-preview", timeout=30)
    assert p.status_code == 200, p.text
    pdata = p.json()
    assert pdata["remove"] >= 1
    assert isinstance(pdata.get("warnings"), list)

    forbidden = sa.get(f"{BASE_URL}/api/phed/import-batches/office/{batch_id}/deletion-preview", timeout=30)
    assert forbidden.status_code == 403


def test_import_delete_wrong_confirmation_400(seeded_scope, office_batch):
    admin = seeded_scope["admin"]
    batch_id = office_batch["batch_id"]
    bad = admin.delete(
        f"{BASE_URL}/api/phed/import-batches/office/{batch_id}",
        json={"confirmation": "wrong-file"},
        timeout=30,
    )
    assert bad.status_code == 400


def test_import_delete_success_and_idempotent(seeded_scope, office_batch):
    # Feature: delete imported data restores snapshots and second delete is idempotent.
    admin = seeded_scope["admin"]
    c_valid = seeded_scope["consumers"]["valid"]
    batch_id = office_batch["batch_id"]

    good = admin.delete(
        f"{BASE_URL}/api/phed/import-batches/office/{batch_id}",
        json={"confirmation": office_batch["filename"]},
        timeout=30,
    )
    assert good.status_code == 200, good.text

    consumer = admin.get(f"{BASE_URL}/api/phed/consumers/{c_valid['id']}", timeout=30)
    assert consumer.status_code == 200
    assert consumer.json().get("linked_property_id") in (None, "")

    again = admin.delete(
        f"{BASE_URL}/api/phed/import-batches/office/{batch_id}",
        json={"confirmation": office_batch["filename"]},
        timeout=30,
    )
    assert again.status_code == 200, again.text
    assert again.json()["status"] == "Deleted"


def test_citywide_search_can_survey_but_assigned_lists_remain_scoped(seeded_scope):
    # Feature: citywide search returns outside-colony property with can_survey=true, assigned lists stay scoped.
    sa = seeded_scope["sa"]
    p_b = seeded_scope["props"]["b"]

    search = sa.get(
        f"{BASE_URL}/api/employee/properties/search",
        params={"search": p_b["property_id"], "limit": 10, "page": 1},
        timeout=30,
    )
    assert search.status_code == 200, search.text
    items = search.json()["properties"]
    hit = next((p for p in items if p["id"] == p_b["id"]), None)
    assert hit is not None
    assert hit["can_survey"] is True

    assigned = sa.get(f"{BASE_URL}/api/employee/properties", timeout=30)
    assert assigned.status_code == 200, assigned.text
    assert all(p["id"] != p_b["id"] for p in assigned.json().get("properties", []))


def test_pin_update_outside_assignment_and_wrong_town_forbidden(seeded_scope):
    # Feature: outside-assignment location edit and unauthorized town access are denied.
    sa = seeded_scope["sa"]
    p_b = seeded_scope["props"]["b"]

    move = sa.put(
        f"{BASE_URL}/api/phed/properties/{p_b['id']}/location",
        json={"latitude": 29.9701, "longitude": 76.8789},
        timeout=30,
    )
    assert move.status_code == 403

    wrong_town = requests.get(
        f"{BASE_URL}/api/employee/properties/search",
        params={"search": p_b["property_id"]},
        headers={**sa.headers, "X-Town-Code": "XYZ"},
        timeout=30,
    )
    assert wrong_town.status_code == 403


def _draft_water_payload(property_doc: dict, consumer_id: str = ""):
    return {
        "property_record_id": property_doc["id"],
        "survey_type": "WATER_CONNECTION",
        "latitude": property_doc["latitude"],
        "longitude": property_doc["longitude"],
        "gps_accuracy": 5,
        "gps_captured_at": "2026-02-01T09:00:00Z",
        "water": {
            "has_connection": True,
            "consumer_name": "TEST WATER",
            "mobile": "9876500011",
            "category": "Domestic",
            "consumer_id": consumer_id,
            "connection_numbers": [f"TWCON{uuid.uuid4().hex[:5].upper()}"],
            "sewer_connection_numbers": [f"TSCON{uuid.uuid4().hex[:5].upper()}"],
        },
    }


def test_another_surveyor_cannot_edit_or_submit_others_survey(seeded_scope):
    # Feature: another surveyor's survey edits/submits are forbidden.
    sa = seeded_scope["sa"]
    sb = seeded_scope["sb"]
    p_b = seeded_scope["props"]["b"]

    create = sb.post(f"{BASE_URL}/api/phed/surveys/draft", json=_draft_water_payload(p_b), timeout=30)
    assert create.status_code == 200, create.text
    survey_id = create.json()["id"]

    forbidden_edit = sa.post(f"{BASE_URL}/api/phed/surveys/draft", json=_draft_water_payload(p_b), timeout=30)
    assert forbidden_edit.status_code == 403

    forbidden_submit = sa.post(f"{BASE_URL}/api/phed/surveys/{survey_id}/submit", timeout=30)
    assert forbidden_submit.status_code == 403


def test_approved_survey_blocks_further_writes_409(seeded_scope):
    # Feature: approved survey cannot be overwritten by draft/submit mutations.
    admin = seeded_scope["admin"]
    sb = seeded_scope["sb"]
    p_b = seeded_scope["props"]["b"]

    draft = sb.post(f"{BASE_URL}/api/phed/surveys/draft", json=_draft_water_payload(p_b), timeout=30)
    assert draft.status_code == 200, draft.text
    sid = draft.json()["id"]

    submit = sb.post(f"{BASE_URL}/api/phed/surveys/{sid}/submit", timeout=30)
    assert submit.status_code == 200, submit.text

    approve = admin.post(f"{BASE_URL}/api/phed/surveys/{sid}/approve", timeout=30)
    assert approve.status_code == 200, approve.text

    blocked = sb.post(f"{BASE_URL}/api/phed/surveys/draft", json=_draft_water_payload(p_b), timeout=30)
    assert blocked.status_code == 409

    detail = sb.get(f"{BASE_URL}/api/phed/property/{p_b['id']}", timeout=30)
    assert detail.status_code == 200
    assert detail.json().get("survey", {}).get("status") == "Approved"


def test_office_document_receipt_routes_to_pending_queue_and_mine(seeded_scope):
    # Feature: office document receipt creates/updates Submitted survey, visible in admin pending + mine.
    admin = seeded_scope["admin"]
    sa = seeded_scope["sa"]
    consumer = seeded_scope["consumers"]["receipt"]
    prop = seeded_scope["props"]["receipt"]

    no_confirm = sa.post(
        f"{BASE_URL}/api/phed/consumers/{consumer['id']}/office-document-receipt",
        json={
            "property_record_id": prop["id"],
            "status": "Already ok PID received at office",
            "remarks": "TEST no confirm",
            "confirm": False,
        },
        timeout=30,
    )
    assert no_confirm.status_code == 400

    first = sa.post(
        f"{BASE_URL}/api/phed/consumers/{consumer['id']}/office-document-receipt",
        json={
            "property_record_id": prop["id"],
            "status": "Already ok PID received at office",
            "remarks": "TEST first receipt",
            "confirm": True,
        },
        timeout=30,
    )
    assert first.status_code == 200, first.text
    first_id = first.json()["survey_id"]

    pending = admin.get(f"{BASE_URL}/api/phed/surveys", params={"queue": "pending", "limit": 100}, timeout=30)
    assert pending.status_code == 200
    assert any(s["id"] == first_id for s in pending.json().get("surveys", []))

    mine = sa.get(f"{BASE_URL}/api/phed/surveys/mine", params={"limit": 100}, timeout=30)
    assert mine.status_code == 200
    assert any(s["id"] == first_id for s in mine.json().get("surveys", []))

    second = sa.post(
        f"{BASE_URL}/api/phed/consumers/{consumer['id']}/office-document-receipt",
        json={
            "property_record_id": prop["id"],
            "status": "Owner change Documents received at office",
            "remarks": "TEST update same survey",
            "confirm": True,
        },
        timeout=30,
    )
    assert second.status_code == 200, second.text
    assert second.json()["survey_id"] == first_id


def test_water_survey_existing_consumer_keeps_single_cid_and_adds_water_sewer(seeded_scope):
    # Feature: WATER_CONNECTION for existing consumer reuses consumer and creates Water+Sewer connections.
    sa = seeded_scope["sa"]
    admin = seeded_scope["admin"]
    prop = seeded_scope["props"]["water"]
    consumer = seeded_scope["consumers"]["water"]

    draft = sa.post(
        f"{BASE_URL}/api/phed/surveys/draft",
        json=_draft_water_payload(prop, consumer_id=consumer["consumer_id"]),
        timeout=30,
    )
    assert draft.status_code == 200, draft.text
    sid = draft.json()["id"]

    submit = sa.post(f"{BASE_URL}/api/phed/surveys/{sid}/submit", timeout=30)
    assert submit.status_code == 200, submit.text

    q = admin.get(f"{BASE_URL}/api/phed/consumers", params={"q": consumer["consumer_id"], "limit": 100}, timeout=30)
    assert q.status_code == 200, q.text
    rows = q.json().get("consumers", [])
    exact = [r for r in rows if (r.get("consumer_id") or "").upper() == consumer["consumer_id"].upper()]
    assert len(exact) == 1, f"duplicate consumer ids found: {[r.get('id') for r in exact]}"

    detail = admin.get(f"{BASE_URL}/api/phed/consumers/{consumer['id']}", timeout=30)
    assert detail.status_code == 200
    services = {c.get("service") for c in detail.json().get("connections", [])}
    assert "Water" in services and "Sewer" in services


def test_map_endpoints_reflect_latest_yellow_and_green_states(seeded_scope):
    # Feature: map and search endpoints expose latest PHED survey state (yellow submitted, green approved).
    admin = seeded_scope["admin"]
    sa = seeded_scope["sa"]
    p_b = seeded_scope["props"]["b"]
    p_water = seeded_scope["props"]["water"]

    city_map = admin.get(f"{BASE_URL}/api/map/properties", params={"limit": 5000}, timeout=30)
    assert city_map.status_code == 200, city_map.text
    props = city_map.json().get("properties", [])
    by_id = {p["id"]: p for p in props}
    assert by_id[p_b["id"]].get("phed_survey_state") == "Approved"
    assert by_id[p_water["id"]].get("phed_survey_state") in ("Submitted", "Requires Review", "Document Pending")

    employee_map = sa.get(f"{BASE_URL}/api/map/employee-properties", timeout=30)
    assert employee_map.status_code == 200, employee_map.text
    e_by_id = {p["id"]: p for p in employee_map.json().get("properties", [])}
    assert p_water["id"] in e_by_id
    assert e_by_id[p_water["id"]].get("phed_survey_state") in ("Submitted", "Requires Review", "Document Pending")

    search = sa.get(
        f"{BASE_URL}/api/employee/properties/search",
        params={"search": p_water["property_id"], "limit": 10},
        timeout=30,
    )
    assert search.status_code == 200
    hit = next((x for x in search.json().get("properties", []) if x["id"] == p_water["id"]), None)
    assert hit is not None
    assert hit.get("phed_survey_state") in ("Submitted", "Requires Review", "Document Pending")
