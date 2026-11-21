"""Adaptery rejestrów zewnętrznych (na żądanie, z pamięcią podręczną):

- KRS (api-krs.ms.gov.pl, Ministerstwo Sprawiedliwości): odpis aktualny – nazwa, forma, KRS/NIP/REGON,
  data rejestracji, kapitał, adres, strona WWW, zarząd, rada nadzorcza, prokurenci, wspólnicy.
  Publiczne API maskuje dane osób (np. „S***”, PESEL „7****”) – osób nie da się łączyć między spółkami.
- GLEIF (api.gleif.org): kody LEI, status, kraj, forma prawna, adres – dla podmiotów zagranicznych.

Oba API są publiczne i bezpłatne, bez klucza. Brak opublikowanych limitów KRS – zapytania są
buforowane (6 h) i wykonywane tylko na żądanie lub dla nowych podmiotów.
"""
from __future__ import annotations

import re
import time

import httpx

KRS_URL = "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{krs}"
KRS_FULL_URL = "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/{krs}"
GLEIF_URL = "https://api.gleif.org/api/v1/lei-records"
# Urząd rejestrowy KRS w GLEIF – dla polskich spółek pole registeredAs zawiera numer KRS
GLEIF_RA_KRS = "RA000484"
UA = {"User-Agent": "InvestWatch-enrichment/0.1", "Accept": "application/json"}
TTL = 6 * 3600
_cache: dict[str, tuple[float, object]] = {}


class NotFound(Exception):
    pass


def _cached(key: str, fn):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    value = fn()
    _cache[key] = (time.time(), value)
    return value


def _amount(v: dict | None) -> dict | None:
    if not v or not v.get("wartosc"):
        return None
    return {"value": float(v["wartosc"].replace(" ", "").replace(",", ".")), "currency": v.get("waluta")}


def _person(p: dict, role: str) -> dict:
    nazw = (p.get("nazwisko") or {})
    imiona = (p.get("imiona") or {})
    name = " ".join(x for x in (imiona.get("imie"), imiona.get("imieDrugie"), nazw.get("nazwiskoICzlon"), nazw.get("nazwiskoICzlonDrugi")) if x)
    return {
        "name": name or None,
        "masked": "*" in (name or "*"),
        "role": role,
        "function": p.get("funkcjaWOrganie") or p.get("rodzajProkury"),
        "suspended": p.get("czyZawieszona"),
    }


def _address(sa: dict) -> str | None:
    a = (sa or {}).get("adres") or {}
    parts = [" ".join(x for x in (a.get("ulica"), a.get("nrDomu")) if x),
             " ".join(x for x in (a.get("kodPocztowy"), a.get("miejscowosc")) if x), a.get("kraj")]
    s = ", ".join(p for p in parts if p)
    return s or None


def krs(number: str, full: bool = False) -> dict:
    if not re.fullmatch(r"[0-9]{10}", number):
        raise ValueError("Numer KRS musi mieć 10 cyfr")

    def fetch():
        with httpx.Client(timeout=20, headers=UA) as c:
            for rejestr in ("P", "S"):
                r = c.get(KRS_URL.format(krs=number), params={"rejestr": rejestr, "format": "json"})
                if r.status_code == 200:
                    return rejestr, r.json()
                if r.status_code != 404:
                    r.raise_for_status()
        raise NotFound(f"Brak podmiotu o numerze KRS {number}")

    rejestr, data = _cached(f"krs:{number}", fetch)
    odpis = data["odpis"]
    head = odpis.get("naglowekA") or {}
    d1 = odpis["dane"].get("dzial1") or {}
    d2 = odpis["dane"].get("dzial2") or {}
    dp = d1.get("danePodmiotu") or {}
    ids = dp.get("identyfikatory") or {}
    kap = d1.get("kapital") or {}
    rep = d2.get("reprezentacja") or {}
    sup = d2.get("organNadzoru") or []
    sup = sup if isinstance(sup, list) else [sup]
    persons = [_person(p, rep.get("nazwaOrganu") or "zarząd") for p in rep.get("sklad") or []]
    for organ in sup:
        persons += [_person(p, organ.get("nazwa") or "organ nadzoru") for p in organ.get("sklad") or []]
    persons += [_person(p, "prokurent") for p in d2.get("prokurenci") or []]
    shareholders = []
    for key in ("wspolnicySpzoo", "wspolnicySpk", "wspolnicy", "jedynyAkcjonariusz"):
        for w in d1.get(key) or []:
            shareholders.append({**_person(w, "wspólnik"), "shares": w.get("posiadaneUdzialy")})
    sa = d1.get("siedzibaIAdres") or {}
    return {
        "registry": "krs",
        "krs": head.get("numerKRS") or number,
        "register": "przedsiębiorców" if rejestr == "P" else "stowarzyszeń/fundacji",
        "name": dp.get("nazwa"),
        "legal_form": dp.get("formaPrawna"),
        "nip": ids.get("nip"),
        "regon": ids.get("regon"),
        "registered_at": head.get("dataRejestracjiWKRS"),
        "last_entry_at": head.get("dataOstatniegoWpisu"),
        "state_as_of": head.get("stanZDnia"),
        "capital": _amount(kap.get("wysokoscKapitaluZakladowego")),
        "capital_paid": _amount(kap.get("czescKapitaluWplaconegoPokrytego")),
        "address": _address(sa),
        "seat": ((sa.get("siedziba") or {}).get("miejscowosc")),
        "website": sa.get("adresStronyInternetowej"),
        "representation": rep.get("sposobReprezentacji"),
        "persons": persons,
        "shareholders": shareholders,
        "persons_masked": any(p["masked"] for p in persons + shareholders),
        "source_url": f"https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{number}?rejestr={rejestr}&format=json",
        # kompletny odpis aktualny (wszystkie działy) – do wyświetlenia wszystkich danych
        "raw": odpis,
        **({"raw_full": krs_full(number, rejestr)} if full else {}),
    }


def krs_full(number: str, rejestr: str = "P") -> dict:
    """Odpis pełny – wszystkie dane z historią zmian (wpisy wprowadzone/wykreślone)."""
    def fetch():
        with httpx.Client(timeout=30, headers=UA) as c:
            r = c.get(KRS_FULL_URL.format(krs=number), params={"rejestr": rejestr, "format": "json"})
            if r.status_code == 404:
                raise NotFound(f"Brak odpisu pełnego dla KRS {number}")
            r.raise_for_status()
            return r.json()["odpis"]

    return _cached(f"krs-full:{number}:{rejestr}", fetch)


def _fmt_address(addr: dict) -> str:
    return ", ".join(x for x in [*(addr.get("addressLines") or []), addr.get("postalCode"), addr.get("city"), addr.get("country")] if x)


def _gleif_record(rec: dict) -> dict:
    a = rec["attributes"]
    e = a["entity"]
    addr = e.get("legalAddress") or {}
    reg_at = (e.get("registeredAt") or {}).get("id")
    reg_as = (e.get("registeredAs") or "").strip()
    digits = re.sub(r"\D", "", reg_as)
    lei = a.get("lei") or rec.get("id")
    return {
        "registry": "gleif",
        "lei": lei,
        "name": (e.get("legalName") or {}).get("name"),
        "other_names": [n.get("name") for n in e.get("otherNames") or [] if n.get("name")],
        "country": addr.get("country"),
        "city": addr.get("city"),
        "address": _fmt_address(addr),
        "hq_address": _fmt_address(e.get("headquartersAddress") or {}),
        "jurisdiction": e.get("jurisdiction"),
        "legal_form": (e.get("legalForm") or {}).get("id"),
        "category": e.get("category"),
        "created_at": e.get("creationDate"),
        "entity_status": e.get("status"),
        "registration_status": (a.get("registration") or {}).get("status"),
        "initial_registration": (a.get("registration") or {}).get("initialRegistrationDate"),
        "last_update": (a.get("registration") or {}).get("lastUpdateDate"),
        "next_renewal": (a.get("registration") or {}).get("nextRenewalDate"),
        "registered_at": reg_at,
        "registered_as": reg_as or None,
        # numer KRS z GLEIF (urząd rejestrowy RA000484) – pozwala pobrać odpis KRS bez znajomości numeru
        "krs": digits.zfill(10) if reg_at == GLEIF_RA_KRS and digits and len(digits) <= 10 else None,
        "bic": a.get("bic"),
        "source_url": f"https://search.gleif.org/#/record/{lei}",
        "raw": a,
    }


def gleif_detail(lei: str) -> dict:
    """Rekord LEI z relacjami: podmiot dominujący bezpośredni i najwyższy, podmioty zależne."""
    if not re.fullmatch(r"[A-Z0-9]{18}[0-9]{2}", lei):
        raise ValueError("Niepoprawny format LEI")

    def fetch():
        with httpx.Client(timeout=20, headers=UA) as c:
            r = c.get(f"{GLEIF_URL}/{lei}")
            if r.status_code == 404:
                raise NotFound(f"Brak rekordu LEI {lei}")
            r.raise_for_status()
            out = {"record": _gleif_record(r.json()["data"])}
            for key in ("direct-parent", "ultimate-parent"):
                p = c.get(f"{GLEIF_URL}/{lei}/{key}")
                if p.status_code == 200 and p.json().get("data"):
                    out[key.replace("-", "_")] = _gleif_record(p.json()["data"])
                else:
                    # brak relacji – GLEIF publikuje wtedy powód (reporting exception)
                    ex = c.get(f"{GLEIF_URL}/{lei}/{key}-reporting-exception")
                    out[key.replace("-", "_")] = {"exception": (ex.json().get("data") or {}).get("attributes", {}).get("reason")} if ex.status_code == 200 else None
            ch = c.get(f"{GLEIF_URL}/{lei}/direct-children", params={"page[size]": "20"})
            out["direct_children"] = [_gleif_record(x) for x in ch.json().get("data", [])] if ch.status_code == 200 else []
            return out

    return _cached(f"gleif-detail:{lei}", fetch)


def gleif(name: str | None = None, lei: str | None = None, limit: int = 5, country: str | None = None) -> list[dict]:
    if lei:
        if not re.fullmatch(r"[A-Z0-9]{18}[0-9]{2}", lei):
            raise ValueError("Niepoprawny format LEI")
        params = {"filter[lei]": lei}
    elif name and len(name.strip()) >= 3:
        params = {"filter[fulltext]": name.strip(), "page[size]": str(limit)}
        if country:
            params["filter[entity.legalAddress.country]"] = country
    else:
        raise ValueError("Podaj nazwę (min. 3 znaki) albo LEI")

    def fetch():
        with httpx.Client(timeout=20, headers=UA) as c:
            r = c.get(GLEIF_URL, params=params)
            r.raise_for_status()
            return [_gleif_record(x) for x in r.json().get("data", [])]

    return _cached(f"gleif:{sorted(params.items())}", fetch)
