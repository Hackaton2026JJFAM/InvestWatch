"""Moduł 1 – monitoring finfluencerów i podmiotów trzecich.

Łączy: firmę inwestycyjną (z rejestru), reklamujący podmiot (autor/profil/domena),
treść reklamy i URL. Gdy autora nie da się ustalić -> „nieustalone” (nie zgadujemy).
"""
from __future__ import annotations

from . import text as T
from .model import FAIL, NA, PASS, WARN, Doc, Finding, ev
from .registry import get_registry

AFFILIATE = T.rx(r"\bkod\w* (?:polecaj|rabat|promocyj|partnersk)\w*", r"\blink\w* (?:afiliac|partnersk|polecaj)\w*", r"link w bio",
                 r"z moim (?:kodem|linkiem)", r"\bref=", r"\baff(?:iliate)?=", r"utm_(?:source|campaign)", r"\bbonus\w* na start",
                 r"\bpolecam\w*", r"\bmoj\w* broker\w*", r"\bkorzystam z\b", r"\bodbierz\w* (?:bonus|darmow)\w*")
DISCLOSURE = T.rx(r"#ad\b", r"#reklama", r"#wspolprac\w*", r"#sponsor\w*", r"wspolprac\w* (?:reklamow|platn|komercyjn)\w*", r"material\w* sponsorowan\w*",
                  r"\bpaid partnership\b", r"\bpartnerem (?:materialu|odcinka)\b")
BROKER_TALK = T.rx(r"\bbroker\w*", r"\bplatform\w* (?:inwestycyjn|tradingow|transakcyjn)\w*", r"\bdom\w* maklersk\w*", r"\bkonto maklerskie\b",
                   r"\brachun\w* inwestycyjn\w*", r"\bgield\w* kryptowalut\w*", r"\bexchange\b")


def publisher_type(doc: Doc, firms: list[dict]) -> tuple[str, str | None]:
    """Zwraca (typ, nazwa): firma | podmiot_trzeci | nieustalone."""
    author = doc.author or doc.meta.get("social_handle")
    dom = doc.domain or ""
    for f in firms:
        if f.get("domains") and any(dom.endswith(d) for d in f["domains"]):
            return "firma", f["name"]
        core = T.fold(f["name"]).split()[0] if f.get("name") else ""
        if core and len(core) >= 4 and core in dom.replace("-", ""):
            return "firma", f["name"]
        if author and T.fold(f["name"])[:12] in T.fold(author):
            return "firma", f["name"]
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
                "publisher": {"type": ptype, "name": pname, "platform": doc.platform}}

    if ptype == "podmiot_trzeci":
        findings.append(Finding("m1", "M1.1", "Reklama publikowana przez podmiot trzeci", FAIL, 40 if disclosure else 55, None,
                                f"Firma/instrument reklamowany przez podmiot inny niż firma inwestycyjna ({pname}, {doc.platform}).",
                                [ev(f["name"], "firma") for f in firms[:3]] + [ev(pname or "", "reklamujący")]))
    elif ptype == "nieustalone":
        findings.append(Finding("m1", "M1.1", "Nie ustalono publikującego", WARN, 30, None,
                                "Materiał reklamuje firmę/instrument, ale autora nie da się ustalić – oznaczono do ręcznej weryfikacji."))
    else:
        findings.append(Finding("m1", "M1.1", "Reklama publikowana przez samą firmę", PASS, 0, None,
                                f"Publikujący odpowiada reklamowanej firmie ({pname}) – materiał właściwy dla Modułu 2."))

    if affiliate or affiliate_links:
        findings.append(Finding("m1", "M1.2", "Linki/kody afiliacyjne", FAIL if ptype != "firma" else WARN, 35, None,
                                "Wykryto kody polecające lub linki partnerskie – wskazuje na współpracę komercyjną.",
                                [ev(x.text) for x in affiliate[:3]] + [ev(h, "link") for h in affiliate_links[:2]]))
    if ptype != "firma":
        if disclosure:
            findings.append(Finding("m1", "M1.3", "Oznaczenie współpracy", PASS, 0, None, "Współpraca reklamowa została oznaczona.",
                                    [ev(disclosure[0].text)]))
        else:
            findings.append(Finding("m1", "M1.3", "Brak oznaczenia współpracy", FAIL, 40, None,
                                    "Podmiot trzeci promuje firmę/instrument bez oznaczenia współpracy reklamowej (#reklama, #ad)."))
    if not firms and broker_talk:
        lang = doc.lang or T.detect_lang(doc.text)
        findings.append(Finding("m1", "M1.4", "Reklamowany podmiot spoza rejestru KNF", WARN, 35, None,
                                f"Promowana platforma/broker nie została odnaleziona w rejestrze KNF"
                                f"{' (reklama polskojęzyczna – możliwa działalność transgraniczna)' if lang == 'pl' else ''}. Sygnał do weryfikacji.",
                                [ev(x.text) for x in broker_talk[:3]]))
    return {"findings": findings, "firms": firms, "instruments": instruments,
            "publisher": {"type": ptype, "name": pname, "platform": doc.platform}}
