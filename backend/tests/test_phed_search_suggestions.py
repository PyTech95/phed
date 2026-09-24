"""Backend tests for PHED consumer search + ranked suggestion endpoint."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or "https://phed95007-verify.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")
TOWN = "THS"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": "admin", "password": "PhedAdmin@2026"}, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    return j.get("token") or j.get("access_token")


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "X-Town-Code": TOWN}


def test_consumers_list_populated(headers):
    r = requests.get(f"{BASE_URL}/api/phed/consumers?page=1&limit=1", headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    # Expect ~26407 consumers
    total = data.get("total") or data.get("count") or len(data.get("items", []))
    print(f"Total consumers: {total}")
    assert total >= 26000, f"Expected ~26407 consumers, got {total}"


def test_consumers_list_search_ram(headers):
    r = requests.get(f"{BASE_URL}/api/phed/consumers?search=RAM&page=1&limit=25",
                     headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    items = data.get("consumers") or data.get("items", [])
    assert len(items) > 0, "Search 'RAM' returned zero items"
    print(f"list search RAM -> {len(items)} items, total={data.get('total')}")


def test_ranked_search_prefix_ram(headers):
    r = requests.get(f"{BASE_URL}/api/phed/consumers/search?q=RAM&limit=8",
                     headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    results = data.get("results", [])
    assert len(results) > 0, "Ranked search 'RAM' returned nothing"
    # First few should start with RAM
    names = [(c.get("consumer_name") or "").upper() for c in results]
    print("Top RAM suggestions:", names[:8])
    starts = [n for n in names[:5] if n.startswith("RAM")]
    assert len(starts) >= 2, f"Expected top results starting with RAM, got {names[:5]}"


def test_ranked_search_exact_consumer_id(headers):
    # First get any consumer_id
    r = requests.get(f"{BASE_URL}/api/phed/consumers?page=1&limit=5", headers=headers, timeout=30)
    items = r.json().get("consumers") or r.json().get("items", [])
    cid = None
    for it in items:
        if it.get("consumer_id"):
            cid = it["consumer_id"]
            break
    if not cid:
        pytest.skip("No consumer_id present in sample")
    r2 = requests.get(f"{BASE_URL}/api/phed/consumers/search?q={cid}&limit=8",
                      headers=headers, timeout=30)
    assert r2.status_code == 200, r2.text
    results = r2.json().get("results", [])
    assert results and results[0].get("match") == "exact"
    assert results[0].get("consumer_id") == cid


def test_admin_properties_didar_nagar(headers):
    r = requests.get(f"{BASE_URL}/api/admin/properties?page=1&limit=5", headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    total = data.get("total") or data.get("count") or 0
    props = data.get("properties") or data.get("items") or []
    print(f"Total properties: {total}, sample colonies: {[p.get('colony') for p in props[:5]]}")
    assert total >= 1000, f"Expected ~1024 properties, got {total}"
    # verify Didar Nagar colony present
    assert any((p.get("colony") or "").lower().startswith("didar") for p in props), \
        "No 'Didar Nagar' colony in first page of properties"


def test_admin_properties_filter_didar_nagar(headers):
    for param in ("colony=Didar Nagar", "search=Didar", "colony=Didar"):
        r = requests.get(f"{BASE_URL}/api/admin/properties?{param}&page=1&limit=5",
                         headers=headers, timeout=30)
        if r.status_code == 200:
            data = r.json()
            props = data.get("properties") or data.get("items") or []
            total = data.get("total") or 0
            print(f"filter {param!r} -> total={total}, n={len(props)}")
            if props:
                return
    pytest.fail("No filter param (colony=Didar Nagar / search=Didar) returned Didar Nagar properties")
