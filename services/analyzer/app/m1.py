"""Moduł 1 – monitoring finfluencerów i podmiotów trzecich.

Łączy: firmę inwestycyjną (z rejestru), reklamujący podmiot (autor/profil/domena),
treść reklamy i URL. Gdy autora nie da się ustalić -> „nieustalone” (nie zgadujemy).
"""
from __future__ import annotations

from . import text as T
from .model import FAIL, NA, PASS, WARN, Doc, Finding, ev
from .registry import core_name, domain_matches, get_registry

# strona własna usługodawcy (doradcy, trenera) – promuje siebie, nie cudzą firmę
SELF_OFFER = T.rx(r"\bmoj\w* (?:uslug|konsultacj|szkoleni|kurs|ofert|klien)\w*", r"\bumow\w* (?:sie )?(?:na )?(?:konsultacj|spotkani|rozmow)\w*",
                  r"\boferuj\w*\b", r"\bzapraszam\w* (?:na|do)\b", r"\bo mnie\b", r"\bnazywam sie\b", r"\bpomagam\w* (?:klientom|ludziom|w)\b",
                  r"\bwspolpracuj\w* ze mna\b")


def _site_label(domain: str) -> str:
    """xtb.com / www.xtb.pl / pl.xtb.com -> „xtb” (etykieta drugiego poziomu)."""
    parts = [p for p in (domain or "").lower().split(".") if p and p != "www"]
    if len(parts) >= 3 and parts[-2] in ("com", "co", "org", "net"):  # np. firma.com.pl
        return parts[-3]
    return parts[-2] if len(parts) >= 2 else (parts[0] if parts else "")


def _squash(name: str) -> str:
    return "".join(ch for ch in core_name(name) if ch.isalnum())


def _strip_tld(name: str) -> str:
    """„XTB.pl” / „xtb.com” jako nazwa autora/serwisu -> „XTB”."""
    import re
    return re.sub(r"\.(?:pl|com|eu|net|org|io|co\.uk|com\.pl)$", "", (name or "").strip(), flags=re.I)

AFFILIATE = T.rx(r"\bkod\w* (?:polecaj|rabat|promocyj|partnersk)\w*", r"\blink\w* (?:afiliac|partnersk|polecaj)\w*", r"link w bio",
                 r"z moim (?:kodem|linkiem)", r"\bref=", r"\baff(?:iliate)?=", r"utm_(?:source|campaign)", r"\bbonus\w* na start",
                 r"\bpolecam\w*", r"\bmoj\w* broker\w*", r"\bkorzystam z\b", r"\bodbierz\w* (?:bonus|darmow)\w*")
DISCLOSURE = T.rx(r"#ad\b", r"#reklama", r"#wspolprac\w*", r"#sponsor\w*", r"wspolprac\w* (?:reklamow|platn|komercyjn)\w*", r"material\w* sponsorowan\w*",
                  r"\bpaid partnership\b", r"\bpartnerem (?:materialu|odcinka)\b")
BROKER_TALK = T.rx(r"\bbroker\w*", r"\bplatform\w* (?:inwestycyjn|tradingow|transakcyjn)\w*", r"\bdom\w* maklersk\w*", r"\bkonto maklerskie\b",
                   r"\brachun\w* inwestycyjn\w*", r"\bgield\w* kryptowalut\w*", r"\bexchange\b")


# Reguła Oficjalnego Materiału: sama firma podpisuje materiał („Materiał przygotowany przez XTB S.A.”, „Materiał informacyjny XTB”)
OFFICIAL_SIGN = T.rx(r"\bmaterial\w* (?:zostal\w* )?(?:przygotowan|opracowan|sporzadzon|wydan)\w* przez\b",
                     r"\bmaterial\w* (?:informacyjn|marketingow|reklamow|promocyjn|edukacyjn)\w*\b", r"\bwydawc\w*:",
                     r"\bkomunikat\w* marketingow\w*\b", r"\bprepared by\b", r"\bmarketing communication (?:of|by|from)\b")
OFFICIAL_LEAD = 2   # pełna nazwa firmy z rejestru w pierwszych N zdaniach


def official_material(doc: Doc, firms: list[dict]) -> tuple[str, str] | None:
    """Oficjalny materiał firmy z rejestru KNF -> (nazwa firmy, uzasadnienie) albo None.

    Dotyczy materiałów bez ustalonego, innego autora (plik wgrany z dysku, strona bez autora). Gdy znany autor
    w social media pisze „materiał przygotowany przez XTB”, to raczej oznaczenie współpracy – bramka się nie włącza.
    """
    real = [f for f in firms if not f.get("demo")] or firms
    if not real:
        return None
    reg = get_registry()
    lead = doc.sentences[:OFFICIAL_LEAD]
    for x in doc.sentences[:5]:
        if T.has(OFFICIAL_SIGN, x.text):
            named = reg.find_in_text(x.text)
            if named:
                return named[0]["name"], f"podpis „{x.text[:120]}”"
    for x in lead:
        sent = _words(x.text)
        for f in reg.find_in_text(x.text):
            # pełna nazwa z rejestru razem z formą prawną („XTB S.A.”, „X-Trade Brokers Dom Maklerski S.A.”) – sam skrót „XTB” nie wystarczy
            full = _words(f["name"])
            if len(full) >= 4 and f" {full} " in f" {sent} ":
                return f["name"], f"pełna nazwa firmy z rejestru na początku materiału („{x.text[:120]}”)"
    return None


def _words(s: str) -> str:
    import re
    return " ".join(re.findall(r"\w+", T.fold(s or "")))


def publisher_type(doc: Doc, firms: list[dict]) -> tuple[str, str | None]:
    """Zwraca (typ, nazwa): firma | podmiot_trzeci | nieustalone."""
    author = doc.author or doc.meta.get("social_handle")
    dom = doc.domain or ""
    label = _site_label(dom)
    for f in firms:
        # zweryfikowane domeny podmiotu z rejestru
        if any(domain_matches(dom, d) for d in f.get("domains") or []):
            return "firma", f["name"]
        # strona w domenie DOKŁADNIE odpowiadającej nazwie firmy (xtb.com ↔ XTB S.A.); domeny z dopiskami
        # („xtb-bonus.com”) się nie liczą – tak podszywają się oszuści
        if doc.platform == "web" and label and len(label) >= 3 and label == _squash(f["name"]):
            return "firma", f["name"]
        for who in (author, doc.publisher):
            if who and _squash(_strip_tld(who)) in (_squash(f["name"]), _squash(f["name"]).split(" ")[0]) and doc.platform == "web":
                return "firma", f["name"]
        if author and core_name(author) == core_name(f["name"]):
            return "firma", f["name"]
    # strona własna usługodawcy (np. doradcy): promuje swoje usługi, nie jest „podmiotem trzecim” wobec siebie
    if doc.platform == "web" and sum(T.has(SELF_OFFER, x.text) for x in doc.sentences) >= 2:
        return "własne_usługi", author or doc.publisher or dom
    if doc.platform != "web" and author:
        return "podmiot_trzeci", author
    if author:
        return "podmiot_trzeci", author
    if doc.publisher:
        return "podmiot_trzeci", doc.publisher
    return "nieustalone", None


def run(doc: Doc) -> dict:
    reg = get_registry()
    firms = reg.find_in_text(doc.text, doc.domain)
    instruments = [name for name, pat in T.INSTRUMENTS.items() if T.has(pat, doc.text)]
    ptype, pname = publisher_type(doc, firms)
    official = None
    # tylko materiał bez źródła (plik z dysku, wklejony tekst): bez autora i bez domeny. Stronę WWW rozpoznaje domena firmy
    # (publisher_type) – podpis „XTB S.A.” na domenie xtb-bonus.com to podszywanie się, nie oficjalny materiał.
    no_source = not (doc.author or doc.meta.get("social_handle") or doc.publisher) and (not doc.domain or doc.url.startswith("upload://"))
    if ptype == "nieustalone" and no_source:
        official = official_material(doc, firms)
        if official:
            ptype, pname = "firma", official[0]
    affiliate = [x for x in doc.sentences if T.has(AFFILIATE, x.text)]
    disclosure = [x for x in doc.sentences if T.has(DISCLOSURE, x.text)]
    broker_talk = [x for x in doc.sentences if T.has(BROKER_TALK, x.text)]
    affiliate_links = [l["href"] for l in doc.links if any(k in l.get("href", "") for k in ("ref=", "aff", "utm_campaign", "partner"))]

    findings: list[Finding] = []
    advertised = bool(firms) or (bool(broker_talk) and bool(instruments))
    if not advertised:
        findings.append(Finding("m1", "M1.1", "Reklama firmy inwestycyjnej", NA, 0, None,
                                "Nie wykryto reklamy firmy inwestycyjnej ani jej instrumentów."))
        return {"findings": findings, "firms": firms, "instruments": instruments,
                "publisher": {"type": ptype, "name": pname, "platform": doc.platform, "official": False}}

    if official:
        findings.append(Finding("m1", "M1.1", "Oficjalny materiał firmy inwestycyjnej", NA, 0, None,
                                f"Materiał podpisany przez firmę z rejestru KNF ({official[0]}; {official[1]}). Moduł 1 dotyczy reklam "
                                "podmiotów trzecich i finfluencerów – nie dotyczy. Treść oceniają Moduły 2 i 3.", [ev(official[0], "firma")]))
    elif ptype == "własne_usługi":
        findings.append(Finding("m1", "M1.1", "Strona własna usługodawcy", PASS, 0, None,
                                f"Publikujący ({pname}) promuje własne usługi – nie jest podmiotem trzecim reklamującym cudzą firmę. "
                                "Treść oceniają Moduły 2 (informacja o ryzyku) i 3 (zakres doradztwa).", [ev(pname or "", "publikujący")]))
    elif ptype == "podmiot_trzeci":
        findings.append(Finding("m1", "M1.1", "Reklama publikowana przez podmiot trzeci", FAIL, 40 if disclosure else 55, None,
                                f"Firma/instrument reklamowany przez podmiot inny niż firma inwestycyjna ({pname}, {doc.platform}).",
                                [ev(f["name"], "firma") for f in firms[:3]] + [ev(pname or "", "reklamujący")]))
    elif ptype == "nieustalone":
        findings.append(Finding("m1", "M1.1", "Nie ustalono publikującego", WARN, 30, None,
                                "Materiał reklamuje firmę/instrument, ale autora nie da się ustalić – oznaczono do ręcznej weryfikacji."))
    else:
        findings.append(Finding("m1", "M1.1", "Reklama publikowana przez samą firmę", PASS, 0, None,
                                f"Publikujący odpowiada reklamowanej firmie ({pname}) – materiał właściwy dla Modułu 2."))

    if (affiliate or affiliate_links) and ptype != "firma":  # program partnerski na stronie samej firmy to nie ukryta reklama
        findings.append(Finding("m1", "M1.2", "Linki/kody afiliacyjne", FAIL if ptype == "podmiot_trzeci" else WARN, 35, None,
                                "Wykryto kody polecające lub linki partnerskie – wskazuje na współpracę komercyjną.",
                                [ev(x.text) for x in affiliate[:3]] + [ev(h, "link") for h in affiliate_links[:2]]))
    if ptype in ("podmiot_trzeci", "nieustalone"):
        if disclosure:
            findings.append(Finding("m1", "M1.3", "Oznaczenie współpracy", PASS, 0, None, "Współpraca reklamowa została oznaczona.",
                                    [ev(disclosure[0].text)]))
        else:
            findings.append(Finding("m1", "M1.3", "Brak oznaczenia współpracy", FAIL, 40, None,
                                    "Podmiot trzeci promuje firmę/instrument bez oznaczenia współpracy reklamowej (#reklama, #ad)."))
    elif official:
        findings.append(Finding("m1", "M1.3", "Oznaczenie współpracy", NA, 0, None,
                                "Nie dotyczy – oficjalny materiał samej firmy, nie współpraca z podmiotem trzecim (#reklama/#ad wymagane od finfluencerów)."))
    if not firms and broker_talk:
        lang = doc.lang or T.detect_lang(doc.text)
        findings.append(Finding("m1", "M1.4", "Reklamowany podmiot spoza rejestru KNF", WARN, 35, None,
                                f"Promowana platforma/broker nie została odnaleziona w rejestrze KNF"
                                f"{' (reklama polskojęzyczna – możliwa działalność transgraniczna)' if lang == 'pl' else ''}. Sygnał do weryfikacji.",
                                [ev(x.text) for x in broker_talk[:3]]))
    return {"findings": findings, "firms": firms, "instruments": instruments,
            "publisher": {"type": ptype, "name": pname, "platform": doc.platform, "official": bool(official)}}
