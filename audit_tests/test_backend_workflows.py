"""Pozostałe operacje REST i kontrola zapisu na wydzielonej bazie."""
import time
import uuid

import httpx
import pytest

from test_backend import call, upload


@pytest.fixture(scope="module")
def detail():
    return upload(
        "Polecam Dom Maklerski Vistula Capital S.A. "
        "Gwarantowany zysk na akcjach 12% rocznie bez ryzyka. "
        "Z moim kodem polecającym bonus.",
        author="@audit_synthetic", platform="instagram", ground_truth=True,
    )


def test_reanalyze_preserves_history(detail):
    mid = detail["material"]["id"]
    before = call("GET", f"/materials/{mid}").json()
    response = call("POST", f"/materials/{mid}/reanalyze", json={})
    assert response.status_code == 200, response.text
    after = call("GET", f"/materials/{mid}").json()
    assert len(after["history"]) == len(before["history"]) + 1
    assert after["analysis"]["score"] == before["analysis"]["score"]
    assert after["analysis"]["id"] != before["analysis"]["id"]


def test_labels_persist(detail):
    mid = detail["material"]["id"]
    for value in [False, None, True]:
        response = call("PATCH", f"/materials/{mid}/label", json={"ground_truth": value})
        assert response.status_code == 200
        assert call("GET", f"/materials/{mid}").json()["material"]["ground_truth"] is value


def test_alert_patch_and_read_all(detail):
    alert_id = detail["alerts"][0]["id"]
    response = call("PATCH", f"/alerts/{alert_id}", json={"read": True, "status": "REVIEWED"})
    assert response.status_code == 200
    assert response.json()["read"] is True
    assert response.json()["status"] == "REVIEWED"
    assert call("POST", "/alerts/read-all", json={}).status_code == 204
    assert call("GET", "/dashboard/stats").json()["totals"]["unread"] == 0


def test_entity_details_and_enrichment_empty_states(detail):
    assert detail["entities"]
    for entity in detail["entities"]:
        eid = entity["id"]
        response = call("GET", f"/entities/{eid}")
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["entity"]["id"] == eid
        assert isinstance(data["materials"], list)
        assert isinstance(data["registry"], list)
        assert isinstance(data["persons"], list)
        assert call("GET", f"/entities/{eid}/crisis").status_code == 200
        response = call("GET", f"/entities/{eid}/reserves")
        assert response.status_code == 200
        assert response.json()["status"] == "brak danych"


def test_search_all_kinds(detail):
    for kind in ["all", "entities", "materials", "registry"]:
        response = call("GET", f"/search?q=Vistula&type={kind}")
        assert response.status_code == 200, response.text
        assert isinstance(response.json(), dict)


def test_missing_alert_and_analysis():
    assert call("PATCH", "/alerts/2147483647", json={"read": True}).status_code == 404
    assert call("GET", "/analyses/2147483647").status_code == 404
    assert call("GET", "/summary/2147483647").status_code == 404


def test_source_scheduler_empty_enabled_set():
    # Wszystkie źródła utworzone przez wcześniejsze testy są wyłączone.
    sources = call("GET", "/sources").json()
    assert not any(source["enabled"] for source in sources), "Nie uruchamiaj na cudzych źródłach"
    response = call("POST", "/sources/run", json={})
    assert response.status_code == 202
    assert response.json() == {"sources": 0, "queued": 0}


def test_malformed_json_returns_json_400():
    response = httpx.post(
        "http://127.0.0.1:4000/api/settings", content="{bad",
        headers={"content-type": "application/json"})
    assert response.status_code == 400
    assert "error" in response.json()
