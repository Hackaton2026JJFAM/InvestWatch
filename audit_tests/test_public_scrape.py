"""Odczyt publicznej domeny przykładowej IANA, bez danych osobowych."""
import httpx
import pytest

BASE = "http://127.0.0.1:8001"


@pytest.mark.parametrize("render", [False, True])
def test_public_example_com(render):
    response = httpx.post(BASE + "/scrape", json={
        "url": "https://example.com", "render": render,
    }, timeout=90)
    assert response.status_code == 200, response.text
    assert response.json()["title"] == "Example Domain"
    assert response.json()["content_hash"]


@pytest.mark.parametrize("render", [False, True])
def test_source_404_is_not_a_successful_material(render):
    response = httpx.post(BASE + "/scrape", json={
        "url": "https://example.com/investwatch-audit-404", "render": render,
    }, timeout=90)
    assert response.status_code == 502, response.text[:500]


def test_discover_does_not_hide_source_404():
    response = httpx.post(BASE + "/discover", json={
        "url": "https://example.com/investwatch-audit-404", "limit": 5,
    }, timeout=90)
    assert response.status_code == 502, response.text
