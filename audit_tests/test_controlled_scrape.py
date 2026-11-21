"""Wydzielony scraper :18001 z ALLOW_PRIVATE=true, fixture :18080.

Główny scraper :8001 pozostaje z domyślną blokadą SSRF.
"""
import httpx
import pytest

BASE = "http://127.0.0.1:18001"
SOURCE = "http://127.0.0.1:18080"


@pytest.mark.parametrize("render", [False, True])
def test_success(render):
    response = httpx.post(BASE + "/scrape", json={"url": SOURCE + "/offer", "render": render}, timeout=30)
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Syntetyczna oferta"
    assert "ryzykiem" in data["content_text"]
    assert data["layout"]["engine"] == ("playwright" if render else "none")


@pytest.mark.parametrize("render", [False, True])
def test_redirect(render):
    response = httpx.post(BASE + "/scrape", json={"url": SOURCE + "/redirect", "render": render}, timeout=30)
    assert response.status_code == 200
    assert response.json()["final_url"] == SOURCE + "/offer"


@pytest.mark.parametrize("render", [False, True])
def test_real_source_404(render):
    response = httpx.post(BASE + "/scrape", json={"url": SOURCE + "/404", "render": render}, timeout=30)
    assert response.status_code == 502, response.text[:300]


def test_discover_finds_relevant_same_domain_links():
    response = httpx.post(BASE + "/discover", json={"url": SOURCE + "/index", "limit": 10}, timeout=30)
    assert response.status_code == 200
    assert set(response.json()["candidates"]) == {SOURCE + "/offer", SOURCE + "/fundusz"}


def test_discover_real_source_404():
    response = httpx.post(BASE + "/discover", json={"url": SOURCE + "/404", "limit": 10}, timeout=30)
    assert response.status_code == 502, response.text
