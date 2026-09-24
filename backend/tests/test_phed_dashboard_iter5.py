"""Iteration 5 — verify per-surveyor connection-type counts fix in
GET /api/phed/dashboard/today (water_connection/sewer_connection/
already_connection/death_transfer/ownership_change).
"""
import os
import subprocess
import pytest
import requests


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
CONN_KEYS = (
    "water_connection",
    "sewer_connection",
    "already_connection",
    "death_transfer",
    "ownership_change",
)


@pytest.fixture(scope="session")
def admin_headers():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_USER, "password": ADMIN_PASS},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {
        "Authorization": f"Bearer {r.json()['token']}",
        "X-Town-Code": TOWN,
        "Content-Type": "application/json",
    }


@pytest.fixture(scope="session", autouse=True)
def reseed():
    subprocess.run(
        ["/root/.venv/bin/python", "seed_wrong_links.py"],
        cwd="/app/backend",
        check=True,
        capture_output=True,
    )


@pytest.mark.parametrize("scope", ["today", "all"])
def test_summary_has_connection_keys(admin_headers, scope):
    r = requests.get(
        f"{BASE_URL}/api/phed/dashboard/today?scope={scope}",
        headers=admin_headers,
        timeout=15,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert "summary" in d and "by_surveyor" in d and "recent_surveys" in d
    for k in CONN_KEYS:
        assert k in d["summary"], f"summary missing {k} (scope={scope})"
        assert isinstance(d["summary"][k], int)


@pytest.mark.parametrize("scope", ["today", "all"])
def test_by_surveyor_rows_have_connection_keys(admin_headers, scope):
    r = requests.get(
        f"{BASE_URL}/api/phed/dashboard/today?scope={scope}",
        headers=admin_headers,
        timeout=15,
    )
    assert r.status_code == 200, r.text
    rows = r.json()["by_surveyor"]
    assert isinstance(rows, list)
    for row in rows:
        for k in CONN_KEYS:
            assert k in row, f"by_surveyor row {row.get('id')} missing {k} (scope={scope})"
            assert isinstance(row[k], int) and row[k] >= 0


def test_by_surveyor_counts_sum_to_summary_all(admin_headers):
    """Per-surveyor connection counts should sum to summary connection counts."""
    r = requests.get(
        f"{BASE_URL}/api/phed/dashboard/today?scope=all",
        headers=admin_headers,
        timeout=15,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    for k in CONN_KEYS:
        by_sum = sum(row.get(k, 0) for row in d["by_surveyor"])
        assert by_sum == d["summary"][k], (
            f"Sum mismatch for {k}: by_surveyor={by_sum} summary={d['summary'][k]}"
        )


def test_seed_survey_present_in_by_surveyor(admin_headers):
    """seed_wrong_links.py creates 1 office survey under surveyor 'seed'."""
    r = requests.get(
        f"{BASE_URL}/api/phed/dashboard/today?scope=all",
        headers=admin_headers,
        timeout=15,
    )
    rows = r.json()["by_surveyor"]
    seed_row = next((row for row in rows if row.get("id") == "seed"), None)
    assert seed_row, f"seed surveyor row missing: {rows}"
    for k in CONN_KEYS:
        assert k in seed_row and isinstance(seed_row[k], int) and seed_row[k] >= 0
