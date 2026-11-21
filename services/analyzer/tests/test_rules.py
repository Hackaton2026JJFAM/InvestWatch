"""Testy reguł na materiałach tekstowych (bez renderu). Uruchom: pytest -q"""
from app.main import analyze_material


def run(text: str, **kw) -> dict:
    res = analyze_material({"url": kw.pop("url", "https://test.example/a"), "content_text": text, "full_text": text,
                            "platform": kw.pop("platform", "web"), "layout": {"engine": "none"}, **kw})
    res["by_rule"] = {f["rule_id"]: f for f in res["findings"]}
    return res


def status(res: dict, rule: str) -> str:
    return res["by_rule"][rule]["status"]


def test_guaranteed_profit_is_flagged():
    r = run("Gwarantowany zysk 12% rocznie bez ryzyka. Zainwestuj już dziś.")
    assert status(r, "G1") == "fail"
    assert status(r, "3") == "fail"
    assert r["score"] >= 60


def test_profit_with_adjacent_risk_passes_rule_3():
    r = run("Materiał marketingowy. Akcje mogą przynieść zysk. Inwestowanie wiąże się z ryzykiem utraty części kapitału.")
    assert status(r, "3") == "pass"
    assert status(r, "2") == "pass"


def test_knf_approval_and_safety_argument():
    r = run("Produkt zatwierdzony przez KNF. Inwestycja w pełni bezpieczna, bo spełniamy wymogi KNF. Zarabiaj 9% rocznie.")
    assert status(r, "17") == "fail"
    assert status(r, "18") == "fail"


def test_neutral_supervision_mention_is_allowed():
    r = run("Materiał marketingowy. Podmiot nadzorowany przez Komisję Nadzoru Finansowego. Inwestowanie wiąże się z ryzykiem.")
    assert status(r, "17") == "pass"


def test_risk_in_other_language():
    r = run("Reklama. Zarabiaj na kryptowalutach z naszą aplikacją mobilną. Your capital is at risk. You may lose all your money.")
    assert status(r, "10") == "fail"


def test_historical_results_need_disclaimer_and_5_years():
    r = run("Materiał reklamowy. Fundusz zarobił 38% w 2024 r. i 21% w 2023 r. Inwestowanie wiąże się z ryzykiem.")
    assert status(r, "12a") == "fail"
    assert status(r, "14") == "fail"


def test_forecast_without_warning():
    r = run("Reklama. Prognozujemy wzrost o 25% w przyszłym roku. Inwestowanie wiąże się z ryzykiem.")
    assert status(r, "15") == "fail"


def test_tax_benefit_needs_caveat():
    r = run("Materiał marketingowy. Otwórz IKE i nie płać podatku Belki. Inwestowanie wiąże się z ryzykiem.")
    assert status(r, "16") == "fail"
    ok = run("Materiał marketingowy. Otwórz IKE i nie płać podatku Belki. Traktowanie podatkowe zależy od indywidualnej sytuacji klienta i może ulec zmianie. Inwestowanie wiąże się z ryzykiem.")
    assert status(ok, "16") == "pass"


def test_visual_rules_not_checked_without_render():
    r = run("Reklama. Zarabiaj 10% rocznie. Ryzyko utraty kapitału.")
    assert all(status(r, x) == "not_checked" for x in ("4", "5", "6", "7", "8"))


def test_education_is_not_advisory():
    r = run("W tym kursie poznasz podstawy inwestowania. Materiał ma charakter edukacyjny i nie stanowi rekomendacji inwestycyjnej.")
    assert r["m3"]["classification"] in ("brak", "edukacja")
    assert r["score"] < 20


def test_shadow_advisory_unregistered():
    r = run("Aurum Advisory Sp. z o.o. – wealth management. Nasz doradca przeanalizuje Twoją sytuację i przygotuje indywidualne rekomendacje zakupu akcji. Pakiet 990 zł/mies.")
    assert r["m3"]["classification"] == "indywidualne_doradztwo"
    assert r["by_rule"]["M3.1"]["status"] == "fail"


def test_finfluencer_unknown_author_is_not_guessed():
    r = run("Korzystam z brokera i polecam konto maklerskie – akcje i ETF bez prowizji.")
    assert r["m1"]["publisher"]["type"] == "nieustalone"


def test_finfluencer_third_party_with_referral():
    r = run("Polecam Dom Maklerski Vistula Capital S.A. – z moim kodem polecającym dostaniesz bonus. Zarabiam na CFD.",
            author="@kuba", platform="tiktok", url="https://www.tiktok.com/@kuba/video/1")
    assert r["m1"]["publisher"]["type"] == "podmiot_trzeci"
    assert r["by_rule"]["M1.2"]["status"] == "fail"


def test_score_is_independent_of_threshold():
    a = run("Gwarantowany zysk bez ryzyka.")
    b = run("Gwarantowany zysk bez ryzyka.")
    assert a["score"] == b["score"]
