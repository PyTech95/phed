"""Backend regression: PHED import + shared connection-number uniqueness (per consumer)."""
import io
import os
import time
import uuid
import pytest
import requests
from openpyxl import Workbook

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://phed-hardened-live.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
TOWN = "THS"
ADMIN_USER = "admin"
ADMIN_PASS = "PhedAdmin@2026"

# unique suffix so multiple runs don't collide
SUF = uuid.uuid4().hex[:8].upper()
CID_A = f"TESTA{SUF}"   # will share Water '3' and Sewer '1' with CID_B
CID_B = f"TESTB{SUF}"
CID_C = f"TESTC{SUF}"   # duplicated row in file, same connection


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"X-Town-Code": TOWN})
    r = s.post(f"{API}/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    token = r.json().get("token") or r.json().get("access_token")
    assert token, r.text
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def ward_id(session):
    r = session.get(f"{API}/phed/wards", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    wards = body.get("wards") if isinstance(body, dict) else body
    assert wards, "no wards"
    return wards[0]["id"]


def _build_xlsx() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Consumers"
    headers = [
        "Consumer Name", "F/H Name", "Head of Family in PPP", "Address",
        "Locality", "Phone No.", "Consumer ID",
        "Water Connection No.", "Sewer Connection No.", "Type of Connection",
    ]
    ws.append(headers)
    # Row 1: CID_A shares Water '3', Sewer '1'
    ws.append(["Ram Test", "Shyam", "Ram Test", "H.1 Test Colony", "TESTZONE", "9990000001", CID_A, "3", "1", "Domestic"])
    # Row 2: CID_B shares same Water '3' and Sewer '1' — must NOT conflict
    ws.append(["Sita Test", "Mohan", "Sita Test", "H.2 Test Colony", "TESTZONE", "9990000002", CID_B, "3", "1", "Domestic"])
    # Row 3: CID_C with Water '77'
    ws.append(["Gopal Test", "Hari", "Gopal Test", "H.3 Test Colony", "TESTZONE", "9990000003", CID_C, "77", "", "Domestic"])
    # Row 4: CID_C duplicated with SAME Water '77' — must be counted as conflict (same consumer+svc+num twice in file)
    ws.append(["Gopal Test", "Hari", "Gopal Test", "H.3 Test Colony", "TESTZONE", "9990000003", CID_C, "77", "", "Domestic"])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


def _cleanup(session, refs):
    for ref in refs:
        try:
            session.delete(f"{API}/phed/consumers/{ref}", timeout=30)
        except Exception:
            pass


def test_import_validate_and_commit_shared_connection_numbers(session, ward_id):
    xlsx = _build_xlsx()
    files = {"file": ("shared_test.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    data = {"ward_id": ward_id, "default_colony": "TESTZONE", "mode": "import_and_update"}
    r = session.post(f"{API}/phed/import/validate", files=files, data=data, timeout=60)
    assert r.status_code == 200, r.text
    v = r.json()
    import_id = v["id"]
    counts = v["counts"]
    print("VALIDATE counts:", counts)

    # Shared connection numbers across DIFFERENT consumers must NOT be counted as conflicts
    # Only the exact duplicate row (same consumer+service+number) is a conflict → 1 conflict for row 4
    assert counts["conflicts"] == 1, f"expected 1 conflict (row4 same consumer duplicate); got {counts}"
    assert counts["shared_connection_numbers"] >= 2, f"expected >=2 shared (Water 3 + Sewer 1); got {counts}"
    # new_water_connections should count distinct (consumer, num) — 3 rows had Water: (A,3),(B,3),(C,77) => 3
    # (row 4 for C,77 is filtered as duplicate before counting new)
    assert counts["new_water_connections"] == 3, counts
    # sewer: (A,1),(B,1) => 2
    assert counts["new_sewer_connections"] == 2, counts

    # Commit
    r = session.post(f"{API}/phed/import/{import_id}/commit", timeout=60)
    assert r.status_code == 200, r.text

    # Poll until Completed
    result = None
    for _ in range(60):
        rr = session.get(f"{API}/phed/import/{import_id}", timeout=30)
        assert rr.status_code == 200, rr.text
        body = rr.json()
        if body.get("status") == "Completed":
            result = body.get("result")
            break
        time.sleep(1)
    assert result, f"import did not complete: {body}"
    print("IMPORT result:", result)

    # Expect 5 connections created: (A,W,3),(A,S,1),(B,W,3),(B,S,1),(C,W,77)
    assert result["created_consumers"] == 3, result
    assert result["created_connections"] == 5, result
    # skipped_connections should be 1 (row 4 duplicate in file, tagged as conflict pre-commit)
    assert result["skipped_connections"] == 1, result

    # Verify both A and B carry Water '3' (lookup internal ref via search endpoint)
    refs = []
    for cid in (CID_A, CID_B, CID_C):
        rs = session.get(f"{API}/phed/consumers/search", params={"q": cid}, timeout=30)
        assert rs.status_code == 200, rs.text
        hits = rs.json().get("results") or []
        assert hits, f"search returned no results for {cid}"
        ref = hits[0]["id"]
        r = session.get(f"{API}/phed/consumers/{ref}", timeout=30)
        assert r.status_code == 200, f"{cid} ref={ref}: {r.status_code} {r.text}"
        c = r.json()
        refs.append(c["id"])
        conns = c.get("connections") or []
        nums = {(x["service"], str(x["connection_number"])) for x in conns if x.get("is_active", True)}
        if cid in (CID_A, CID_B):
            assert ("Water", "3") in nums, f"{cid} missing Water 3: {nums}"
            assert ("Sewer", "1") in nums, f"{cid} missing Sewer 1: {nums}"
        else:
            assert ("Water", "77") in nums, nums

    # Manual add-connection: give C a Water '3' (shared with A,B) — must succeed
    ref_c = refs[2]
    r = session.post(f"{API}/phed/consumers/{ref_c}/connections",
                     json={"service": "Water", "connection_number": "3", "category": "Domestic"}, timeout=30)
    assert r.status_code == 200, f"add shared Water 3 to C should succeed: {r.status_code} {r.text}"

    # Second post with same number for same consumer must 409
    r2 = session.post(f"{API}/phed/consumers/{ref_c}/connections",
                      json={"service": "Water", "connection_number": "3", "category": "Domestic"}, timeout=30)
    assert r2.status_code == 409, f"duplicate for SAME consumer should 409: {r2.status_code} {r2.text}"

    # cleanup
    _cleanup(session, refs)
    # verify deletion of one
    rs = session.get(f"{API}/phed/consumers/search", params={"q": CID_A}, timeout=30)
    hits = rs.json().get("results") or []
    assert not any(h.get("consumer_id_norm") == CID_A.upper() or h.get("consumer_id") == CID_A for h in hits), \
        f"expected {CID_A} to be deleted: {hits}"


def test_dashboard_totals(session):
    r = session.get(f"{API}/phed/dashboard", timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    print("DASHBOARD:", {k: d.get(k) for k in ("total_consumers", "water_connections", "sewer_connections")})
    assert d.get("water_connections", 0) >= 26365, d
    assert d.get("sewer_connections", 0) >= 13243, d
    assert d.get("total_consumers", 0) >= 26407, d
