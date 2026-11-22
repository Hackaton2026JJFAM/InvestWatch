"""Bramki fałszywych alarmów: oficjalny materiał firmy (M1) i materiał edukacyjny (M2 reguły 1-2)."""
from app.main import analyze_material

XTB_OFFICIAL = ("Materiał informacyjny XTB S.A. Inwestuj w akcje i ETF na platformie xStation. Kontrakty CFD są złożonymi "
                "instrumentami i wiążą się z dużym ryzykiem szybkiej utraty środków. 72% rachunków inwestorów detalicznych "
                "odnotowuje straty. Sprawdź ofertę na xtb.com.")
BONDS = ("Obligacje skarbowe – poradnik. Obligacja to papier wartościowy, w którym emitent zobowiązuje się zwrócić pożyczoną "
         "kwotę wraz z odsetkami. Wyróżniamy obligacje o stałym i zmiennym oprocentowaniu. Cena obligacji spada, gdy rosną "
         "stopy procentowe. Przed zakupem warto poznać czas zapadalności i zasady przedterminowego wykupu. Wyjaśniamy, jak "
         "działa kupon i czym różni się rentowność od oprocentowania.")


def run(text: str, url: str = "upload://1795327227538", platform: str = "web", **kw) -> dict:
    r = analyze_material({"url": url, "content_text": text, "platform": platform, "layout": {"engine": "none"}, **kw})
    r["by_rule"] = {}
    for f in r["findings"]:
        r["by_rule"].setdefault(f["rule_id"], f)
    return r


def test_official_material_signed_by_firm():
    r = run(XTB_OFFICIAL)
    assert r["m1"]["publisher"]["official"] is True
    assert r["by_rule"]["M1.1"]["status"] == "na"
    assert r["by_rule"]["M1.3"]["status"] == "na"
    assert r["module_scores"]["m1"] == 0


def test_official_material_full_registry_name_in_lead():
    r = run("XTB S.A. przedstawia nową ofertę ETF. Inwestuj w akcje bez prowizji. Kontrakty CFD wiążą się z dużym ryzykiem utraty środków.")
    assert r["m1"]["publisher"]["official"] is True
    assert r["module_scores"]["m1"] == 0


def test_acronym_alone_is_not_official():
    r = run("Mega okazja! Zarabiam 3% dziennie z XTB, załóż konto z moim kodem polecającym i odbierz bonus.")
    assert r["m1"]["publisher"]["official"] is False
    assert r["by_rule"]["M1.3"]["status"] == "fail"


def test_social_author_is_never_official():
    # znany autor w social media: „materiał przygotowany przez XTB” to raczej współpraca, nie oficjalny kanał firmy
    r = run("Materiał przygotowany przez XTB S.A. Inwestuj w ETF z moim kodem polecającym!", url="https://www.tiktok.com/@krypto/video/1",
            platform="tiktok", author="@krypto")
    assert r["m1"]["publisher"]["official"] is False
    assert r["module_scores"]["m1"] > 0


def test_educational_article_skips_rules_1_and_2():
    r = run(BONDS + " Obligacje indeksowane inflacją dają zysk ponad inflację.")
    assert r["education"]["educational"] is True
    assert r["by_rule"]["1"]["status"] == "na"
    assert r["by_rule"]["2"]["status"] == "na"


def test_call_to_action_disables_education_gate():
    r = run(BONDS + " Kup teraz obligacje i zainwestuj oszczędności!")
    assert r["education"]["educational"] is False
    assert r["by_rule"]["2"]["status"] == "fail"


def test_document_embedding_is_unit_vector():
    import math
    r = run(BONDS)
    e = r["ml"]["embedding"]
    assert e["dim"] == len(e["vector"]) and e["dim"] >= 2
    assert abs(math.sqrt(sum(x * x for x in e["vector"])) - 1) < 0.01


def test_summary_names_advertised_firm():
    from app.summary import advertised_line
    r = run("Polecam brokera XTB S.A. – załóż konto z moim kodem polecającym i odbierz bonus!",
            url="https://www.tiktok.com/@krypto/video/1", platform="tiktok", author="@krypto")
    line = advertised_line(r)
    assert line and "XTB S.A." in line and "@krypto" in line and "tiktok" in line
    assert advertised_line(run(BONDS)) is None


# ------------------------------------------------------------------ fałszywe sygnały oszustwa (filmy sponsorowane przez XTB)
def _signals(text):
    return {s["key"] for s in run(text, url="https://www.youtube.com/watch?v=x", platform="youtube", author="Kanał")["profile"]["signals"]}


def test_narrative_hurry_is_not_time_pressure():
    assert "presja_czasu" not in _signals("Sprzedający bardzo spieszył się ze sprzedażą mieszkania, więc kupiłem taniej i zarobiłem na inwestycji.")
    assert "presja_czasu" in _signals("Pospiesz się, zainwestuj w nasz fundusz i zarabiaj!")


def test_capital_gains_noun_is_not_recovery_scam():
    assert "odzyskiwanie" not in _signals("Nowe przepisy o opodatkowaniu odzysków kapitałowych mogą zmienić decyzje inwestorów na giełdzie.")
    assert "odzyskiwanie" in _signals("Straciłeś na inwestycji? Odzyskamy Twoje środki od brokera w 48 godzin.")


def test_double_bottom_is_not_doubling_money():
    r = run("Na wykresie kursu akcji widać podwójne dno, a potem wybicie i zysk. To klasyczna formacja podwójnego szczytu.",
            url="https://www.youtube.com/watch?v=x", platform="youtube", author="Kanał")
    assert not any(c.get("multiplier") for c in r["profile"]["returns"])


def test_100_percent_idiom_is_not_return():
    r = run("Jestem w 100% przekonany, że od początku roku zarobiłem dużo pieniędzy dzięki inwestycjom na giełdzie.",
            url="https://www.youtube.com/watch?v=x", platform="youtube", author="Kanał")
    assert not r["profile"]["returns"]


def test_treasury_bonds_without_risk_are_not_scam_guarantee():
    keys = _signals("Kupuję obligacje indeksowane inflacją co miesiąc i zarabiam na odsetkach. "
                    "Cała kwota jest wysoko oprocentowana bez żadnego ryzyka.")
    assert "gwarancja" not in keys
    # obligacje korporacyjne „bez ryzyka” nadal są sygnałem
    assert "gwarancja" in _signals("Nasze obligacje korporacyjne dają 15% rocznie zysku bez żadnego ryzyka.")


def test_bond_rate_from_ocr_is_not_unrealistic():
    keys = _signals("Zobacz list emisyjny > Sprzedaż: 01.05.2026 - 31.05.2026 55% w pierwszym roku odsetkowym, zysk z obligacji.")
    assert "nierealne_zyski" not in keys
