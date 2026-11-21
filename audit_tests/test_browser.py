"""Rzeczywisty Chromium, frontend Vite + backend HTTP; bez atrap API."""
import json
import os
from pathlib import Path
import time
import uuid

import httpx
import pytest
from playwright.sync_api import sync_playwright

ROOT = "http://127.0.0.1:5173"
API = "http://127.0.0.1:4000/api"
RESULTS = Path(__file__).parent / "results"
ADMIN_PASSWORD = os.getenv("AUDIT_ADMIN_PASSWORD")


@pytest.fixture(scope="module")
def page():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        events = []
        page.on("pageerror", lambda err: events.append({"type": "pageerror", "text": str(err)}))
        page.on("console", lambda msg: events.append({"type": msg.type, "text": msg.text})
                if msg.type in ("error", "warning") else None)
        page.on("response", lambda r: events.append({"type": "http", "status": r.status, "url": r.url})
                if r.status >= 400 else None)
        yield page
        RESULTS.mkdir(exist_ok=True)
        (RESULTS / "browser-events.json").write_text(
            json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
        context.close()
        browser.close()


@pytest.mark.parametrize("route,heading", [
    ("/", "Pulpit"), ("/materials", "Wyniki analiz"), ("/alerts", "Alerty"),
    ("/entities", "Podmioty"), ("/search", "Wyszukiwarka"),
    ("/calibration", "Panel kalibracji"), ("/scan", "Skanowanie i źródła"),
])
def test_page_loads(page, route, heading):
    page.goto(ROOT + route)
    page.get_by_role("heading", name=heading, exact=True).wait_for()
    page.get_by_text("Na żywo (WebSocket)", exact=True).wait_for()
    page.screenshot(path=str(RESULTS / ("page-" + (route.strip("/") or "dashboard") + ".png")))


def test_results_do_not_display_backend_sql_error(page):
    page.goto(ROOT + "/materials")
    page.locator(".panel").first.wait_for()
    page.wait_for_function(
        "() => document.querySelector('table') || document.body.innerText.includes('Błąd:') "
        "|| document.body.innerText.includes('Brak wyników')")
    assert "Błąd:" not in page.locator("main").inner_text()


def test_filter_risk_renders_results(page):
    page.goto(ROOT + "/materials?risk=wysokie")
    page.wait_for_function(
        "() => document.querySelector('table') || document.body.innerText.includes('Błąd:') "
        "|| document.body.innerText.includes('Brak wyników')")
    assert "Błąd:" not in page.locator("main").inner_text()
    assert page.get_by_text("Brak wyników dla wybranych filtrów.").count() == 0


def test_live_toast_for_new_high_risk(page):
    page.goto(ROOT + "/scan")
    page.get_by_text("Na żywo (WebSocket)", exact=True).wait_for()
    response = httpx.post(API + "/scans/upload", json={
        "text": "Gwarantowany zysk 20% rocznie bez ryzyka. Inwestuj teraz.",
        "url": f"https://audit.example/browser/{uuid.uuid4().hex}",
        "title": "Syntetyczny alert przeglądarki",
    })
    assert response.status_code == 202, response.text
    page.locator(".toast").filter(has_text="Wysokie ryzyko").first.wait_for(timeout=30000)
    page.screenshot(path=str(RESULTS / "websocket-toast.png"))


def test_calibration_slider_and_save(page):
    # Zapis progu to operacja administratora (B05): UI pokazuje okno logowania,
    # hasło z AUDIT_ADMIN_PASSWORD. Przywrócenie progu przez zalogowaną sesję HTTP.
    original = httpx.get(API + "/settings").json()["threshold"]
    admin = httpx.Client(timeout=30)
    if ADMIN_PASSWORD:
        admin.post(API + "/auth/login", json={"password": ADMIN_PASSWORD})
    try:
        page.goto(ROOT + "/calibration")
        slider = page.get_by_role("slider", name="Próg ryzyka")
        slider.wait_for()
        slider.fill("100")
        page.get_by_role("button", name="Zapisz próg 100", exact=True).click()
        dialog = page.get_by_role("dialog")
        dialog.or_(page.get_by_text("Nowy próg ryzyka: 100", exact=True)).first.wait_for()
        if dialog.count():
            assert ADMIN_PASSWORD, "zapis progu wymaga AUDIT_ADMIN_PASSWORD"
            dialog.get_by_placeholder("Hasło (ADMIN_PASSWORD)").fill(ADMIN_PASSWORD)
            dialog.get_by_role("button", name="Zaloguj").click()
        page.get_by_text("Nowy próg ryzyka: 100", exact=True).wait_for()
        assert httpx.get(API + "/settings").json()["threshold"] == 100
        slider.fill("0")
        assert "wysokie ≥ 0" in page.locator("main").inner_text()
    finally:
        admin.patch(API + "/settings", json={"threshold": original})
        admin.close()


def test_material_status_updates_unread_badge(page):
    # Anonimowy status zmienia bazę alertów; licznik powinien odświeżyć się z eventu.
    response = httpx.post(API + "/scans/upload", json={
        "text": "Gwarantowany zysk 30% rocznie bez ryzyka.",
        "url": f"https://audit.example/status/{uuid.uuid4().hex}", "title": "Syntetyczny status",
    })
    job_id = response.json()["id"]
    for _ in range(100):
        job = httpx.get(API + f"/scans/{job_id}").json()
        if job["status"] == "done":
            break
        time.sleep(.1)
    assert job["status"] == "done", job
    page.goto(ROOT + f"/materials/{job['material_id']}")
    page.get_by_role("button", name="Zweryfikowany", exact=True).wait_for()
    page.get_by_text("Na żywo (WebSocket)", exact=True).wait_for()
    before = httpx.get(API + "/dashboard/stats").json()["totals"]["unread"]
    with page.expect_response(lambda r: "/status" in r.url and r.request.method == "PATCH"):
        page.get_by_role("button", name="Zweryfikowany", exact=True).click()
    page.wait_for_function(
        "() => Array.from(document.querySelectorAll('button')).some("
        "b => b.innerText === 'Zweryfikowany' && b.disabled)")
    after = httpx.get(API + "/dashboard/stats").json()["totals"]["unread"]
    assert after == before - 1
    page.wait_for_timeout(300)
    badge = page.locator('a[href="/alerts"] .badge')
    displayed = int(badge.inner_text()) if badge.count() else 0
    assert displayed == after, {"displayed": displayed, "db": after}
