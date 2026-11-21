"""Moduł 3 – Shadow Advisory (usługi doradcze bez zezwolenia).

Doradztwo inwestycyjne (art. 76 u.o.i.f.) = rekomendacja nabycia/zbycia/trzymania instrumentów
finansowych przygotowana w oparciu o potrzeby i sytuację klienta. Klasyfikator odróżnia
ofertę indywidualnego doradztwa od materiałów edukacyjnych. Wynik = sygnał do weryfikacji.
"""
from __future__ import annotations

from . import text as T
from .model import FAIL, NA, PASS, WARN, Doc, Finding, ev
from .registry import extract_entity_names, get_registry

SERVICE = T.rx(r"\bwealth management\b", r"\bfamily office\w*", r"\binvestment (?:consulting|advisory)\b", r"\bdoradztw\w* inwestycyjn\w*",
               r"\bdoradc\w* (?:inwestycyjn|finansow|majatkow)\w*", r"\bzarzadzani\w* (?:majatkiem|kapitalem|portfelem)\b", r"\bprivate bank\w*",
               r"\bosobist\w* doradc\w*", r"\bopiek\w* inwestycyjn\w*", r"\bsygnal\w* (?:transakcyjn|inwestycyjn|kupna|sprzedazy)\w*",
               r"\bkonsultacj\w* (?:inwestycyjn|1:1|indywidualn)\w*", r"\bmentoring\w* inwestycyjn\w*")
PERSONAL = T.rx(r"\bindywidualn\w*", r"\bdopasowan\w* do (?:ciebie|twoich|twojej|klienta|potrzeb)", r"\btwoj\w* (?:sytuacj|cel|potrzeb|profil|portfel|majat|oszczednosc)\w*",
                r"\b1:1\b", r"\bjeden na jeden\b", r"\bspersonalizowan\w*", r"\bpod (?:twoje|twoj) (?:potrzeby|cele)\b", r"\banaliz\w* (?:twojej|twoich|sytuacji)\w*",
                r"\bprofil\w* ryzyka\b", r"\bankiet\w* inwestycyjn\w*")
RECOMMEND = T.rx(r"\brekomend\w*", r"\bpowiemy (?:ci )?(?:co|kiedy|jakie)\b", r"\bco kupic\b", r"\bkiedy (?:kupic|sprzedac)\b", r"\bwskazemy\b", r"\bdobierzemy\b",
                 r"\bulozymy\b", r"\bzbudujemy (?:ci|twoj|dla)\w*", r"\b(?:kupuj|sprzedaj|trzymaj)\b", r"\bwarto (?:kupic|sprzedac|trzymac)\b",
                 r"\bkonkretn\w* (?:spolk|akcj|instrument)\w*", r"\bgotow\w* (?:portfel|strategi)\w*", r"\bstrategi\w* inwestycyjn\w* dla\b")
COMMERCIAL = T.rx(r"\babonament\w*", r"\bsubskrypcj\w*", r"\bpakiet\w*", r"\bcennik\b", r"\d+\s?(?:zl|pln|eur|usd)\b", r"\bzl ?/ ?mies", r"\bplatn\w*",
                  r"\bumow\w* (?:spotkanie|konsultacj)\w*", r"\bzapisz sie\b", r"\bbezplatn\w* konsultacj\w*", r"\bskontaktuj\w*", r"\bformularz\w*")
EDUCATION = T.rx(r"\bmaterial\w* edukacyjn\w*", r"\bcel\w* edukacyjn\w*", r"nie (?:stanowi|jest|sa|stanowia) (?:rekomendacj|porad|doradztw)\w*",
                 r"\bkurs\w* (?:online|inwestowania|dla)\b", r"\bszkoleni\w*", r"\bwebinar\w*", r"\bebook\w*", r"\bpodstaw\w* inwestowania\b",
                 r"\bjak dziala\w*\b", r"\bpoznaj\w* (?:zasady|podstawy)\b", r"not (?:financial|investment) advice")


def run(doc: Doc) -> dict:
    s = doc.sentences
    service = [x for x in s if T.has(SERVICE, x.text)]
    personal = [x for x in s if T.has(PERSONAL, x.text)]
    recommend = [x for x in s if T.has(RECOMMEND, x.text) or x.labels.get("advisory", 0) > 0.6]
    commercial = [x for x in s if T.has(COMMERCIAL, x.text)]
    education = [x for x in s if T.has(EDUCATION, x.text) or x.labels.get("education", 0) > 0.7]
    instruments = [name for name, pat in T.INSTRUMENTS.items() if T.has(pat, doc.text)]

    if not (service or (recommend and personal)):
        return {"findings": [Finding("m3", "M3.1", "Oferta doradztwa inwestycyjnego", NA, 0, None,
                                     "Nie wykryto opisu usług doradczych ani indywidualnych rekomendacji.")],
                "classification": "brak", "entities": []}

    # klasyfikacja: edukacja vs oferta indywidualnego doradztwa
    advisory_points = 2 * bool(service) + 2 * bool(personal) + 2 * bool(recommend) + bool(commercial) + bool(instruments)
    edu_points = 2 * len(education)
    if edu_points >= advisory_points and not (personal and recommend):
        classification = "edukacja"
    elif personal and (recommend or service):
        classification = "indywidualne_doradztwo"
    else:
        classification = "usługa_doradcza_ogólna"

    reg = get_registry()
    names = extract_entity_names(doc.text)
    entities = []
    for n in names:
        hit = reg.lookup(n)
        entities.append({"name": n, "registry": "znaleziono" if hit else "brak w rejestrze", "registry_match": hit})
    authorized = any(e["registry_match"] for e in entities) or bool(reg.find_in_text(doc.text, doc.domain))

    findings: list[Finding] = []
    evid = [ev(x.text, "usługa") for x in service[:2]] + [ev(x.text, "personalizacja") for x in personal[:2]] + \
           [ev(x.text, "rekomendacja") for x in recommend[:2]]
    if classification == "edukacja":
        findings.append(Finding("m3", "M3.1", "Materiał edukacyjny", PASS, 0, "art. 76 u.o.i.f.",
                                "Treść ma charakter edukacyjny – brak cech indywidualnej rekomendacji.", [ev(x.text) for x in education[:2]]))
    else:
        sev = 70 if classification == "indywidualne_doradztwo" else 40
        if authorized:
            findings.append(Finding("m3", "M3.1", "Doradztwo świadczone przez podmiot z rejestru", WARN, 10, "art. 76 u.o.i.f.",
                                    "Oferta doradztwa – podmiot odnaleziony w rejestrze KNF (sprawdzić zakres zezwolenia).", evid))
        else:
            findings.append(Finding("m3", "M3.1", "Możliwe doradztwo inwestycyjne bez zezwolenia", FAIL, sev, "art. 76 u.o.i.f.",
                                    ("Oferta indywidualnych rekomendacji dot. instrumentów finansowych" if classification == "indywidualne_doradztwo"
                                     else "Opis usług doradczych/zarządzania majątkiem") +
                                    " – podmiotu nie odnaleziono w rejestrze firm inwestycyjnych KNF. Sygnał do weryfikacji, nie dowód naruszenia.",
                                    evid))
        if commercial:
            findings.append(Finding("m3", "M3.2", "Odpłatny charakter usługi", WARN, 20, None,
                                    "Usługa ma charakter komercyjny (cennik, abonament, formularz kontaktowy).", [ev(x.text) for x in commercial[:2]]))
        if instruments:
            findings.append(Finding("m3", "M3.3", "Instrumenty finansowe w ofercie", WARN, 15, "art. 2 u.o.i.f.",
                                    f"Oferta dotyczy instrumentów finansowych: {', '.join(instruments)}."))
    return {"findings": findings, "classification": classification, "entities": entities}
