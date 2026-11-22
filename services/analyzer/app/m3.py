"""Moduł 3 – Shadow Advisory (usługi doradcze bez zezwolenia).

Doradztwo inwestycyjne (art. 76 u.o.i.f.) = rekomendacja nabycia/zbycia/trzymania instrumentów
finansowych przygotowana w oparciu o potrzeby i sytuację klienta. Klasyfikator odróżnia
ofertę indywidualnego doradztwa od materiałów edukacyjnych. Wynik = sygnał do weryfikacji.
"""
from __future__ import annotations

from . import text as T
from .model import FAIL, NA, PASS, WARN, Doc, Finding, ev
from .registry import domain_matches, extract_entity_names, get_registry

# kontekst wykonania transakcji – broker/bank prowadzący rachunek, a nie podmiot doradzający
EXECUTION = T.rx(r"\btransakcj\w* (?:wykonasz|wykonujesz|zrealizujesz|realizujesz|zawierasz)\b", r"\bza posrednictwem\b",
                 r"\brachun\w* (?:maklersk\w* )?(?:w|prowadzi)\b", r"\bprzez (?:dom|biuro) maklersk\w*", r"\bkonto maklerskie w\b",
                 r"\bbroker\w* (?:wykonuj|realizuj|prowadz)\w*", r"\bzlecenia (?:sklada|wykonuj|realizuj)\w*")

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
# zadeklarowane uprawnienia: licencja doradcy/maklera (nadawana przez KNF), agent firmy inwestycyjnej
LICENSE = T.rx(r"\bdoradc\w* inwestycyjn\w* (?:nr|numer|z licencj\w*|licencj\w*)", r"\blicencj\w* (?:doradcy|maklera)\w*", r"\bnr licencji\b",
               r"\bmakler\w* papierow wartosciow\w* (?:nr|z licencj)", r"\bagent\w* (?:firmy|domu|biura) (?:inwestycyjn|maklersk)\w*",
               r"\bagentem\b.{0,60}\b(?:securities|maklersk|inwestycyjn|tfi)\w*", r"\bwpisan\w* (?:do|na) (?:rejestr|liste) (?:agentow|doradcow|maklerow)\w*",
               r"\buprawnieni\w* (?:wydan\w* )?(?:przez )?(?:knf|komisj\w* nadzoru)", r"\bcfa\b", r"\befa\b|\befp\b")
LICENSE_NO = T.rx(r"(?:doradc\w* inwestycyjn\w*|licencj\w*|makler\w*)[^.]{0,40}?(?:nr|numer)\.?\s?(\d{2,5})")
# planowanie finansowe (budżet, cele, oszczędzanie, emerytura) – poradnictwo dostępne bez licencji, o ile bez rekomendacji instrumentów
PLANNING = T.rx(r"\bplanowani\w* finansow\w*", r"\bplan\w* finansow\w*", r"\bbudzet\w*", r"\bcel\w* finansow\w*", r"\boszczedzani\w*",
                r"\bemerytur\w*", r"\bpoduszk\w* finansow\w*", r"\bfinans\w* (?:osobist|domow)\w*", r"\bwydatk\w*", r"\bkredyt\w*",
                r"\bubezpiecz\w*", r"\bdlug\w*", r"\bfinancial planning\b")

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
    license_ = [x for x in s if T.has(LICENSE, x.text)]
    license_no = next((m.group(1) for x in license_ for m in [LICENSE_NO.search(T.fold(x.text))] if m), None)
    planning = [x for x in s if T.has(PLANNING, x.text)]
    # rekomendacje KONKRETNYCH instrumentów odróżniają doradztwo inwestycyjne od planowania finansowego
    instrument_recs = [x for x in recommend if any(T.has(p, x.text) for p in T.INSTRUMENTS.values()) or T.has(T.rx(r"\bkonkretn\w*", r"\bco kupic\b",
                       r"\b(?:kupuj|sprzedaj|trzymaj)\b", r"\bsygnal\w*", r"\bspolk\w*", r"\bakcj\w*"), x.text)]

    consult = [x for x in s if T.has(T.rx(r"\bkonsultacj\w*", r"\bspotkani\w*", r"\bsesj\w* (?:1:1|indywidualn)"), x.text)]
    if not (service or (recommend and personal) or (planning and (personal or consult) and (commercial or consult))):
        return {"findings": [Finding("m3", "M3.1", "Oferta doradztwa inwestycyjnego", NA, 0, None,
                                     "Nie wykryto opisu usług doradczych ani indywidualnych rekomendacji.")],
                "classification": "brak", "entities": []}

    # klasyfikacja: edukacja vs oferta indywidualnego doradztwa
    advisory_points = 2 * bool(service) + 2 * bool(personal) + 2 * bool(recommend) + bool(commercial) + bool(instruments)
    edu_points = 2 * len(education)
    if edu_points >= advisory_points and not (personal and recommend):
        classification = "edukacja"
    elif planning and len(planning) >= len(instrument_recs) * 2 and not instrument_recs:
        classification = "planowanie_finansowe"
    elif personal and (recommend or service):
        classification = "indywidualne_doradztwo"
    else:
        classification = "usługa_doradcza_ogólna"

    reg = get_registry()
    entities = []
    for n in extract_entity_names(doc.text):
        hit = reg.lookup(n)
        # podmiot wymieniony tylko jako miejsce wykonania transakcji (broker) nie jest doradcą
        ctx = [x for x in s if n.split()[0] in x.text]
        role = "wykonawca_transakcji" if ctx and all(T.has(EXECUTION, x.text) for x in ctx) else "doradca"
        status = ("demo" if hit.get("demo") else "znaleziono") if hit else "brak w rejestrze"
        entities.append({"name": n, "role": role, "registry": status, "registry_match": hit})
    advisors = [e for e in entities if e["role"] == "doradca"]
    # zezwolenie liczy się tylko dla doradcy (albo właściciela zweryfikowanej domeny), nie dla dowolnej wzmianki
    own_domain = [f for f in reg.find_in_text(doc.text, doc.domain)
                  if any(domain_matches(doc.domain, d) for d in f.get("domains") or [])]
    authorized = any(e["registry_match"] for e in advisors) or bool(own_domain)

    findings: list[Finding] = []
    evid = [ev(x.text, "usługa") for x in service[:2]] + [ev(x.text, "personalizacja") for x in personal[:2]] + \
           [ev(x.text, "rekomendacja") for x in recommend[:2]]
    lic_ev = [ev(x.text, "uprawnienia") for x in license_[:2]]
    if classification == "edukacja":
        findings.append(Finding("m3", "M3.1", "Materiał edukacyjny", PASS, 0, "art. 76 u.o.i.f.",
                                "Treść ma charakter edukacyjny – brak cech indywidualnej rekomendacji.", [ev(x.text) for x in education[:2]]))
    elif classification == "planowanie_finansowe":
        findings.append(Finding("m3", "M3.1", "Planowanie finansowe (nie doradztwo inwestycyjne)", PASS if not commercial or license_ else WARN,
                                0 if license_ else 10, "art. 76 u.o.i.f.",
                                "Usługa dotyczy budżetu, celów i planu finansowego – bez rekomendacji konkretnych instrumentów, więc nie jest "
                                "doradztwem inwestycyjnym w rozumieniu art. 76 u.o.i.f." + (" Publikujący deklaruje uprawnienia." if license_ else ""),
                                [ev(x.text, "planowanie") for x in planning[:2]] + lic_ev))
    elif license_ and not authorized:
        # zadeklarowana licencja doradcy / status agenta – nie „shadow advisory”, ale do sprawdzenia w rejestrze KNF
        findings.append(Finding("m3", "M3.1", "Doradztwo – zadeklarowane uprawnienia", WARN, 10, "art. 76 u.o.i.f.; art. 127 u.o.i.f.",
                                "Oferta doradcza, publikujący deklaruje uprawnienia"
                                + (f" (nr {license_no})" if license_no else "")
                                + " – zweryfikować w rejestrze doradców inwestycyjnych / agentów firm inwestycyjnych KNF oraz czy usługę "
                                  "świadczy w imieniu firmy inwestycyjnej.", lic_ev + evid[:2]))
        if commercial:
            findings.append(Finding("m3", "M3.2", "Odpłatny charakter usługi", WARN, 5, None,
                                    "Usługa odpłatna świadczona przez osobę deklarującą uprawnienia.", [ev(x.text) for x in commercial[:1]]))
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
    return {"findings": findings, "classification": classification, "entities": entities,
            "license": {"declared": bool(license_), "number": license_no, "evidence": [x.text[:300] for x in license_[:2]]}}
