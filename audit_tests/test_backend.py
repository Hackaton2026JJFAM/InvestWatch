"""Testy backendu na wydzielonej bazie investwatch_audit (port 55432)."""
import os
import time
import uuid

import httpx
import pytest

BASE = os.getenv("AUDIT_BACKEND", "http://127.0.0.1:4000/api")


def call(method, path, **kwargs):
    return httpx.request(method, BASE + path, timeout=120, **kwargs)


def upload(text, **meta):
    response = call("POST", "/scans/upload", json={
        "text": text, "url": f"https://audit.example/{uuid.uuid4().hex}",
        "title": "Syntetyczny audyt", **meta,
    })
    assert response.status_code == 202, response.text
    job = response.json()
    for _ in range(100):
        data = call("GET", f"/scans/{job['id']}").json()
        if data["status"] in ("done", "failed", "duplicate"):
            assert data["status"] == "done", data
            return call("GET", f"/materials/{data['material_id']}").json()
        time.sleep(.2)
    pytest.fail(f"Job nie zakończył się: {data}")


@pytest.fixture(scope="module")
def material():
    return upload("Gwarantowany zysk 12% rocznie bez ryzyka. Inwestuj teraz.",
                  ground_truth=True)


@pytest.mark.parametrize("path", [
    "/health", "/dashboard/stats", "/materials", "/alerts", "/settings",
    "/calibration", "/search?q=audit", "/entities", "/rules", "/sources", "/scans",
])
def test_get_endpoints(path):
    response = call("GET", path)
    assert response.status_code == 200, response.text
    assert isinstance(response.json(), (dict, list))


@pytest.mark.parametrize("method,path,payload,status", [
    ("GET", "/absent", None, 404),
    ("GET", "/materials/0", None, 400),
    ("GET", "/materials/2147483647", None, 404),
    ("GET", "/materials?module=invalid", None, 400),
    ("GET", "/materials?size=201", None, 400),
    ("GET", "/search?q=a", None, 400),
    ("POST", "/scans", {"url": "file:///etc/passwd"}, 400),
    ("POST", "/scans/upload", {}, 400),
    ("PATCH", "/settings", {"threshold": -1}, 400),
    ("PATCH", "/settings", {"threshold": 101}, 400),
    ("PATCH", "/settings", {"threshold": "45"}, 400),
    ("PATCH", "/materials/1/status", {"status": "INVALID"}, 400),
])
def test_validation(method, path, payload, status):
    response = call(method, path, json=payload)
    assert response.status_code == status, response.text
    assert "error" in response.json()


def test_persistence_detail_findings_summary(material):
    assert material["material"]["content_hash"]
    assert material["analysis"]["score"] >= 60
    assert len(material["findings"]) >= 20
    mid = material["material"]["id"]
    response = call("GET", f"/summary/{mid}")
    assert response.status_code == 200
    assert response.json()["engine"] == "template"
    aid = material["analysis"]["id"]
    assert call("GET", f"/analyses/{aid}").status_code == 200


@pytest.mark.parametrize("query", [
        "platform=web", "module=m2", "risk=wysokie", "status=NEW",
        "from=2026-01-01&to=2026-12-31", "sort=score&dir=asc",
        "q=Syntetyczny", "domain=audit.example",
        "module=m2&platform=web&risk=wysokie&status=NEW&sort=title",
])
def test_all_filters_and_sorting(material, query):
    response = call("GET", "/materials?" + query)
    assert response.status_code == 200, (query, response.text)
    assert isinstance(response.json()["items"], list)


def test_status_updates_and_alert_read(material):
    mid = material["material"]["id"]
    response = call("PATCH", f"/materials/{mid}/status", json={"status": "REVIEWED"})
    assert response.status_code == 200
    detail = call("GET", f"/materials/{mid}").json()
    assert detail["material"]["status"] == "REVIEWED"
    assert all(a["read"] and a["status"] == "REVIEWED" for a in detail["alerts"])


def test_threshold_changes_decision_not_score(material):
    before = call("GET", "/settings").json()["threshold"]
    try:
        scores = []
        flagged = []
        for threshold in [0, 45, 100]:
            assert call("PATCH", "/settings", json={"threshold": threshold}).status_code == 200
            detail = call("GET", f"/materials/{material['material']['id']}").json()
            scores.append(detail["analysis"]["score"])
            calibration = call("GET", f"/calibration?threshold={threshold}").json()
            flagged.append(calibration["at"]["flagged"])
            assert len(calibration["curve"]) == 21
        assert len(set(scores)) == 1
        assert flagged[0] >= flagged[1] >= flagged[2]
    finally:
        call("PATCH", "/settings", json={"threshold": before})


def test_calibration_confusion_matches_items():
    response = call("GET", "/calibration?threshold=45")
    assert response.status_code == 200
    data = response.json()
    expected = {"tp": 0, "fp": 0, "fn": 0, "tn": 0}
    for item in data["items"]:
        if item["ground_truth"] is None:
            continue
        key = ("tp" if item["ground_truth"] else "fp") if item["score"] >= 45 else (
            "fn" if item["ground_truth"] else "tn")
        expected[key] += 1
    assert {k: data["at"][k] for k in expected} == expected


def test_duplicate_by_url_and_content(material):
    m = material["material"]
    response = call("POST", "/scans/upload", json={
        "text": m["content_text"], "url": m["url"],
    })
    assert response.status_code == 202
    for _ in range(100):
        job = call("GET", f"/scans/{response.json()['id']}").json()
        if job["status"] == "duplicate":
            assert job["material_id"] == m["id"]
            return
        if job["status"] == "failed":
            pytest.fail(str(job))
        time.sleep(.1)
    pytest.fail("Brak statusu duplicate")


def test_style_only_change_is_not_duplicate():
    url = f"https://audit.example/{uuid.uuid4().hex}"
    base = """<html><body><main><p>Reklama. Zarabiaj 12% rocznie.</p>
    <p style="font-size:SIZEpx">Inwestowanie wiąże się z ryzykiem utraty kapitału.</p>
    </main></body></html>"""
    ids = []
    for size in (16, 6):
        response = call("POST", "/scans/upload", json={
            "html": base.replace("SIZE", str(size)), "url": url,
        })
        assert response.status_code == 202
        for _ in range(100):
            job = call("GET", f"/scans/{response.json()['id']}").json()
            if job["status"] in ("done", "duplicate", "failed"):
                break
            time.sleep(.1)
        assert job["status"] == "done", job
        ids.append(job["material_id"])
    assert ids[0] != ids[1]


def test_health_redis_scraper_analyzer_ready():
    data = call("GET", "/health").json()
    assert data["ok"] is True
    assert data["db"] is True
    assert data["scraper"]["ok"] is True
    assert data["analyzer"]["ok"] is True
    assert isinstance(data["queue"], dict)


def test_source_crud_isolated():
    response = call("POST", "/sources", json={
        "url": f"https://audit.example/source/{uuid.uuid4().hex}", "label": "audyt",
    })
    assert response.status_code == 201
    sid = response.json()["id"]
    response = call("PATCH", f"/sources/{sid}", json={"enabled": False})
    assert response.status_code == 200 and response.json()["enabled"] is False
    # Rekord pozostaje wyłączony; audyt niczego nie usuwa.


def test_unauthenticated_settings_write_is_denied():
    current = call("GET", "/settings").json()["threshold"]
    response = call("PATCH", "/settings", json={"threshold": current})
    assert response.status_code in (401, 403), response.text


def test_sql_injection_is_treated_as_text():
    response = call("GET", "/materials", params={
        "risk": "wysokie", "q": "'; SELECT pg_sleep(10); --",
    })
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 0


def test_html_upload_preserves_author_title_platform():
    response = call("POST", "/scans/upload", json={
        "html": "<html><body><p>Syntetyczny materiał edukacyjny.</p></body></html>",
        "url": f"https://audit.example/html/{uuid.uuid4().hex}",
        "author": "@audit_synthetic", "title": "Tytuł nadany przy imporcie", "platform": "instagram",
    })
    assert response.status_code == 202
    for _ in range(100):
        job = call("GET", f"/scans/{response.json()['id']}").json()
        if job["status"] in ("done", "failed"):
            break
        time.sleep(.1)
    assert job["status"] == "done", job
    data = call("GET", f"/materials/{job['material_id']}").json()["material"]
    assert data["author"] == "@audit_synthetic", data
    assert data["title"] == "Tytuł nadany przy imporcie"
    assert data["platform"] == "instagram"
