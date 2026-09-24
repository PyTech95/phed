"""Iter 11 - verify /api/phed/survey-consumers no longer geo-filters for surveyors."""
import os
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://phed-ops.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"username": "admin", "password": "Phed#Admin2026!"}
SURVEYOR = {"username": "surveyor1", "password": "Survey@2026"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login {creds['username']} failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


def test_anonymous_denied():
    r = requests.get(f"{API}/phed/survey-consumers", params={"link_status": "unlinked", "limit": 40}, timeout=20)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


def test_admin_and_surveyor_see_same_queue():
    admin_tok = _login(ADMIN)
    surv_tok = _login(SURVEYOR)

    ra = requests.get(f"{API}/phed/survey-consumers",
                     params={"link_status": "unlinked", "limit": 40},
                     headers=_hdr(admin_tok), timeout=20)
    rs = requests.get(f"{API}/phed/survey-consumers",
                     params={"link_status": "unlinked", "limit": 40},
                     headers=_hdr(surv_tok), timeout=20)
    assert ra.status_code == 200, ra.text
    assert rs.status_code == 200, rs.text
    da, ds = ra.json(), rs.json()
    assert da["total"] == ds["total"], f"admin total {da['total']} != surveyor {ds['total']}"
    assert ds["total"] >= 1, f"surveyor total should be >=1, got {ds['total']}"
    # at least one non-survey source
    sources = {c.get("source") for c in ds["consumers"]}
    assert any(s and s != "survey" for s in sources), f"expected non-survey source, got {sources}"
    # Suman/4326479 visible
    ids = [c.get("consumer_id") for c in ds["consumers"]]
    assert "4326479" in ids, f"consumer_id 4326479 not found in surveyor queue, got {ids}"


def test_search_by_name_and_consumer_id():
    tok = _login(SURVEYOR)
    for term in ("Suman", "4326479"):
        r = requests.get(f"{API}/phed/survey-consumers",
                        params={"link_status": "unlinked", "search": term, "limit": 40},
                        headers=_hdr(tok), timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["total"] >= 1, f"search '{term}' returned 0"
        assert any(c.get("consumer_id") == "4326479" for c in d["consumers"]), \
            f"search '{term}' did not include 4326479"


def test_invalid_link_status():
    tok = _login(SURVEYOR)
    r = requests.get(f"{API}/phed/survey-consumers",
                    params={"link_status": "bogus"},
                    headers=_hdr(tok), timeout=20)
    assert r.status_code == 400
