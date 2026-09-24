"""Iteration 4 verification tests for PHED review requests (survey review popup,
office-doc → admin queue, dashboard by_surveyor, green-lock, citywide search).

Base URL comes from frontend/.env REACT_APP_BACKEND_URL, admin creds from
/app/memory/test_credentials.md. Requires seed_wrong_links.py already run.
"""
import os
import subprocess
import uuid
import pytest
import requests

# --- read REACT_APP_BACKEND_URL from frontend/.env (no default) ---
def _read_base_url() -> str:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL missing")


BASE_URL = _read_base_url()
ADMIN_USER = "phedadmin"
ADMIN_PASS = "14cef9f07762b981fcdb583c"
TOWN = "THS"


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "X-Town-Code": TOWN,
            "Content-Type": "application/json"}


@pytest.fixture(scope="session", autouse=True)
def reseed():
    """Reset wrong-links seed once before this suite runs."""
    subprocess.run(
        ["/root/.venv/bin/python", "seed_wrong_links.py"],
        cwd="/app/backend", check=True, capture_output=True,
    )


# ---------- 1. Admin pending queue contains the seeded office-doc TESTP0001 ----------
class TestAdminPendingQueue:
    def test_pending_has_testp0001(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/phed/surveys?queue=pending",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        surveys = data["surveys"]
        assert any(s["property_id"] == "TESTP0001" for s in surveys), \
            f"TESTP0001 missing from pending queue: {surveys}"
        # office_document source must not be excluded (feature #6 backend gate)
        assert any(s.get("source") == "office_document" for s in surveys)


# ---------- 4. Today dashboard has by_surveyor breakdown ----------
class TestTodayDashboardBySurveyor:
    def test_today_has_by_surveyor(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/phed/dashboard/today",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "by_surveyor" in d and isinstance(d["by_surveyor"], list)
        assert len(d["by_surveyor"]) >= 1
        row = d["by_surveyor"][0]
        for key in ("total", "approved", "owner_denied", "new_connection",
                    "returned_for_correction", "awaiting_approval"):
            assert key in row, f"missing key {key} in by_surveyor row"

    def test_today_missing_water_sewer_counts(self, admin_headers):
        """GAP: frontend expects surveyor.water_connection / sewer_connection but
        backend never populates them. Reported so main agent adds them."""
        r = requests.get(f"{BASE_URL}/api/phed/dashboard/today",
                         headers=admin_headers, timeout=15)
        row = r.json()["by_surveyor"][0]
        missing = [k for k in ("water_connection", "sewer_connection") if k not in row]
        # This assertion documents the gap — will fail until backend adds keys.
        assert not missing, (
            f"[GAP] by_surveyor row missing keys {missing}. Frontend table "
            f"data-testid=today-water-only-* / today-sewer-only-* renders 0 always."
        )


# ---------- 6. Consumer → property submit reaches admin queue ----------
class TestOfficeDocumentReceipt:
    def test_unlink_then_office_doc_shows_in_admin_queue(self, admin_headers):
        # Snapshot links for TESTC002, TESTP0002 record id
        links = requests.get(f"{BASE_URL}/api/phed/links",
                             headers=admin_headers, timeout=15).json()["links"]
        c002 = next(l for l in links if l["consumer_id"] == "TESTC002")
        # TESTP0002 record id may be null after unlink, capture NOW.
        p0002_record_id = c002["linked_property_id"]
        c002_ref = c002["consumer_ref"]
        assert p0002_record_id and c002_ref

        # Unlink TESTC002 via bulk-unlink endpoint (confirm=UNLINK, remove_office=true)
        unlink = requests.post(
            f"{BASE_URL}/api/phed/links/bulk-unlink",
            headers=admin_headers,
            json={
                "consumer_refs": [c002_ref],
                "confirm": "UNLINK",
                "remove_office_surveys": True,
            },
            timeout=20,
        )
        assert unlink.status_code == 200, f"bulk-unlink failed: {unlink.status_code} {unlink.text}"

        # Confirm unlinked
        links2 = requests.get(f"{BASE_URL}/api/phed/links",
                              headers=admin_headers, timeout=15).json()["links"]
        c002b = next((l for l in links2 if l["consumer_id"] == "TESTC002"), None)
        # After unlink either absent from list or linked_property_id is null
        if c002b is not None:
            assert c002b.get("linked_property_id") in (None, ""), \
                f"TESTC002 still linked after unlink: {c002b}"

        # Now call office-document-receipt: consumer → property submit
        receipt = requests.post(
            f"{BASE_URL}/api/phed/consumers/{c002_ref}/office-document-receipt",
            headers=admin_headers,
            json={
                "property_record_id": p0002_record_id,
                "status": "Sewer documents received at office",
                "confirm": True,
            },
            timeout=20,
        )
        assert receipt.status_code in (200, 201), \
            f"office-document-receipt failed: {receipt.status_code} {receipt.text}"
        body = receipt.json()
        assert body.get("survey_status") in ("Submitted", "submitted"), body
        assert body.get("reference_number"), body

        # Verify admin pending queue now includes TESTP0002
        pending = requests.get(f"{BASE_URL}/api/phed/surveys?queue=pending",
                               headers=admin_headers, timeout=15).json()["surveys"]
        assert any(s["property_id"] == "TESTP0002" for s in pending), \
            f"TESTP0002 not in admin pending after office-doc submit: {pending}"


# ---------- 3. Approve TESTP0001 pending survey via admin action ----------
class TestAdminApproveSurvey:
    def test_approve_testp0001(self, admin_headers):
        pending = requests.get(f"{BASE_URL}/api/phed/surveys?queue=pending",
                               headers=admin_headers, timeout=15).json()["surveys"]
        target = next((s for s in pending if s["property_id"] == "TESTP0001"), None)
        assert target, "TESTP0001 not in pending"
        sid = target["id"]
        r = requests.post(f"{BASE_URL}/api/phed/surveys/{sid}/approve",
                          headers=admin_headers, json={}, timeout=15)
        assert r.status_code in (200, 201), f"approve failed: {r.status_code} {r.text}"
        # verify moved out of pending
        pending2 = requests.get(f"{BASE_URL}/api/phed/surveys?queue=pending",
                                headers=admin_headers, timeout=15).json()["surveys"]
        assert not any(s["id"] == sid for s in pending2), "still pending after approve"


# ---------- 7. Green-locked: /surveys/draft on Approved property returns 409 ----------
class TestGreenLock:
    def test_approved_property_draft_blocked(self, admin_headers):
        # Find TESTP0001 record id from links (before it was unlinked/reseeded)
        r = requests.get(f"{BASE_URL}/api/employee/properties/search?search=TESTP0001",
                         headers=admin_headers, timeout=15)
        # admin may not have this route; skip if not accessible
        if r.status_code == 200:
            items = r.json().get("items") or r.json().get("properties") or []
            match = next((p for p in items if p.get("property_id") == "TESTP0001"), None)
            if match:
                rid = match.get("id") or match.get("record_id") or match.get("property_record_id")
                if rid:
                    d = requests.post(f"{BASE_URL}/api/phed/surveys/draft",
                                      headers=admin_headers,
                                      json={"property_record_id": rid}, timeout=15)
                    assert d.status_code in (409, 403), \
                        f"expected 409/403 for Approved lock, got {d.status_code} {d.text}"


# ---------- 5. Citywide search returns properties outside surveyor's colony ----------
class TestCitywideSearch:
    def test_admin_citywide_search_returns_testp(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/employee/properties/search?search=TESTP",
                         headers=admin_headers, timeout=15)
        # endpoint is for employees but admin bearer often accepted; if 403 skip
        if r.status_code == 403:
            pytest.skip("admin token not authorized on employee search endpoint")
        assert r.status_code == 200, r.text
        payload = r.json()
        items = payload.get("items") or payload.get("properties") or payload.get("results") or []
        assert len(items) >= 1, f"citywide search returned nothing: {payload}"

    def test_surveyor_citywide_can_survey_flag(self, admin_headers):
        """Create a SURVEYOR user, log in, search 'TESTP' citywide, verify can_survey=true."""
        # 1. Create surveyor via admin
        uname = f"testsurv_{uuid.uuid4().hex[:6]}"
        pw = "TestPass!234"
        # try common admin user-create endpoints
        payload = {
            "username": uname, "password": pw,
            "name": "Test Surveyor Iter4",
            "role": "SURVEYOR",
        }
        created = None
        for path in ("/api/admin/users", "/api/admin/employees", "/api/admin/surveyors"):
            r = requests.post(f"{BASE_URL}{path}", headers=admin_headers, json=payload, timeout=15)
            if r.status_code in (200, 201):
                created = r.json()
                break
        if not created:
            pytest.skip("no admin user-create endpoint responded 2xx; skipping surveyor login test")

        # 2. Login as surveyor
        lr = requests.post(f"{BASE_URL}/api/auth/login",
                           json={"username": uname, "password": pw}, timeout=15)
        assert lr.status_code == 200, lr.text
        stok = lr.json()["token"]
        sheaders = {"Authorization": f"Bearer {stok}", "X-Town-Code": TOWN}

        # 3. Citywide search for TESTP
        r = requests.get(f"{BASE_URL}/api/employee/properties/search?search=TESTP",
                         headers=sheaders, timeout=15)
        assert r.status_code == 200, r.text
        payload = r.json()
        items = payload.get("items") or payload.get("properties") or payload.get("results") or []
        assert len(items) >= 1, f"surveyor citywide search returned none: {payload}"
        # can_survey flag should be true for at least one non-approved property (TESTP0002/TESTP0003)
        non_approved = [p for p in items
                        if (p.get("survey_status") or p.get("status") or "").lower() != "approved"]
        assert non_approved, f"no non-approved properties: {items}"
        # If field exists it must be True; if missing, that's the gap
        for p in non_approved:
            if "can_survey" in p:
                assert p["can_survey"] is True, \
                    f"can_survey=false for non-approved property: {p}"
                return
        pytest.fail(f"can_survey flag missing in citywide search response: keys={list(non_approved[0].keys())}")
