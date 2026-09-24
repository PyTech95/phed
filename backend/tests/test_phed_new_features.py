"""Backend tests for new PHED features: consumer deletion (single + all) and property location update."""
import os
import uuid
import pytest
import requests

BASE_URL = "https://phed-hardened-live.preview.emergentagent.com"
TOWN_CODE = "THS"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": "admin", "password": "PhedAdmin@2026"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "X-Town-Code": TOWN_CODE, "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def ward_id(admin_headers):
    r = requests.get(f"{BASE_URL}/api/phed/wards", headers=admin_headers)
    assert r.status_code == 200, r.text
    wards = r.json().get("wards", [])
    if not wards:
        # create a ward
        r = requests.post(f"{BASE_URL}/api/phed/wards", headers=admin_headers,
                          json={"ward_number": "1", "name": "Ward 1", "is_active": True, "colonies": ["Didar Nagar"]})
        assert r.status_code == 200, r.text
        return r.json()["id"]
    return wards[0]["id"]


# ---------- Single consumer delete ----------
class TestConsumerDelete:
    def test_create_and_delete_single_consumer(self, admin_headers, ward_id):
        cid = f"TEST_{uuid.uuid4().hex[:8]}"
        r = requests.post(f"{BASE_URL}/api/phed/consumers", headers=admin_headers,
                          json={"consumer_name": f"TEST_User_{cid}", "consumer_id": cid, "ward_id": ward_id})
        assert r.status_code == 200, r.text
        ref = r.json()["id"]

        # Verify GET
        g = requests.get(f"{BASE_URL}/api/phed/consumers/{ref}", headers=admin_headers)
        assert g.status_code == 200
        assert g.json()["consumer_id"] == cid

        # Delete
        d = requests.delete(f"{BASE_URL}/api/phed/consumers/{ref}", headers=admin_headers)
        assert d.status_code == 200, d.text
        assert "deleted" in d.json().get("message", "").lower()

        # Verify gone
        g2 = requests.get(f"{BASE_URL}/api/phed/consumers/{ref}", headers=admin_headers)
        assert g2.status_code == 404

    def test_delete_nonexistent_consumer(self, admin_headers):
        r = requests.delete(f"{BASE_URL}/api/phed/consumers/nonexistent-id", headers=admin_headers)
        assert r.status_code == 404


# ---------- Delete-all ----------
class TestDeleteAllConsumers:
    def test_delete_all_wrong_confirm_returns_400(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/phed/consumers/delete-all", headers=admin_headers,
                          json={"confirm": "delete"})
        assert r.status_code == 400

    def test_delete_all_non_admin_returns_403(self, admin_headers, ward_id):
        # create a surveyor via admin API
        uname = f"TEST_surv_{uuid.uuid4().hex[:6]}"
        pwd = "Passw0rd!23"
        # try common admin user creation
        r = requests.post(f"{BASE_URL}/api/admin/users", headers=admin_headers,
                          json={"username": uname, "password": pwd, "name": "TestSurveyor", "role": "SURVEYOR"})
        if r.status_code not in (200, 201):
            pytest.skip(f"Could not create surveyor: {r.status_code} {r.text}")
        # login as surveyor
        lr = requests.post(f"{BASE_URL}/api/auth/login", json={"username": uname, "password": pwd})
        assert lr.status_code == 200
        stok = lr.json()["token"]
        sh = {"Authorization": f"Bearer {stok}", "X-Town-Code": TOWN_CODE, "Content-Type": "application/json"}
        r2 = requests.post(f"{BASE_URL}/api/phed/consumers/delete-all", headers=sh, json={"confirm": "DELETE"})
        assert r2.status_code == 403

    def test_delete_all_with_ward_scope(self, admin_headers, ward_id):
        # create two consumers scoped to ward
        for i in range(2):
            cid = f"TEST_DA_{uuid.uuid4().hex[:6]}"
            r = requests.post(f"{BASE_URL}/api/phed/consumers", headers=admin_headers,
                              json={"consumer_name": f"TEST_{cid}", "consumer_id": cid, "ward_id": ward_id})
            assert r.status_code == 200
        r = requests.post(f"{BASE_URL}/api/phed/consumers/delete-all", headers=admin_headers,
                         json={"confirm": "DELETE", "ward_id": ward_id})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["deleted_consumers"] >= 2


# ---------- Property location ----------
class TestPropertyLocation:
    @pytest.fixture(scope="class")
    def property_id(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/phed/field-properties", headers=admin_headers,
                          json={"owner_name": "TEST_LocOwner", "mobile": "9999900000",
                                "ward": "1", "colony": "Didar Nagar",
                                "latitude": 29.97, "longitude": 76.83, "category": "Residential"})
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def test_update_property_location_success(self, admin_headers, property_id):
        r = requests.put(f"{BASE_URL}/api/phed/properties/{property_id}/location",
                         headers=admin_headers, json={"latitude": 29.98, "longitude": 76.84})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["latitude"] == 29.98
        assert j["longitude"] == 76.84

    def test_update_property_location_invalid_lat(self, admin_headers, property_id):
        r = requests.put(f"{BASE_URL}/api/phed/properties/{property_id}/location",
                         headers=admin_headers, json={"latitude": 999, "longitude": 76.83})
        assert r.status_code == 422

    def test_update_property_location_invalid_lng(self, admin_headers, property_id):
        r = requests.put(f"{BASE_URL}/api/phed/properties/{property_id}/location",
                         headers=admin_headers, json={"latitude": 29.98, "longitude": 999})
        assert r.status_code == 422

    def test_update_property_location_not_found(self, admin_headers):
        r = requests.put(f"{BASE_URL}/api/phed/properties/nonexistent/location",
                         headers=admin_headers, json={"latitude": 29.98, "longitude": 76.84})
        assert r.status_code == 404
