"""Backend tests for surveyor pin-drag flow (iteration_7).

Tests:
- Surveyor can login (surveyor1 / Survey@2026)
- Surveyor can create a field property (POST /api/phed/field-properties)
- Surveyor can update location on OWN property (PUT /api/phed/properties/{id}/location) -> 200
- Surveyor gets 403 when trying to update a property that is not assigned to them
"""
import os
import uuid
import pytest
import requests

BASE_URL = "https://phed-hardened-live.preview.emergentagent.com"
TOWN = "THS"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": "admin", "password": "PhedAdmin@2026"})
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    return {"Authorization": f"Bearer {tok}", "X-Town-Code": TOWN, "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def surveyor_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": "surveyor1", "password": "Survey@2026"})
    assert r.status_code == 200, f"Surveyor login failed: {r.text}"
    tok = r.json()["token"]
    return {"Authorization": f"Bearer {tok}", "X-Town-Code": TOWN, "Content-Type": "application/json"}


class TestSurveyorPinDrag:
    def test_surveyor_can_login(self, surveyor_headers):
        assert "Authorization" in surveyor_headers

    def test_surveyor_creates_own_property_and_updates_location(self, surveyor_headers):
        # Create property as surveyor
        payload = {
            "owner_name": f"TEST_pin_{uuid.uuid4().hex[:6]}",
            "mobile": "9999900001",
            "ward": "1",
            "colony": "Didar Nagar",
            "address": "pin-test",
            "latitude": 29.97,
            "longitude": 76.83,
            "category": "Residential",
        }
        r = requests.post(f"{BASE_URL}/api/phed/field-properties",
                          headers=surveyor_headers, json=payload)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]

        # Update location on own property
        upd = requests.put(f"{BASE_URL}/api/phed/properties/{pid}/location",
                           headers=surveyor_headers,
                           json={"latitude": 29.9705, "longitude": 76.8305})
        assert upd.status_code == 200, upd.text
        j = upd.json()
        assert abs(j["latitude"] - 29.9705) < 1e-6
        assert abs(j["longitude"] - 76.8305) < 1e-6

    def test_surveyor_gets_403_on_not_own_property(self, admin_headers, surveyor_headers):
        # Admin creates a property (not assigned to surveyor1)
        payload = {
            "owner_name": f"TEST_admin_{uuid.uuid4().hex[:6]}",
            "mobile": "9999900002",
            "ward": "1",
            "colony": "Didar Nagar",
            "address": "admin-only",
            "latitude": 29.98,
            "longitude": 76.84,
            "category": "Residential",
            # deliberately no surveyor assignment
        }
        r = requests.post(f"{BASE_URL}/api/phed/field-properties",
                          headers=admin_headers, json=payload)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        assigned_to = r.json().get("assigned_to")

        # If admin's field-property somehow auto-assigns to surveyor1 (unlikely) skip
        if assigned_to == "surveyor1":
            pytest.skip("Admin-created property auto-assigned to surveyor1; cannot test 403")

        upd = requests.put(f"{BASE_URL}/api/phed/properties/{pid}/location",
                           headers=surveyor_headers,
                           json={"latitude": 29.99, "longitude": 76.85})
        assert upd.status_code == 403, f"Expected 403, got {upd.status_code}: {upd.text}"

    def test_invalid_lat_lng_422(self, surveyor_headers):
        # Create a property first
        payload = {
            "owner_name": f"TEST_val_{uuid.uuid4().hex[:6]}", "mobile": "9999900003",
            "ward": "1", "colony": "Didar Nagar", "latitude": 29.97, "longitude": 76.83,
            "category": "Residential",
        }
        r = requests.post(f"{BASE_URL}/api/phed/field-properties",
                          headers=surveyor_headers, json=payload)
        pid = r.json()["id"]
        r2 = requests.put(f"{BASE_URL}/api/phed/properties/{pid}/location",
                          headers=surveyor_headers, json={"latitude": 999, "longitude": 76.83})
        assert r2.status_code == 422
