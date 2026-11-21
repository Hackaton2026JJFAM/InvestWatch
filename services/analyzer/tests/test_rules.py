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


# ---------------------------------------------------------------- listy referencyjne (KNF, ESMA MiCA)
def test_knf_warning_by_domain():
    r = run("Zarabiaj na forex z najlepszą platformą. Załóż konto już dziś.", url="https://www.quomarkets.com/pl/oferta")
    assert r["by_rule"]["M1.5"]["status"] == "fail"
    assert any(h["list"] == "knf_warnings" and h["matched_by"] == "domena" for h in r["watchlists"])


def test_knf_warning_by_linked_domain():
    r = analyze_material({"url": "https://blog.example/post", "content_text": "Polecam tę platformę, zarabiam codziennie na CFD.",
                          "links": [{"text": "Załóż konto", "href": "https://quomarkets.com/register?ref=abc"}], "layout": {"engine": "none"}})
    assert {f["rule_id"]: f["status"] for f in r["findings"]}["M1.5"] == "fail"


def test_crypto_without_casp_licence_is_signal():
    r = run("Kupuj bitcoin na naszej giełdzie kryptowalut ZetaCoinX. Zarabiaj 20% rocznie.")
    assert r["by_rule"]["M1.7"]["status"] == "warn"


def test_authorised_casp_is_recognised():
    r = run("Kupuj bitcoin w Bitpanda. Inwestowanie wiąże się z ryzykiem utraty kapitału.")
    assert r["by_rule"]["M1.7"]["status"] == "pass"


def test_identifiers_are_extracted():
    r = run("Aurum Advisory Sp. z o.o., KRS 0000123456, NIP 123-456-78-90. Wealth management.")
    assert r["doc"]["identifiers"]["krs"] == ["0000123456"]
    assert r["doc"]["identifiers"]["nip"] == ["1234567890"]


def test_generic_text_has_no_watchlist_hits():
    r = run("Dom maklerski oferuje akcje i obligacje. Inwestowanie wiąże się z ryzykiem.")
    assert r["watchlists"] == []


def test_short_registry_name_matches_only_as_uppercase_acronym():
    from app.registry import get_registry
    reg = get_registry()
    assert any(f["name"] == "XTB S.A." for f in reg.find_in_text("Rachunek maklerski w XTB S.A."))
    assert reg.find_in_text("tekst o xtb pisany małymi literami") == []
    assert reg.find_in_text("ALL IN ONE – SKY IS THE LIMIT") == []


def test_short_single_word_name_requires_proper_noun():
    from app.registry import get_registry
    reg = get_registry()
    assert not any(f["name"].startswith("Solid") for f in reg.find_in_text("We deliver solid returns and a solid plan."))


def test_ocr_image_layout_runs_visual_rules():
    blocks = [
        {"text": "Zarabiaj nawet 20% rocznie na CFD!", "font_size": 48, "contrast": 15, "x": 40, "y": 40, "w": 900, "h": 60},
        {"text": "Załóż konto w kilka minut i odbierz bonus.", "font_size": 24, "contrast": 15, "x": 40, "y": 140, "w": 800, "h": 30},
        {"text": "CFD są złożonymi instrumentami i wiążą się z ryzykiem utraty środków.", "font_size": 7, "contrast": 1.8,
         "x": 40, "y": 700, "w": 600, "h": 10, "in_footer": True, "in_fine_print": True},
    ]
    text = "\n".join(b["text"] for b in blocks)
    from app.main import Material  # przez model API – uzupełnia domyślne pola bloków (visible itd.)
    m = Material(url="upload://reklama.png", content_text=text, full_text=text,
                 layout={"engine": "ocr", "viewports": {"desktop": {"width": 1366, "height": 768, "page_height": 768, "screenshot_height": 768, "blocks": blocks}}})
    r = analyze_material(m.model_dump())
    st = {f["rule_id"]: f["status"] for f in r["findings"]}
    assert st["4"] == "fail"          # czcionka ostrzeżenia 7 px
    assert st["5"] == "fail"          # kontrast 1,8:1
    assert st["6"] == "fail"          # tylko w stopce / drobnym druku
    assert st["7"] == "na" and st["8"] == "not_checked"
    assert any(h["kind"] == "risk" for h in r["doc"]["highlights"])
