"""Przesłanki z list referencyjnych (ostrzeżenia KNF, rejestr MiCA ESMA) dla Modułów 1 i 3."""
from __future__ import annotations

from urllib.parse import urlparse

from . import text as T
from .model import FAIL, PASS, WARN, Doc, Finding, ev
from .watchlists import clean_domain, get_watchlists, identifiers

STRONG = {"domena", "KRS", "NIP"}


def _hit_ev(h: dict) -> dict:
    return ev(f"{h['name']} (dopasowanie: {h['matched_by']})", h["list"], source_url=h.get("source_url"))


def run(doc: Doc, m3_classification: str) -> dict:
    ids = identifiers(doc.text)
    link_domains = {clean_domain(urlparse(l.get("href", "")).hostname or "") for l in doc.links}
    domains = sorted({d for d in [clean_domain(doc.domain or ""), *link_domains] if d})
    hits = get_watchlists().check(text=doc.text, domains=domains, krs=ids["krs"], nip=ids["nip"])
    findings: list[Finding] = []

    knf = [h for h in hits if h["list"] == "knf_warnings"]
    if knf:
        strong = [h for h in knf if h["matched_by"] in STRONG]
        findings.append(Finding(
            "m1", "M1.5", "Podmiot z listy ostrzeżeń publicznych KNF", FAIL if strong else WARN, 75 if strong else 40,
            (knf[0].get("legal_basis") or "lista ostrzeżeń publicznych KNF"),
            ("Materiał dotyczy podmiotu, wobec którego KNF złożyła zawiadomienie o podejrzeniu przestępstwa"
             if strong else "Nazwa podobna do podmiotu z listy ostrzeżeń KNF – dopasowanie tylko po nazwie, wymaga weryfikacji")
            + f" ({knf[0]['name']}).", [_hit_ev(h) for h in knf[:3]]))
        if m3_classification in ("indywidualne_doradztwo", "usługa_doradcza_ogólna"):
            findings.append(Finding("m3", "M3.4", "Oferta doradcza podmiotu z listy ostrzeżeń KNF", FAIL if strong else WARN,
                                    60 if strong else 30, "art. 76 u.o.i.f.", "Usługa doradcza powiązana z podmiotem z listy ostrzeżeń KNF.",
                                    [_hit_ev(h) for h in knf[:2]]))

    ncasp = [h for h in hits if h["list"] == "esma_ncasp"]
    if ncasp:
        strong = [h for h in ncasp if h["matched_by"] in STRONG]
        findings.append(Finding(
            "m1", "M1.6", "Podmiot bez licencji MiCA (ostrzeżenie organu UE)", FAIL if strong else WARN, 70 if strong else 35,
            "art. 59 rozp. MiCA 2023/1114",
            f"{ncasp[0]['name']} figuruje w rejestrze ESMA podmiotów świadczących usługi kryptoaktywów bez zezwolenia"
            f" ({ncasp[0].get('authority') or ncasp[0].get('country')}).", [_hit_ev(h) for h in ncasp[:3]]))

    crypto = T.has(T.INSTRUMENTS["Kryptowaluty"], doc.text)
    if crypto:
        casp = [h for h in hits if h["list"] == "esma_casp"]
        if casp:
            c = casp[0]
            findings.append(Finding("m1", "M1.7", "Licencja CASP (MiCA)", PASS, 0, "art. 59 rozp. MiCA 2023/1114",
                                    f"{c['name']} jest autoryzowanym dostawcą usług kryptoaktywów ({c.get('country')}, {c.get('authority')}).",
                                    [_hit_ev(h) for h in casp[:2]]))
        elif not ncasp:
            findings.append(Finding("m1", "M1.7", "Brak w rejestrze CASP (MiCA)", WARN, 25, "art. 59 rozp. MiCA 2023/1114",
                                    "Materiał promuje usługi kryptoaktywów, a podmiotu nie odnaleziono w rejestrze CASP ESMA – sygnał do weryfikacji."))

    return {"findings": findings, "hits": hits[:20], "identifiers": ids}
