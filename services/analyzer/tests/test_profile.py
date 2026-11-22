"""Profil publikującego (płatna promocja / oszustwo / doradca), realizm obietnic i poprawki fałszywych alarmów."""
from app.main import analyze_material


def run(text: str, url: str = "https://blog.example/wpis", platform: str = "web", **kw) -> dict:
    r = analyze_material({"url": url, "content_text": text, "full_text": text, "platform": platform, "layout": {"engine": "none"}, **kw})
    r["by_rule"] = {f["rule_id"]: f for f in r["findings"]}
    return r


# ------------------------------------------------------------------ realizm obietnic zysku
def test_daily_return_is_unrealistic():
    r = run("Mój bot zarabia 2% dziennie. Dołącz i zarabiaj razem ze mną!", platform="tiktok", author="@krypto_king")
    claim = r["profile"]["returns"][0]
    assert claim["annual_pct"] == 730.0
    assert r["by_rule"]["M1.9"]["status"] == "fail"


def test_monthly_words_from_transcript():
    r = run("Zarobisz nawet trzydzieści procent miesięcznie na tej platformie.", platform="tiktok", author="@x")
    assert r["profile"]["returns"][0]["annual_pct"] == 360.0
    assert "nierealistyczne obietnice" in r["profile"]["tags"]


def test_multiplier_claim():
    r = run("Ta moneta da x10 w rok, kupuj zanim będzie za późno.", platform="youtube", author="Kanał")
    assert any(c.get("multiplier") and c["annual_pct"] == 900.0 for c in r["profile"]["returns"])


def test_risk_disclaimer_and_fees_are_not_return_promises():
    r = run("74% rachunków inwestorów detalicznych traci pieniądze. Prowizja wynosi 0,5% od transakcji. "
            "Obligacje skarbowe dają około 6% rocznie zysku.")
    annual = [c["annual_pct"] for c in r["profile"]["returns"]]
    assert annual == [6.0]
    assert "M1.9" not in r["by_rule"]


# ------------------------------------------------------------------ oszustwo vs płatna promocja vs doradca
def test_scam_patterns_from_video_transcript():
    r = run("Cześć, nie musisz się znać na inwestowaniu. Nasz bot AI zarabia za ciebie 5% dziennie. "
            "Zacznij od 250 zł, napisz do mnie na WhatsApp. Zostało tylko 10 miejsc!", platform="tiktok", author="@zarabiaj_teraz")
    assert r["profile"]["primary"] == "podejrzenie_oszustwa"
    assert r["profile"]["scam_score"] >= 55
    assert r["by_rule"]["M1.10"]["status"] == "fail"
    keys = {s["key"] for s in r["profile"]["signals"]}
    assert {"kontakt_prywatny", "bot_ai", "minimalna_wplata", "presja_czasu", "nierealne_zyski"} <= keys


def test_labeled_paid_promotion_is_not_scam():
    r = run("#reklama Współpraca reklamowa z XTB. Otwórz konto z moim linkiem. Inwestowanie wiąże się z ryzykiem utraty kapitału.",
            platform="instagram", author="@finanse_ola")
    assert r["profile"]["primary"] == "płatna_promocja"
    assert r["profile"]["scam_score"] < 30
    assert "M1.10" not in r["by_rule"]


def test_advisor_with_unrealistic_promises():
    r = run("Oferuję indywidualne konsultacje 1:1 – dobiorę dla Ciebie konkretne spółki. Moi klienci zarabiają 20% miesięcznie.",
            platform="youtube", author="Trener Tradingu")
    assert r["profile"]["primary"] in ("doradca_finansowy", "podejrzenie_oszustwa")
    assert r["by_rule"]["M3.5"]["status"] == "fail"


# ------------------------------------------------------------------ poprawki fałszywych alarmów
def test_official_broker_site_is_not_third_party():
    r = run("XTB S.A. – broker. Otwórz rachunek inwestycyjny i handluj akcjami oraz ETF. Program partnerski z kodem polecającym.",
            url="https://www.xtb.com/pl", publisher="XTB.pl")
    assert r["m1"]["publisher"]["type"] == "firma"
    assert r["by_rule"]["M1.1"]["status"] == "pass"
    assert "M1.3" not in r["by_rule"] and "M1.2" not in r["by_rule"]
    assert r["profile"]["primary"] == "autoreklama"


def test_own_services_page_is_self_promotion():
    r = run("Nazywam się Jan Kowalski. Oferuję moje szkolenia z budżetu domowego. Zapraszam na kurs online – moje kursy prowadzę od 5 lat.",
            url="https://jankowalski.pl/kurs")
    assert r["m1"]["publisher"]["type"] == "własne_usługi"
    assert r["profile"]["self_ad"] is True
    assert r["profile"]["primary"] in ("autoreklama", "doradca_finansowy")


def test_scam_signals_carry_keys_for_review():
    r = run("Nasz bot AI zarabia za ciebie 5% dziennie. Zacznij od 250 zł, napisz do mnie na WhatsApp. Zostało tylko 10 miejsc!",
            platform="tiktok", author="@zarabiaj_teraz")
    ev = r["by_rule"]["M1.10"]["evidence"]
    assert all(e.get("signal") and e.get("weight") for e in ev)


def test_lookalike_domain_is_not_official():
    r = run("XTB S.A. – broker. Otwórz rachunek inwestycyjny i handluj akcjami.", url="https://xtb-bonus-pl.com/start", author="Promo")
    assert r["m1"]["publisher"]["type"] != "firma"


def test_licensed_advisor_is_verification_not_shadow_advisory():
    r = run("Nazywam się Anna Przykładowa, jestem doradcą inwestycyjnym nr 999 i agentem firmy inwestycyjnej Demo Securities. "
            "Oferuję indywidualne konsultacje – przygotuję portfel dopasowany do Twoich celów. Konsultacja 500 zł. "
            "Zapraszam na konsultację. Inwestowanie wiąże się z ryzykiem utraty kapitału.")
    m31 = r["by_rule"]["M3.1"]
    assert m31["status"] == "warn" and m31["severity"] <= 10
    assert r["m3"]["license"]["number"] == "999"
    assert r["module_scores"]["m3"] < 30
    assert r["m1"]["publisher"]["type"] == "własne_usługi"


def test_financial_planning_is_not_investment_advice():
    r = run("Pomagam klientom ułożyć budżet domowy i plan finansowy. Indywidualne konsultacje: cele finansowe, oszczędzanie, "
            "poduszka finansowa i emerytura. Konsultacja 300 zł, umów spotkanie.")
    assert r["m3"]["classification"] == "planowanie_finansowe"
    assert r["module_scores"]["m3"] < 20


def test_rule3_warning_elsewhere_is_warn_not_fail():
    text = ("Zarabiaj na akcjach nawet 12% rocznie. Kup ETF i ciesz się zyskiem. " + "Opis oferty i usług. " * 6 +
            "Inwestowanie wiąże się z ryzykiem utraty części lub całości kapitału. Wyniki historyczne nie gwarantują przyszłych zysków.")
    r = run(text)
    assert r["by_rule"]["3"]["status"] == "warn"
    assert "obecna" in r["by_rule"]["3"]["explanation"]


def test_rule17_credibility_claim_is_warn_with_consistent_evidence():
    r = run("Uprawnienia wydane przez Komisję Nadzoru Finansowego potwierdzają moją ekspertyzę. Inwestowanie wiąże się z ryzykiem.")
    f = r["by_rule"]["17"]
    assert f["status"] == "warn"
    assert "Komisj" in f["evidence"][0]["text"]


def test_translated_legal_form_alias_does_not_hit_sanctions():
    r = run("Rachunek jest otwarta dla klientów. Platforma otwarta 24/7.")
    assert not any(h["list"] == "eu_sanctions" for h in r["watchlists"])


def test_rule17_negated_approval_is_not_violation():
    r = run("Uprawnienia nadała mi Komisja Nadzoru Finansowego, ale KNF nie zatwierdza ani nie rekomenduje moich usług. Inwestowanie wiąże się z ryzykiem.")
    assert r["by_rule"]["17"]["status"] != "fail"


def test_english_bot_scam_signals():
    r = run("How to set up an AI crypto trading bot for easy gains. No experience needed, message me on Telegram.", platform="youtube", author="X")
    keys = {s["key"] for s in r["profile"]["signals"]}
    assert {"bot_ai", "bez_wiedzy", "kontakt_prywatny"} <= keys


# ------------------------------------------------------------------ kontekst inwestycyjny i próg od sygnałów oszustwa
def test_non_investment_free_money_is_not_rated_by_m2():
    r = run("DARMOWA KASA na Steam! Idle Master zbiera karty i zarabia środki w portfelu Steam. 100% za darmo, zero ryzyka bana.",
            platform="youtube", author="Gracz")
    assert r["context"]["investment"] is False
    assert all(f["status"] == "na" for f in r["findings"] if f["module"] == "m2")
    assert "M1.9" not in r["by_rule"]
    assert r["score"] < 30


def test_investment_content_keeps_m2():
    r = run("Zainwestuj w nasz fundusz – zysk nawet 12% rocznie! Wejdź na stronę i otwórz konto.")
    assert r["context"]["investment"] is True
    assert r["by_rule"]["3"]["status"] in ("fail", "warn")


def test_strong_scam_signals_set_a_floor_on_risk():
    r = run("Nasz bot AI zarabia za ciebie. Zacznij od 250 zł, napisz do mnie na WhatsApp. Zostało tylko 10 miejsc! "
            "Inwestowanie wiąże się z ryzykiem utraty kapitału.", platform="tiktok", author="@x")
    assert r["profile"]["scam_score"] >= 45
    assert r["score"] >= r["profile"]["scam_score"]


def test_ambiguous_words_do_not_make_content_investment():
    r = run("Powiedz kilka słów o całej akcji. Możecie dostać fundusze na Steama, to jest darmowe!", platform="youtube", author="Gracz")
    assert r["context"]["investment"] is False
    r = run("Kupiłem akcje spółki CD Projekt i fundusz obligacji – zysk 8% rocznie.")
    assert r["context"]["investment"] is True
