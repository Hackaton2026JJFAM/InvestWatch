"""Rzeczywiste żądania HTTP do uruchomionych serwisów, bez atrap usług."""
import hashlib
import json
import os
from pathlib import Path

import httpx
import pytest

SCR = os.getenv("AUDIT_SCRAPER", "http://127.0.0.1:8001")
ANA = os.getenv("AUDIT_ANALYZER", "http://127.0.0.1:8002")
RESULTS = Path(__file__).parent / "results"


def post(base, path, payload):
    return httpx.post(base + path, json=payload, timeout=120)


def analyze(text, **meta):
    response = post(ANA, "/analyze", {
        "url": "https://audit.example/material", "content_text": text,
        "full_text": text, "layout": {"engine": "none"}, **meta,
    })
    assert response.status_code == 200, response.text
    return response.json()


def rule(result, key):
    return next(f for f in result["findings"] if f["rule_id"] == key)


@pytest.mark.parametrize("base", [SCR, ANA])
def test_health(base):
    response = httpx.get(base + "/health")
    assert response.status_code == 200
    assert response.json()["ok"] is True


@pytest.mark.parametrize("path,payload", [
    ("/scrape", {"url": "file:///etc/passwd"}),
    ("/scrape/text", {"text": ""}),
    ("/scrape/html", {"html": ""}),
    ("/discover", {"url": "https://audit.example", "limit": 51}),
])
def test_scraper_validation(path, payload):
    assert post(SCR, path, payload).status_code == 422


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/", "http://localhost/", "http://[::1]/",
    "http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/",
    "http://user:password@example.com/",
])
def test_ssrf_is_blocked(url):
    response = post(SCR, "/scrape", {"url": url, "render": False})
    assert response.status_code == 400, response.text


def test_text_extraction_normalization_and_hash():
    response = post(SCR, "/scrape/text", {
        "text": "  Fikcyjny\u00a0 materiał   testowy.  ",
        "url": "https://audit.example/post", "author": "@audit_synthetic",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["content_text"] == "Fikcyjny materiał testowy."
    assert data["content_hash"] == hashlib.sha256(
        "fikcyjny materiał testowy".encode()).hexdigest()
    assert data["author"] == "@audit_synthetic"


def test_html_metadata_noise_and_duplicates():
    html = """<html lang="pl"><head><title>Audyt</title>
    <meta name="author" content="@audit_synthetic">
    <meta property="article:published_time" content="2026-11-21T10:00:00Z">
    </head><body><nav>MENU</nav><main><p>Treść testowa.</p>
    <p>Treść testowa.</p><script>secret()</script></main></body></html>"""
    data = post(SCR, "/scrape/html", {
        "html": html, "url": "https://audit.example", "render": False,
    }).json()
    assert data["title"] == "Audyt"
    assert data["author"] == "@audit_synthetic"
    assert data["lang"] == "pl"
    assert data["content_text"] == "Treść testowa."
    assert data["published_at"] == "2026-11-21T10:00:00Z"


@pytest.mark.parametrize("url,platform", [
    ("https://www.facebook.com/audit_synthetic/posts/1", "facebook"),
    ("https://www.instagram.com/p/SYNTHETIC", "instagram"),
    ("https://www.tiktok.com/@audit_synthetic/video/1", "tiktok"),
])
def test_social_metadata(url, platform):
    html = """<html><head><meta property="og:description"
    content="Syntetyczny opis reklamy akcji."></head><body></body></html>"""
    data = post(SCR, "/scrape/html", {
        "html": html, "url": url, "render": False,
    }).json()
    assert data["platform"] == platform
    assert "Syntetyczny opis" in data["content_text"]


@pytest.mark.parametrize("payload", [
    {}, {"url": "https://audit.example"}, {"url": "x", "content_text": None},
])
def test_analyzer_required_fields(payload):
    assert post(ANA, "/analyze", payload).status_code == 422


def test_analyzer_rejects_empty_text():
    # Wymagany błąd 4xx zamiast pozornej analizy pustego dokumentu.
    assert post(ANA, "/analyze", {"url": "x", "content_text": ""}).status_code == 422


@pytest.mark.parametrize("extra", [
    {"links": [None]}, {"layout": {"engine": "playwright", "viewports": {"desktop": "bad"}}},
])
def test_nested_invalid_payload_is_4xx(extra):
    response = post(ANA, "/analyze", {
        "url": "https://audit.example", "content_text": "Reklama akcji. Zarabiaj 10% rocznie.",
        **extra,
    })
    assert 400 <= response.status_code < 500, response.text


def test_summary_rejects_invalid_result():
    response = post(ANA, "/summary", {"result": {}})
    assert 400 <= response.status_code < 500, response.text


def test_summary_template():
    result = analyze("Gwarantowany zysk 12% rocznie bez ryzyka.")
    response = post(ANA, "/summary", {"result": result})
    assert response.status_code == 200
    assert response.json()["engine"] == "template"
    assert "[G1]" in response.json()["summary"]


def test_registry_demo_is_not_official_registration():
    response = httpx.get(ANA + "/registry/check", params={
        "name": "Dom Maklerski Vistula Capital S.A."})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] != "registered", data


def test_m1_identifies_third_party():
    result = analyze(
        "Polecam Dom Maklerski Vistula Capital S.A. Akcje i ETF. Z moim kodem polecającym bonus.",
        author="@audit_synthetic", platform="tiktok",
        url="https://www.tiktok.com/@audit_synthetic/video/1")
    assert result["m1"]["publisher"]["type"] == "podmiot_trzeci"
    assert rule(result, "M1.3")["status"] == "fail"


def test_m1_domain_suffix_does_not_impersonate_firm():
    result = analyze(
        "Dom Maklerski Vistula Capital S.A. Polecam akcje i ETF. Z moim kodem polecającym bonus.",
        url="https://evilvistula-capital.example/post", author="@audit_synthetic")
    assert result["m1"]["publisher"]["type"] != "firma", result["m1"]


def test_m2_guarantee():
    result = analyze("Gwarantowany zysk 12% rocznie bez ryzyka. Inwestuj już dziś.")
    assert rule(result, "G1")["status"] == "fail"
    assert result["score"] >= 60


def test_m2_negated_guarantee_is_not_a_promise():
    result = analyze(
        "Materiał edukacyjny. Nie obiecujemy gwarantowanego zysku. "
        "Nie istnieje zysk bez ryzyka. Możesz stracić cały kapitał.")
    assert rule(result, "G1")["status"] != "fail", rule(result, "G1")


def test_m2_negative_ad_label_is_not_disclosure():
    result = analyze("To nie jest reklama. Zarabiaj 15% rocznie. Otwórz konto.")
    assert rule(result, "2")["status"] != "pass", rule(result, "2")


def test_m2_positive_and_ambiguous_risk():
    good = analyze(
        "Materiał marketingowy. Akcje mogą przynieść zysk. "
        "Inwestowanie wiąże się z ryzykiem utraty kapitału.")
    assert rule(good, "3")["status"] == "pass"
    ambiguous = analyze("Reklama. Zysk 12% rocznie. Nasz zespół lubi ryzykować.")
    assert rule(ambiguous, "3")["status"] != "pass", rule(ambiguous, "3")


def test_m3_unregistered_advisory():
    result = analyze(
        "Syntetyczna Aurum Advisory Sp. z o.o. Wealth management. "
        "Przygotujemy indywidualne rekomendacje zakupu akcji dopasowane do Twojej sytuacji. "
        "Pakiet 990 zł/mies.")
    assert result["m3"]["classification"] == "indywidualne_doradztwo"
    assert rule(result, "M3.1")["status"] == "fail"


def test_m3_mentioning_broker_does_not_authorize_advisor():
    result = analyze(
        "Syntetyczna Aurum Advisory Sp. z o.o. Wealth management. "
        "Przygotujemy indywidualne rekomendacje zakupu akcji dopasowane do Twojej sytuacji. "
        "Pakiet 990 zł/mies. Transakcje wykonasz przez Dom Maklerski Vistula Capital S.A.")
    assert rule(result, "M3.1")["status"] == "fail", rule(result, "M3.1")


def test_m3_education():
    result = analyze(
        "W tym kursie poznasz podstawy inwestowania. Materiał ma charakter edukacyjny "
        "i nie stanowi rekomendacji inwestycyjnej.")
    assert result["m3"]["classification"] in ("brak", "edukacja")
    assert result["score"] < 20


@pytest.mark.parametrize("text,key,expected", [
    ("Reklama. Zarabiaj 12% rocznie.", "3", "fail"),
    ("Reklama. Zarabiaj na akcjach. Your capital is at risk.", "10", "fail"),
    ("Reklama. Nasze konto maklerskie jest lepsze niż lokata. Zarabiaj.", "11", "fail"),
    ("Reklama. Fundusz zarobił 30% w 2025 r. Inwestowanie wiąże się z ryzykiem.", "14", "fail"),
    ("Reklama. Prognozujemy wzrost o 20% w przyszłym roku.", "15", "fail"),
    ("Reklama. Otwórz IKE i nie płać podatku Belki.", "16", "fail"),
    ("Reklama. Produkt zatwierdzony przez KNF. Zarabiaj.", "17", "fail"),
    ("Reklama. Inwestycja w pełni bezpieczna, bo spełniamy wymogi KNF.", "18", "fail"),
    ("Materiał marketingowy. Podmiot nadzorowany przez Komisję Nadzoru Finansowego. "
     "Inwestowanie wiąże się z ryzykiem.", "17", "pass"),
])
def test_m2_text_rules_explicit_cases(text, key, expected):
    assert rule(analyze(text), key)["status"] == expected


def test_advisory_disclaimer_does_not_override_personal_offer():
    result = analyze(
        "Syntetyczna Aurum Advisory Sp. z o.o. Doradztwo inwestycyjne. "
        "Przygotujemy indywidualne rekomendacje zakupu akcji dla Twojej sytuacji. "
        "Pakiet 990 zł. To materiał edukacyjny i nie stanowi porady.")
    assert result["m3"]["classification"] == "indywidualne_doradztwo"
    assert rule(result, "M3.1")["status"] == "fail"


def test_scoring_is_deterministic_and_bounded():
    text = "Gwarantowany zysk 12% rocznie bez ryzyka."
    a, b = analyze(text), analyze(text)
    assert a["score"] == b["score"]
    assert a["score"] == max(a["module_scores"].values())
    assert 0 <= a["score"] <= 100
    for module, score in a["module_scores"].items():
        keep = 1
        for finding in a["findings"]:
            if finding["module"] != module:
                continue
            weight = finding["severity"] / (
                100 if finding["status"] == "fail" else 200
            ) if finding["status"] in ("fail", "warn") else 0
            keep *= 1 - min(max(weight, 0), .95)
        assert score == round(100 * (1 - keep), 1)


def test_samples_real_render_and_scoring():
    root = Path(__file__).resolve().parents[1] / "data" / "samples"
    labels = json.loads((root / "labels.json").read_text(encoding="utf-8"))
    rows = []
    for name, meta in labels.items():
        if name.startswith("_"):
            continue
        raw = (root / name).read_text(encoding="utf-8")
        if name.endswith(".json"):
            material = post(SCR, "/scrape/text", json.loads(raw))
        else:
            material = post(SCR, "/scrape/html", {
                "html": raw, "url": meta["url"], "render": True,
            })
        assert material.status_code == 200, material.text
        data = material.json()
        response = post(ANA, "/analyze", data)
        assert response.status_code == 200, response.text
        result = response.json()
        rows.append({"file": name, "ground_truth": meta["ground_truth"],
                     "engine": data["layout"]["engine"], "result": result})
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "samples.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    assert all(row["engine"] == "playwright" for row in rows if row["file"].endswith(".html"))
    tp = sum(row["ground_truth"] and row["result"]["score"] >= 45 for row in rows)
    fp = sum(not row["ground_truth"] and row["result"]["score"] >= 45 for row in rows)
    fn = sum(row["ground_truth"] and row["result"]["score"] < 45 for row in rows)
    assert (tp, fp, fn) == (11, 0, 1), (tp, fp, fn)
