"""Citywide property search + office-document-receipt tests (latest scope).

Supersedes the pre-implementation link tests. This module:
  * Reads MONGO_URL / DB_NAME from /app/backend/.env (no hardcoded literals).
  * Reads REACT_APP_BACKEND_URL from env or /app/frontend/.env.
  * Reads admin credentials from /app/backend/.env; surveyor from
    /app/memory/test_credentials.md (or creates via admin API).
  * Provisions isolated TEST_ prefixed properties + a PHED consumer.
  * Verifies GET /api/employee/properties/search citywide behaviour
    (assigned/unassigned, ward and cross-colony, PID/mobile/name partial
    case-insensitive trimmed, Hindi-safe, exact-id regex-escape,
    pagination, blank + validation, no-GPS, can_survey accuracy).
  * Verifies POST /api/phed/consumers/{ref}/office-document-receipt with
    the five exact status labels, Other-remarks requirement, cross-town /
    unauth / invalid-property / invalid-consumer / confirm=false rejections,
    audit history, receipt replacement, and (current behaviour) that the
    receipt LINKS the Property ID to the consumer and submits the survey to
    the admin approval queue.
  * Locks existing invariants: /phed/surveys/draft assignment-scope,
    PUT /phed/properties/{id}/location assignment-scope, legacy property
    detail assignment-scope, default employee list scope.
"""
from __future__ import annotations

import copy
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient


def _read_env_file(path: str) -> dict:
    out = {}
    try:
        for line in open(path):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return out


_BE = _read_env_file("/app/backend/.env")
_FE = _read_env_file("/app/frontend/.env")

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _FE.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not set and not found in /app/frontend/.env"

MONGO_URL = os.environ.get("MONGO_URL") or _BE.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or _BE.get("DB_NAME")
assert MONGO_URL and DB_NAME, "MONGO_URL / DB_NAME missing from /app/backend/.env"

ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME") or _BE.get("ADMIN_USERNAME")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD") or _BE.get("ADMIN_PASSWORD")
assert ADMIN_USERNAME and ADMIN_PASSWORD, "ADMIN_USERNAME / ADMIN_PASSWORD missing"

THS_HEADERS = {"x-town-code": "THS"}

# Test surveyor credentials must be present in the shared credentials file.
def _parse_surveyor_creds_from_md(path: str = "/app/memory/test_credentials.md"):
    username = password = None
    try:
        in_section = False
        for raw in open(path, encoding="utf-8"):
            line = raw.rstrip("\n")
            if line.startswith("## Test Surveyor"):
                in_section = True
                continue
            if in_section:
                if line.startswith("## "):
                    break
                if line.startswith("- Username:"):
                    part = line.split(":", 1)[1].strip()
                    username = part.strip("`").strip()
                elif line.startswith("- Password:"):
                    part = line.split(":", 1)[1].strip()
                    password = part.strip("`").strip()
    except FileNotFoundError:
        pass
    return username, password


SURVEYOR_USERNAME, SURVEYOR_PASSWORD = _parse_surveyor_creds_from_md()
assert SURVEYOR_USERNAME and SURVEYOR_PASSWORD, "Failed to parse Test Surveyor credentials from /app/memory/test_credentials.md"

PID_ASSIGNED_W27 = "TEST_CITYWIDE_W27_ASSIGNED_001"
PID_UNASSIGNED_W1 = "TEST_CITYWIDE_W01_UNASSIGNED_002"
PID_UNASSIGNED_W27_OTHER_COLONY = "TEST_CITYWIDE_W27_OTHERCOL_003"
PID_UNASSIGNED_NO_GPS = "TEST_CITYWIDE_W02_NOGPS_004"
PID_HINDI_OWNER = "TEST_CITYWIDE_HINDI_005"
CONSUMER_TEST_REF_ID = "TEST_CITYWIDE_CONSUMER_REF"
CONSUMER_TEST_CID = "TEST_CID_9001"
CONSUMER_LINKED_REF_ID = "TEST_CITYWIDE_CONSUMER_LINKED"
CONSUMER_LINKED_CID = "TEST_CID_9002"
CONNECTION_TEST_ID = "TEST_CITYWIDE_CONN_001"
SURVEY_TEST_ID = "TEST_CITYWIDE_SURVEY_001"

FIVE_STATUSES = [
    "Sewer documents received at office",
    "Already ok PID received at office",
    "Death transfer documents received at office",
    "Owner change Documents received at office",
    "Other",
]


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="session")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD, "selected_town": "THS"},
        timeout=15,
    )
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def ths_town(mongo):
    town = mongo.towns.find_one({"code": "THS"})
    assert town, "THS town should be seeded"
    return town


@pytest.fixture(scope="session")
def surveyor_user(admin_token, ths_town, mongo):
    existing = mongo.users.find_one({"username": SURVEYOR_USERNAME})
    if not existing:
        payload = {
            "username": SURVEYOR_USERNAME,
            "password": SURVEYOR_PASSWORD,
            "name": "Citywide Test Surveyor",
            "role": "SURVEYOR",
            "assigned_town": ths_town["id"],
            "gps_radius_required": False,
        }
        r = requests.post(
            f"{BASE_URL}/api/admin/users",
            json=payload,
            headers={"Authorization": f"Bearer {admin_token}", **THS_HEADERS},
            timeout=15,
        )
        assert r.status_code == 200, f"Create surveyor failed: {r.status_code} {r.text}"
        user = r.json()
    else:
        user = {"id": existing["id"], "username": existing["username"],
                "assigned_town": existing.get("assigned_town")}
    return user


@pytest.fixture(scope="session")
def surveyor_token(surveyor_user):
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": SURVEYOR_USERNAME, "password": SURVEYOR_PASSWORD, "selected_town": "THS"},
        timeout=15,
    )
    assert r.status_code == 200, f"Surveyor login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session", autouse=True)
def property_fixtures(mongo, surveyor_user):
    now = datetime.now(timezone.utc).isoformat()

    def mkprop(property_id, ward, colony, assigned=False, lat=29.97, lng=76.87,
               no_gps=False, owner=None, mobile="9999900000"):
        doc = {
            "id": f"rec_{property_id}",
            "property_id": property_id,
            "batch_id": "TEST_BATCH_CITYWIDE",
            "owner_name": owner if owner is not None else f"Owner {property_id}",
            "mobile": mobile,
            "address": f"Test address {property_id}",
            "colony": colony,
            "ward": ward,
            "status": "Pending",
            "serial_number": 1,
            "town": "THS",
            "created_at": now,
        }
        if not no_gps:
            doc["latitude"] = lat
            doc["longitude"] = lng
        if assigned:
            doc["assigned_employee_id"] = surveyor_user["id"]
            doc["assigned_employee_ids"] = [surveyor_user["id"]]
        return doc

    docs = [
        mkprop(PID_ASSIGNED_W27, "27", "TEST_COLONY_A", assigned=True, mobile="9812345678"),
        mkprop(PID_UNASSIGNED_W1, "1", "TEST_COLONY_B", assigned=False,
               lat=29.98, lng=76.88, mobile="9823456789"),
        mkprop(PID_UNASSIGNED_W27_OTHER_COLONY, "27", "TEST_COLONY_C_OTHER",
               assigned=False, lat=29.975, lng=76.875, mobile="9834567890"),
        mkprop(PID_UNASSIGNED_NO_GPS, "2", "TEST_COLONY_D", assigned=False, no_gps=True),
        mkprop(PID_HINDI_OWNER, "27", "TEST_COLONY_A", assigned=False,
               lat=29.971, lng=76.871,
               owner="\u0930\u093e\u092e \u0915\u0941\u092e\u093e\u0930",  # राम कुमार
               mobile="9845678901"),
    ]
    for d in docs:
        mongo.properties.replace_one({"id": d["id"]}, d, upsert=True)

    def mkconsumer(ref, cid, linked_prop=None, linked_number=None):
        return {
            "id": ref,
            "consumer_id": cid,
            "consumer_id_norm": cid.upper(),
            "consumer_name": "Citywide Test Consumer",
            "name_norm": "citywide test consumer",
            "fh_name": "Test FH",
            "phone": "9999911111",
            "phone_norm": "9999911111",
            "address": "Test PHED addr",
            "locality": "TEST_COLONY_B",
            "ward_id": "1",
            "colony_name": "TEST_COLONY_B",
            "status": "active",
            "is_active": True,
            "linked_property_id": linked_prop,
            "linked_property_number": linked_number,
            "created_at": now,
            "updated_at": now,
        }

    mongo.phed_consumers.replace_one(
        {"id": CONSUMER_TEST_REF_ID}, mkconsumer(CONSUMER_TEST_REF_ID, CONSUMER_TEST_CID), upsert=True
    )
    mongo.phed_consumers.replace_one(
        {"id": CONSUMER_LINKED_REF_ID},
        mkconsumer(CONSUMER_LINKED_REF_ID, CONSUMER_LINKED_CID,
                   linked_prop=f"rec_{PID_ASSIGNED_W27}", linked_number=PID_ASSIGNED_W27),
        upsert=True,
    )

    # Seed a phed_connection for the unlinked consumer + an existing phed_survey
    # on the assigned property to prove the receipt endpoint touches neither.
    mongo.phed_connections.replace_one(
        {"id": CONNECTION_TEST_ID},
        {
            "id": CONNECTION_TEST_ID,
            "consumer_ref": CONSUMER_TEST_REF_ID,
            "service": "Water",
            "connection_number": "TEST_CONN_W_1",
            "linked_property_id": None,
            "linked_property_number": None,
            "is_active": True,
            "status": "active",
            "created_at": now,
            "updated_at": now,
        },
        upsert=True,
    )
    mongo.phed_surveys.replace_one(
        {"id": SURVEY_TEST_ID},
        {
            "id": SURVEY_TEST_ID,
            "property_record_id": f"rec_{PID_ASSIGNED_W27}",
            "property_id": PID_ASSIGNED_W27,
            "surveyor_id": surveyor_user["id"],
            "surveyor_name": "Citywide Test Surveyor",
            "status": "Draft",
            "attachments": [],
            "consumer_refs": [],
            "created_at": now,
            "updated_at": now,
            "started_at": now,
            "remarks": "seeded existing survey",
        },
        upsert=True,
    )

    # Additional 30 fixtures for pagination sanity (property_id: TEST_CITYWIDE_PAGE_00..29).
    for i in range(30):
        pid = f"TEST_CITYWIDE_PAGE_{i:02d}"
        mongo.properties.replace_one(
            {"id": f"rec_{pid}"},
            {
                "id": f"rec_{pid}",
                "property_id": pid,
                "batch_id": "TEST_BATCH_CITYWIDE",
                "owner_name": f"Owner PAGE {i}",
                "mobile": f"98000000{i:02d}",
                "address": f"Addr PAGE {i}",
                "colony": "TEST_COLONY_PAGE",
                "ward": "27",
                "status": "Pending",
                "serial_number": 100 + i,
                "town": "THS",
                "latitude": 29.97,
                "longitude": 76.87,
                "created_at": now,
            },
            upsert=True,
        )

    yield

    # Cleanup ONLY exact fixture IDs / property_ids we created — no wildcards
    # against unrelated data.
    prop_ids = [
        f"rec_{PID_ASSIGNED_W27}", f"rec_{PID_UNASSIGNED_W1}",
        f"rec_{PID_UNASSIGNED_W27_OTHER_COLONY}", f"rec_{PID_UNASSIGNED_NO_GPS}",
        f"rec_{PID_HINDI_OWNER}",
    ] + [f"rec_TEST_CITYWIDE_PAGE_{i:02d}" for i in range(30)]
    mongo.properties.delete_many({"id": {"$in": prop_ids}})
    mongo.phed_consumers.delete_many({"id": {"$in": [CONSUMER_TEST_REF_ID, CONSUMER_LINKED_REF_ID]}})
    mongo.phed_connections.delete_many({"id": CONNECTION_TEST_ID})
    mongo.phed_surveys.delete_many({"$or": [{"id": SURVEY_TEST_ID},
                                            {"property_record_id": {"$in": prop_ids}}]})
    mongo.phed_audit_logs.delete_many(
        {"entity_id": {"$in": [CONSUMER_TEST_REF_ID, CONSUMER_LINKED_REF_ID]}}
    )


def sv_headers(t):
    return {"Authorization": f"Bearer {t}", **THS_HEADERS}


def ad_headers(t):
    return {"Authorization": f"Bearer {t}", **THS_HEADERS}


SEARCH_URL = "/api/employee/properties/search"
RECEIPT_URL_TMPL = "/api/phed/consumers/{ref}/office-document-receipt"


# --------------------------------------------------------------------------- #
# GET /api/employee/properties/search
# --------------------------------------------------------------------------- #
class TestCitywideSearch:
    def test_auth_required(self):
        r = requests.get(f"{BASE_URL}{SEARCH_URL}", params={"search": "x"}, timeout=15)
        assert r.status_code in (401, 403)

    def test_finds_unassigned_exact_id_can_survey_false(self, surveyor_token):
        r = requests.get(f"{BASE_URL}{SEARCH_URL}",
                         params={"search": PID_UNASSIGNED_W1},
                         headers=sv_headers(surveyor_token), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("properties", "total", "page", "pages"):
            assert k in data
        hit = [p for p in data["properties"] if p["property_id"] == PID_UNASSIGNED_W1]
        assert hit, data
        assert hit[0]["can_survey"] is False

    def test_finds_assigned_can_survey_true(self, surveyor_token):
        r = requests.get(f"{BASE_URL}{SEARCH_URL}",
                         params={"search": PID_ASSIGNED_W27},
                         headers=sv_headers(surveyor_token), timeout=20)
        assert r.status_code == 200
        hit = [p for p in r.json()["properties"] if p["property_id"] == PID_ASSIGNED_W27]
        assert hit and hit[0]["can_survey"] is True

    def test_same_ward_other_colony_visible_unassigned(self, surveyor_token):
        r = requests.get(f"{BASE_URL}{SEARCH_URL}",
                         params={"search": PID_UNASSIGNED_W27_OTHER_COLONY},
                         headers=sv_headers(surveyor_token), timeout=20)
        assert r.status_code == 200
        hit = [p for p in r.json()["properties"] if p["property_id"] == PID_UNASSIGNED_W27_OTHER_COLONY]
        assert hit and hit[0]["can_survey"] is False

    def test_no_gps_row_returned(self, surveyor_token):
        r = requests.get(f"{BASE_URL}{SEARCH_URL}",
                         params={"search": PID_UNASSIGNED_NO_GPS},
                         headers=sv_headers(surveyor_token), timeout=20)
        assert r.status_code == 200
        hit = [p for p in r.json()["properties"] if p["property_id"] == PID_UNASSIGNED_NO_GPS]
        assert hit

    def test_mobile_partial_match(self, surveyor_token):
        r = requests.get(f"{BASE_URL}{SEARCH_URL}",
                         params={"search": "98234567"},  # partial of assigned/unassigned mobile
                         headers=sv_headers(surveyor_token), timeout=20)
        assert r.status_code == 200
        pids = {p["property_id"] for p in r.json()["properties"]}
        assert PID_UNASSIGNED_W1 in pids

    def test_name_partial_case_insensitive_trimmed(self, surveyor_token):
        r = requests.get(f"{BASE_URL}{SEARCH_URL}",
                         params={"search": "  owner TEST_CITYWIDE_w01  "},
                         headers=sv_headers(surveyor_token), timeout=20)
        assert r.status_code == 200
        pids = {p["property_id"] for p in r.json()["properties"]}
        assert PID_UNASSIGNED_W1 in pids

    def test_hindi_owner_name_partial(self, surveyor_token):
        # Search by a single Hindi token from owner name.
        r = requests.get(f"{BASE_URL}{SEARCH_URL}",
                         params={"search": "\u0930\u093e\u092e"},  # राम
                         headers=sv_headers(surveyor_token), timeout=20)
        assert r.status_code == 200, r.text
        pids = {p["property_id"] for p in r.json()["properties"]}
        assert PID_HINDI_OWNER in pids

    def test_regex_meta_chars_safe(self, surveyor_token):
        r = requests.get(f"{BASE_URL}{SEARCH_URL}",
                         params={"search": "TEST_CITYWIDE_W01_UNASSIGNED_002.*("},
                         headers=sv_headers(surveyor_token), timeout=20)
        assert r.status_code == 200

    def test_blank_search_rejected_or_empty(self, surveyor_token):
        r = requests.get(f"{BASE_URL}{SEARCH_URL}",
                         params={"search": "   "},
                         headers=sv_headers(surveyor_token), timeout=20)
        # Backend returns empty result set for whitespace-only.
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 0 and data["properties"] == []

    def test_missing_search_param_422(self, surveyor_token):
        r = requests.get(f"{BASE_URL}{SEARCH_URL}",
                         headers=sv_headers(surveyor_token), timeout=20)
        assert r.status_code == 422

    def test_invalid_page_limit_422(self, surveyor_token):
        r = requests.get(f"{BASE_URL}{SEARCH_URL}",
                         params={"search": "x", "page": 0, "limit": 500},
                         headers=sv_headers(surveyor_token), timeout=20)
        assert r.status_code == 422

    def test_pagination_deterministic(self, surveyor_token):
        # 30 fixtures + a few TEST_CITYWIDE_ others match "TEST_CITYWIDE_PAGE_".
        p1 = requests.get(f"{BASE_URL}{SEARCH_URL}",
                          params={"search": "TEST_CITYWIDE_PAGE_", "page": 1, "limit": 10},
                          headers=sv_headers(surveyor_token), timeout=20)
        p2 = requests.get(f"{BASE_URL}{SEARCH_URL}",
                          params={"search": "TEST_CITYWIDE_PAGE_", "page": 2, "limit": 10},
                          headers=sv_headers(surveyor_token), timeout=20)
        p1r = requests.get(f"{BASE_URL}{SEARCH_URL}",
                           params={"search": "TEST_CITYWIDE_PAGE_", "page": 1, "limit": 10},
                           headers=sv_headers(surveyor_token), timeout=20)
        assert p1.status_code == p2.status_code == p1r.status_code == 200
        pids1 = [p["property_id"] for p in p1.json()["properties"]]
        pids2 = [p["property_id"] for p in p2.json()["properties"]]
        pids1_repeat = [p["property_id"] for p in p1r.json()["properties"]]
        assert pids1 == pids1_repeat  # deterministic
        assert set(pids1).isdisjoint(pids2)  # no overlap
        assert p1.json()["total"] >= 30

    def test_pid_partial_case_and_trim(self, surveyor_token):
        """PID partial match must be case-insensitive AND trim whitespace."""
        r = requests.get(
            f"{BASE_URL}{SEARCH_URL}",
            params={"search": "  test_citywide_w01_unassigned  "},
            headers=sv_headers(surveyor_token), timeout=20,
        )
        assert r.status_code == 200, r.text
        pids = {p["property_id"] for p in r.json()["properties"]}
        assert PID_UNASSIGNED_W1 in pids

    def test_search_length_boundary_200_ok_201_rejected(self, surveyor_token):
        """max_length=200 declared on Query; 200 chars OK, 201 -> 422."""
        r_ok = requests.get(
            f"{BASE_URL}{SEARCH_URL}",
            params={"search": "a" * 200},
            headers=sv_headers(surveyor_token), timeout=20,
        )
        assert r_ok.status_code == 200, r_ok.text
        r_bad = requests.get(
            f"{BASE_URL}{SEARCH_URL}",
            params={"search": "a" * 201},
            headers=sv_headers(surveyor_token), timeout=20,
        )
        assert r_bad.status_code == 422

    def test_search_cross_town_header_scoped(self, surveyor_token):
        """Search is town-scoped via x-town-code; a wrong header must not
        return THS fixtures (either 4xx or empty)."""
        r = requests.get(
            f"{BASE_URL}{SEARCH_URL}",
            params={"search": PID_UNASSIGNED_W1},
            headers={"Authorization": f"Bearer {surveyor_token}", "x-town-code": "ZZZ"},
            timeout=20,
        )
        assert r.status_code == 403, r.text


# --------------------------------------------------------------------------- #
# POST /api/phed/consumers/{ref}/office-document-receipt
# --------------------------------------------------------------------------- #
def _snapshot(mongo, consumer_ref, prop_record_id):
    c = mongo.phed_consumers.find_one({"id": consumer_ref}, {"_id": 0})
    p = mongo.properties.find_one({"id": prop_record_id}, {"_id": 0})
    return copy.deepcopy(c), copy.deepcopy(p)


def _reset_consumer(mongo, ref):
    mongo.phed_consumers.update_one(
        {"id": ref},
        {"$set": {"linked_property_id": None, "linked_property_number": None},
         "$unset": {"office_document_receipt": ""}},
    )
    mongo.phed_surveys.delete_many({"property_record_id": {
        "$in": [f"rec_{PID_UNASSIGNED_W1}", f"rec_{PID_UNASSIGNED_W27_OTHER_COLONY}"]}})


class TestOfficeDocumentReceipt:
    def test_auth_required(self):
        r = requests.post(
            f"{BASE_URL}{RECEIPT_URL_TMPL.format(ref=CONSUMER_TEST_REF_ID)}",
            json={"property_record_id": f"rec_{PID_UNASSIGNED_W1}",
                  "status": FIVE_STATUSES[0], "confirm": True},
            timeout=15,
        )
        assert r.status_code in (401, 403)

    def test_all_five_status_labels_accepted_unassigned_property(self, surveyor_token, mongo):
        _reset_consumer(mongo, CONSUMER_TEST_REF_ID)
        for status in FIVE_STATUSES:
            body = {"property_record_id": f"rec_{PID_UNASSIGNED_W1}",
                    "status": status, "confirm": True,
                    "remarks": "describe" if status == "Other" else ""}
            r = requests.post(
                f"{BASE_URL}{RECEIPT_URL_TMPL.format(ref=CONSUMER_TEST_REF_ID)}",
                json=body, headers=sv_headers(surveyor_token), timeout=20,
            )
            assert r.status_code == 200, f"status {status}: {r.status_code} {r.text}"
            j = r.json()["receipt"]
            assert j["status"] == status
            assert j["property_record_id"] == f"rec_{PID_UNASSIGNED_W1}"
            assert j["property_id"] == PID_UNASSIGNED_W1
            assert j["received_by"]
            assert j["received_by_name"]
            assert j["received_at"]

    def test_other_requires_nonblank_remarks(self, surveyor_token, mongo):
        _reset_consumer(mongo, CONSUMER_TEST_REF_ID)
        r = requests.post(
            f"{BASE_URL}{RECEIPT_URL_TMPL.format(ref=CONSUMER_TEST_REF_ID)}",
            json={"property_record_id": f"rec_{PID_UNASSIGNED_W1}",
                  "status": "Other", "remarks": "   ", "confirm": True},
            headers=sv_headers(surveyor_token), timeout=15,
        )
        assert r.status_code == 400

    def test_missing_status_invalid(self, surveyor_token):
        r = requests.post(
            f"{BASE_URL}{RECEIPT_URL_TMPL.format(ref=CONSUMER_TEST_REF_ID)}",
            json={"property_record_id": f"rec_{PID_UNASSIGNED_W1}", "confirm": True},
            headers=sv_headers(surveyor_token), timeout=15,
        )
        assert r.status_code == 422

    def test_invalid_status_rejected(self, surveyor_token):
        r = requests.post(
            f"{BASE_URL}{RECEIPT_URL_TMPL.format(ref=CONSUMER_TEST_REF_ID)}",
            json={"property_record_id": f"rec_{PID_UNASSIGNED_W1}",
                  "status": "Something else", "confirm": True},
            headers=sv_headers(surveyor_token), timeout=15,
        )
        assert r.status_code == 422

    def test_invalid_property_404(self, surveyor_token):
        r = requests.post(
            f"{BASE_URL}{RECEIPT_URL_TMPL.format(ref=CONSUMER_TEST_REF_ID)}",
            json={"property_record_id": "rec_TEST_DOES_NOT_EXIST_XYZ",
                  "status": FIVE_STATUSES[0], "confirm": True},
            headers=sv_headers(surveyor_token), timeout=15,
        )
        assert r.status_code == 404

    def test_invalid_consumer_404(self, surveyor_token):
        r = requests.post(
            f"{BASE_URL}{RECEIPT_URL_TMPL.format(ref='TEST_CITYWIDE_NO_SUCH_CONSUMER')}",
            json={"property_record_id": f"rec_{PID_UNASSIGNED_W1}",
                  "status": FIVE_STATUSES[0], "confirm": True},
            headers=sv_headers(surveyor_token), timeout=15,
        )
        assert r.status_code == 404

    def test_confirm_false_rejected(self, surveyor_token):
        r = requests.post(
            f"{BASE_URL}{RECEIPT_URL_TMPL.format(ref=CONSUMER_TEST_REF_ID)}",
            json={"property_record_id": f"rec_{PID_UNASSIGNED_W1}",
                  "status": FIVE_STATUSES[0], "confirm": False},
            headers=sv_headers(surveyor_token), timeout=15,
        )
        assert r.status_code == 400

    def test_cross_town_header_rejected(self, surveyor_token):
        r = requests.post(
            f"{BASE_URL}{RECEIPT_URL_TMPL.format(ref=CONSUMER_TEST_REF_ID)}",
            json={"property_record_id": f"rec_{PID_UNASSIGNED_W1}",
                  "status": FIVE_STATUSES[0], "confirm": True},
            headers={"Authorization": f"Bearer {surveyor_token}", "x-town-code": "ZZZ"},
            timeout=15,
        )
        assert r.status_code in (403, 404)

    def test_receipt_links_property_and_submits_survey(self, surveyor_token, mongo):
        """Current behaviour: the office receipt LINKS the Property ID to the PHED
        consumer and submits a survey to the admin approval queue."""
        _reset_consumer(mongo, CONSUMER_TEST_REF_ID)
        before_survey = copy.deepcopy(
            mongo.phed_surveys.find_one({"id": SURVEY_TEST_ID}, {"_id": 0})
        )

        r1 = requests.post(
            f"{BASE_URL}{RECEIPT_URL_TMPL.format(ref=CONSUMER_TEST_REF_ID)}",
            json={"property_record_id": f"rec_{PID_UNASSIGNED_W1}",
                  "status": FIVE_STATUSES[0], "confirm": True, "remarks": "first"},
            headers=sv_headers(surveyor_token), timeout=20,
        )
        assert r1.status_code == 200, r1.text
        body = r1.json()
        assert body["linked"] is True
        assert body["linked_property_number"] == PID_UNASSIGNED_W1
        assert body["survey_status"] == "Submitted"
        assert body["reference_number"]
        assert body["survey_id"]

        # consumer is now linked + locked
        after_c = mongo.phed_consumers.find_one({"id": CONSUMER_TEST_REF_ID}, {"_id": 0})
        assert after_c["linked_property_id"] == f"rec_{PID_UNASSIGNED_W1}"
        assert after_c["linked_property_number"] == PID_UNASSIGNED_W1
        assert after_c["office_document_receipt"]["status"] == FIVE_STATUSES[0]

        # connection inherits the link
        after_conn = mongo.phed_connections.find_one({"id": CONNECTION_TEST_ID}, {"_id": 0})
        assert after_conn["linked_property_id"] == f"rec_{PID_UNASSIGNED_W1}"

        # survey exists in the admin queue with office documents declared
        survey = mongo.phed_surveys.find_one({"id": body["survey_id"]}, {"_id": 0})
        assert survey["status"] == "Submitted"
        assert survey["property_record_id"] == f"rec_{PID_UNASSIGNED_W1}"
        assert survey["consumer_refs"] == [CONSUMER_TEST_REF_ID]
        assert survey["water"]["office_documents_submitted"] is True
        assert survey["submitted_at"]

        # property PHED state reflects the submission
        after_p1 = mongo.properties.find_one({"id": f"rec_{PID_UNASSIGNED_W1}"}, {"_id": 0})
        assert after_p1["phed_survey_status"] == "Submitted"

        # visible in the admin survey list
        adm = requests.get(
            f"{BASE_URL}/api/phed/surveys", params={"search": PID_UNASSIGNED_W1},
            headers=sv_headers(surveyor_token), timeout=20,
        )
        assert adm.status_code in (200, 403)  # surveyor may not read the admin list

        # unrelated seeded survey untouched
        assert mongo.phed_surveys.find_one({"id": SURVEY_TEST_ID}, {"_id": 0}) == before_survey

        # audit trail for the receipt
        audits = list(mongo.phed_audit_logs.find(
            {"entity_id": CONSUMER_TEST_REF_ID, "action": "OFFICE_DOCUMENT_RECEIPT"}
        ))
        assert len(audits) >= 1

    def test_receipt_on_consumer_linked_elsewhere_conflicts(self, surveyor_token, mongo):
        """Consumer LINKED_REF is pre-linked to another property; a surveyor receipt
        against a different property must be rejected (409) and the link preserved."""
        before = mongo.phed_consumers.find_one({"id": CONSUMER_LINKED_REF_ID}, {"_id": 0})
        r = requests.post(
            f"{BASE_URL}{RECEIPT_URL_TMPL.format(ref=CONSUMER_LINKED_REF_ID)}",
            json={"property_record_id": f"rec_{PID_UNASSIGNED_W1}",
                  "status": FIVE_STATUSES[1], "confirm": True},
            headers=sv_headers(surveyor_token), timeout=20,
        )
        assert r.status_code == 409, r.text
        after = mongo.phed_consumers.find_one({"id": CONSUMER_LINKED_REF_ID}, {"_id": 0})
        assert after["linked_property_id"] == before["linked_property_id"]
        assert after["linked_property_number"] == before["linked_property_number"]


    def test_receipt_visible_via_get_consumer_and_survey_consumers(self, surveyor_token, mongo):
        _reset_consumer(mongo, CONSUMER_TEST_REF_ID)
        rec = requests.post(
            f"{BASE_URL}{RECEIPT_URL_TMPL.format(ref=CONSUMER_TEST_REF_ID)}",
            json={"property_record_id": f"rec_{PID_UNASSIGNED_W1}",
                  "status": FIVE_STATUSES[2], "confirm": True},
            headers=sv_headers(surveyor_token), timeout=20,
        )
        assert rec.status_code == 200

        g = requests.get(
            f"{BASE_URL}/api/phed/consumers/{CONSUMER_TEST_REF_ID}",
            headers=sv_headers(surveyor_token), timeout=15,
        )
        assert g.status_code == 200
        assert g.json().get("office_document_receipt", {}).get("status") == FIVE_STATUSES[2]

        s = requests.get(
            f"{BASE_URL}/api/phed/survey-consumers",
            params={"search": CONSUMER_TEST_CID},
            headers=sv_headers(surveyor_token), timeout=15,
        )
        assert s.status_code == 200
        rows = s.json().get("consumers", [])
        row = next((c for c in rows if c["id"] == CONSUMER_TEST_REF_ID), None)
        assert row is not None, rows
        assert row.get("office_document_receipt", {}).get("status") == FIVE_STATUSES[2]


# --------------------------------------------------------------------------- #
# Regression invariants
# --------------------------------------------------------------------------- #
class TestRegressionInvariants:
    def test_default_employee_properties_still_assignment_scoped(self, surveyor_token):
        r = requests.get(
            f"{BASE_URL}/api/employee/properties",
            params={"search": PID_UNASSIGNED_W1, "limit": 50},
            headers=sv_headers(surveyor_token), timeout=20,
        )
        assert r.status_code == 200
        pids = [p.get("property_id") for p in r.json().get("properties", [])]
        assert PID_UNASSIGNED_W1 not in pids

    def test_legacy_property_detail_on_unassigned_denied(self, surveyor_token):
        r = requests.get(
            f"{BASE_URL}/api/employee/property/rec_{PID_UNASSIGNED_W1}",
            headers=sv_headers(surveyor_token), timeout=15,
        )
        assert r.status_code == 403

    def test_survey_draft_on_unassigned_denied(self, surveyor_token):
        # Real endpoint; must remain assignment-scoped. Backend uses
        # get_property_or_403 → must return 403 (not 400).
        r = requests.post(
            f"{BASE_URL}/api/phed/surveys/draft",
            json={"property_record_id": f"rec_{PID_UNASSIGNED_W1}",
                  "outcome": "Existing PID"},
            headers=sv_headers(surveyor_token), timeout=15,
        )
        assert r.status_code == 403, r.text

    def test_property_location_on_unassigned_denied(self, surveyor_token):
        r = requests.put(
            f"{BASE_URL}/api/phed/properties/rec_{PID_UNASSIGNED_W1}/location",
            json={"latitude": 29.98, "longitude": 76.88, "confirm": True},
            headers=sv_headers(surveyor_token), timeout=15,
        )
        assert r.status_code == 403
