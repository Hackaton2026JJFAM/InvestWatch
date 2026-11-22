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
