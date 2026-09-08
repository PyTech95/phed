"""Backend tests for property colony search + PHED auto-link suggestions/apply."""
import os
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://phed95007-verify.preview.emergentagent.com").rstrip("/")
TOWN = "THS"


@pytest.fixture(scope="module")
def headers():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": "admin", "password": "PhedAdmin@2026"}, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    tok = j.get("token") or j.get("access_token")
    return {"Authorization": f"Bearer {tok}", "X-Town-Code": TOWN}


# --- Property search: colony should be searchable ---
def test_property_search_by_colony_didar(headers):
    r = requests.get(f"{BASE_URL}/api/admin/properties?search=Didar&page=1&limit=5",
                     headers=headers, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    total = data.get("total") or 0
    props = data.get("properties") or []
    print(f"search=Didar -> total={total}, sample colony={[p.get('colony') for p in props[:3]]}")
    assert total >= 1000, f"Expected ~1024, got {total}"
    assert props, "No property rows returned"
    assert all((p.get("colony") or "").lower().startswith("didar") for p in props[:3])


def test_property_search_other_fields_still_work(headers):
    # sample a property and search by its owner_name/property_id/mobile
    r = requests.get(f"{BASE_URL}/api/admin/properties?page=1&limit=5", headers=headers, timeout=30)
    assert r.status_code == 200
    props = r.json().get("properties") or []
    assert props
    p = props[0]
    for key in ("property_id", "owner_name", "mobile"):
        v = p.get(key)
        if not v:
            continue
        r2 = requests.get(f"{BASE_URL}/api/admin/properties?search={v}&page=1&limit=5",
                          headers=headers, timeout=30)
        assert r2.status_code == 200, r2.text
        got = r2.json().get("properties") or []
        assert got, f"search by {key}={v!r} returned nothing"
        print(f"search {key}={v!r} -> {len(got)} rows")


# --- Auto-link suggestions (SLOW: 15-25s) ---
@pytest.fixture(scope="module")
def suggestions(headers):
    r = requests.get(f"{BASE_URL}/api/phed/link-suggestions?limit=500",
                     headers=headers, timeout=90)
    assert r.status_code == 200, r.text
    return r.json()


def test_link_suggestions_shape(suggestions):
    j = suggestions
    print(f"total_unlinked={j.get('total_unlinked')}, properties_available={j.get('properties_available')}, "
          f"suggestions_count={len(j.get('suggestions', []))}")
    assert j.get("total_unlinked", 0) >= 20000
    assert j.get("properties_available", 0) >= 1000
    sug = j.get("suggestions") or []
    assert isinstance(sug, list) and len(sug) > 0, "Expected some suggestions"
    for s in sug[:3]:
        assert "consumer_ref" in s
        assert "property_record_id" in s
        assert s.get("confidence") in ("high", "medium")
        assert s.get("reason") in ("phone match", "address & name")
    # high should sort first
    confs = [s.get("confidence") for s in sug]
    if "high" in confs and "medium" in confs:
        assert confs.index("high") < confs.index("medium")


def test_link_suggestions_apply_and_persist(headers, suggestions):
    sug = suggestions.get("suggestions") or []
    if len(sug) < 2:
        pytest.skip("Not enough suggestions to apply")
    to_apply = [{"consumer_ref": s["consumer_ref"], "property_record_id": s["property_record_id"]}
                for s in sug[:2]]
    r = requests.post(f"{BASE_URL}/api/phed/link-suggestions/apply",
                      headers=headers, json={"links": to_apply}, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    print("apply response:", body)
    assert body.get("linked", 0) >= 1

    # Verify persistence
    r2 = requests.get(f"{BASE_URL}/api/phed/consumers?linked=yes&limit=5",
                      headers=headers, timeout=30)
    assert r2.status_code == 200, r2.text
    items = r2.json().get("consumers") or []
    print(f"linked=yes -> {len(items)} rows; sample linked_property={[i.get('linked_property') for i in items[:2]]}")
    assert any(i.get("linked_property") for i in items), "No consumer shows linked_property after apply"
