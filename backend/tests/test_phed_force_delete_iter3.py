"""Iter3: force-delete legacy office import batch API + safety."""
import os
import subprocess
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else "https://stack-preview-phed.preview.emergentagent.com"
# frontend .env is what test agent must use
with open("/app/frontend/.env") as f:
    for line in f:
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE = line.split("=", 1)[1].strip().rstrip("/")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
BATCH_ID = "legacy-office-batch-test"
FILENAME = "legacy_office_wrong.xlsx"

ADMIN_USER = "phedadmin"
ADMIN_PASS = "14cef9f07762b981fcdb583c"


def reseed():
    subprocess.run(["/root/.venv/bin/python", "/app/backend/seed_legacy_office_batch.py"], check=True)


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture()
def db():
    return MongoClient(MONGO_URL)[DB_NAME]


def test_1_preview_blocked_without_force(admin_headers):
    reseed()
    r = requests.get(f"{BASE}/api/phed/import-batches/office/{BATCH_ID}/deletion-preview", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    print("preview no-force:", data)
    assert len(data["blocked"]) >= 2
    assert any("no restore snapshot" in b for b in data["blocked"])


def test_2_preview_unblocked_with_force(admin_headers):
    r = requests.get(f"{BASE}/api/phed/import-batches/office/{BATCH_ID}/deletion-preview?force=true", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    print("preview force:", data)
    assert data["blocked"] == []
    assert data["remove"] >= 3


def test_3_safety_force_wrong_confirmation(admin_headers):
    r = requests.delete(f"{BASE}/api/phed/import-batches/office/{BATCH_ID}",
                        headers=admin_headers, json={"confirmation": "wrong.xlsx", "force": True}, timeout=15)
    assert r.status_code == 400, r.text


def test_4_safety_no_force_still_blocked(admin_headers):
    r = requests.delete(f"{BASE}/api/phed/import-batches/office/{BATCH_ID}",
                        headers=admin_headers, json={"confirmation": FILENAME, "force": False}, timeout=15)
    assert r.status_code == 409, r.text


def test_5_non_admin_forbidden():
    r = requests.get(f"{BASE}/api/phed/import-batches/office/{BATCH_ID}/deletion-preview", timeout=15)
    assert r.status_code in (401, 403)


def test_6_force_delete_success_and_db_state(admin_headers, db):
    r = requests.delete(f"{BASE}/api/phed/import-batches/office/{BATCH_ID}",
                        headers=admin_headers, json={"confirmation": FILENAME, "force": True}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    print("delete result:", data)
    assert data.get("deleted", 0) >= 3

    # DB verification
    remaining = db.phed_surveys.count_documents({"office_batch_id": BATCH_ID})
    assert remaining == 0

    for i in (1, 2, 3):
        p = db.properties.find_one({"property_id": f"LEGP000{i}"})
        assert p is not None
        assert p.get("phed_survey_status") == "Not Started", f"LEGP000{i}: {p.get('phed_survey_status')}"
        assert p.get("phed_outcome") in (None, "")
        assert p.get("phed_survey_source") in (None, "")

    batch = db.phed_office_imports.find_one({"id": BATCH_ID})
    assert batch and batch.get("status") == "Deleted"
