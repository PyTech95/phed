"""Iteration 2 — PHED bulk unlink / link cleanup tests.
Covers GET /api/phed/links, POST /api/phed/links/bulk-unlink, safety + regression.
"""
import os
import subprocess
import pytest
import requests

# xdist: pin all tests in this module to one worker to avoid reseed races
pytestmark = pytest.mark.xdist_group(name="phed_link_cleanup")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://stack-preview-phed.preview.emergentagent.com").rstrip("/")
ADMIN_USER = "phedadmin"
ADMIN_PASS = "14cef9f07762b981fcdb583c"


def _reseed():
    subprocess.run(
        ["/root/.venv/bin/python", "seed_wrong_links.py"],
        cwd="/app/backend", check=True, capture_output=True)


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return tok


@pytest.fixture
def admin(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(autouse=True)
def reseed_before_each():
    _reseed()
    yield


# ---------------- Auth / safety ----------------
class TestSafety:
    def test_get_links_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/phed/links", timeout=10)
        assert r.status_code in (401, 403), r.text

    def test_bulk_unlink_requires_confirm(self, admin):
        r = admin.post(f"{BASE_URL}/api/phed/links/bulk-unlink",
                       json={"consumer_refs": ["fake"], "confirm": ""})
        assert r.status_code == 400
        assert "UNLINK" in r.text

    def test_bulk_unlink_empty_selection(self, admin):
        r = admin.post(f"{BASE_URL}/api/phed/links/bulk-unlink",
                       json={"consumer_refs": [], "confirm": "UNLINK"})
        assert r.status_code == 400


# ---------------- Listing ----------------
class TestListLinks:
    def test_list_contains_seeded(self, admin):
        r = admin.get(f"{BASE_URL}/api/phed/links?limit=200")
        assert r.status_code == 200, r.text
        data = r.json()
        links = data["links"]
        ids = {l["consumer_id"]: l for l in links}
        for cid in ("TESTC001", "TESTC002", "TESTC003"):
            assert cid in ids, f"{cid} missing"
        assert ids["TESTC001"]["link_source"] == "office"
        assert ids["TESTC001"]["has_office_survey"] is True
        assert ids["TESTC001"]["property_survey_status"] == "Submitted"
        assert ids["TESTC002"]["link_source"] == "import"
        assert ids["TESTC003"]["link_source"] == "manual/bulk"

    def test_filter_by_link_source_office(self, admin):
        r = admin.get(f"{BASE_URL}/api/phed/links?link_source=office&limit=200")
        assert r.status_code == 200
        for l in r.json()["links"]:
            assert l["link_source"] == "office"


# ---------------- Unlink flows ----------------
def _get_ref(admin, consumer_id):
    r = admin.get(f"{BASE_URL}/api/phed/links?search={consumer_id}&limit=50")
    for l in r.json()["links"]:
        if l["consumer_id"] == consumer_id:
            return l["consumer_ref"], l["linked_property_id"]
    raise AssertionError(f"{consumer_id} not found in links")


class TestBulkUnlink:
    def test_unlink_manual_single(self, admin):
        ref, _ = _get_ref(admin, "TESTC003")
        r = admin.post(f"{BASE_URL}/api/phed/links/bulk-unlink",
                       json={"consumer_refs": [ref], "confirm": "UNLINK"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["unlinked"] == 1
        # verify: link gone from listing
        after = admin.get(f"{BASE_URL}/api/phed/links?limit=200").json()["links"]
        assert not any(l["consumer_id"] == "TESTC003" for l in after)

    def test_unlink_office_unblocks_property(self, admin):
        ref, prop_id = _get_ref(admin, "TESTC001")
        r = admin.post(f"{BASE_URL}/api/phed/links/bulk-unlink",
                       json={"consumer_refs": [ref], "confirm": "UNLINK",
                             "remove_office_surveys": True})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["unlinked"] == 1
        assert body["office_surveys_removed"] >= 1
        assert body["properties_unblocked"] >= 1
        # link removed
        after = admin.get(f"{BASE_URL}/api/phed/links?limit=200").json()["links"]
        assert not any(l["consumer_id"] == "TESTC001" for l in after)
        # property survey status cleared
        pr = admin.get(f"{BASE_URL}/api/phed/property/{prop_id}")
        if pr.status_code == 200:
            prop = pr.json()
            # under 'property' key or top level
            p = prop.get("property", prop)
            assert not p.get("phed_survey_status")

    def test_unlink_all_matching(self, admin):
        r = admin.post(f"{BASE_URL}/api/phed/links/bulk-unlink",
                       json={"all_matching": True, "confirm": "UNLINK"})
        assert r.status_code == 200, r.text
        after = admin.get(f"{BASE_URL}/api/phed/links?limit=200").json()
        # Only our seeded 3 exist in a fresh test DB; but in general assert seeded are gone
        remaining_ids = {l["consumer_id"] for l in after["links"]}
        assert not (remaining_ids & {"TESTC001", "TESTC002", "TESTC003"})


# ---------------- Regression: single unlink endpoint ----------------
class TestRegression:
    def test_single_unlink_endpoint(self, admin):
        ref, _ = _get_ref(admin, "TESTC002")
        r = admin.post(f"{BASE_URL}/api/phed/consumers/{ref}/unlink", json={})
        assert r.status_code == 200, r.text
