"""Listy referencyjne: ostrzeżenia publiczne KNF oraz rejestr MiCA ESMA (CASP / podmioty niezgodne).

Dopasowanie po domenie (najmocniejsze), numerze KRS/NIP albo nazwie. Trafienie to sygnał do
weryfikacji, nie przesądzenie – zwłaszcza dopasowanie po samej nazwie.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .registry import GENERIC, core_name, domain_matches
from .text import fold

DATA = Path(__file__).parent / "data"
QUOTED = re.compile(r"[„\"“]([^”\"“„]{3,80})[”\"“]")
CUT = re.compile(r"\s+(?:z siedzibą|działając\w*|prowadząc\w*|wykonując\w*|podmiot|–|-|,|\(|oraz|poprzez|przez|używając\w*).*$", re.I)
KRS_IN_TEXT = re.compile(r"\bKRS[:\s]*([0-9]{10})\b", re.I)
NIP_IN_TEXT = re.compile(r"\bNIP[:\s]*([0-9]{3}-?[0-9]{3}-?[0-9]{2}-?[0-9]{2}|[0-9]{10})\b", re.I)
REGON_IN_TEXT = re.compile(r"\bREGON[:\s]*([0-9]{9}(?:[0-9]{5})?)\b", re.I)
LEI_IN_TEXT = re.compile(r"\b([A-Z0-9]{18}[0-9]{2})\b")


# formy prawne w różnych językach (aliasy z listy sankcji UE są tłumaczone, np. „otwarta spółka akcyjna”)
LEGAL_WORDS = {"otwarta", "zamknieta", "publiczna", "akcyjna", "spolka", "aktiebolag", "publikt", "spolocnost", "akciova", "otvorena", "cuideachta",
               "comhstoic", "oscailte", "nyilvanosan", "mukodo", "reszvenytarsasag", "nyrt", "zrt", "offene", "aktiengesellschaft", "gesellschaft",
               "sociedad", "anonima", "abierta", "societe", "anonyme", "societa", "per", "azioni", "ojsc", "pjsc", "cjsc", "jsc", "ooo", "oao", "pao",
               "llc", "ltd", "limited", "company", "plant", "joint", "stock", "open", "closed", "public", "akcionarsko", "drustvo", "akciju",
               "sabiedriba", "aktsiaselts", "osakeyhtio", "julkinen", "anonymi", "etaireia", "spolecnost", "akciova", "verejna", "javna", "delniska",
               "druzba", "societate", "pe", "actiuni", "naamloze", "vennootschap", "aktieselskab", "allmennaksjeselskap", "openbare", "zavod", "factory"}

# słowa ogólne (po fold), które same nie identyfikują podmiotu
STOP_WORDS = {"podmiot", "podmioty", "spolka", "spolki", "firma", "firmy", "platforma", "platformy", "strona", "strony", "serwis",
              "osoba", "osoby", "grupa", "projekt", "inwestycje", "inwestycja", "invest", "trading", "trade", "broker", "kantor",
              "fundusz", "konto", "rachunek", "oferta", "uslugi", "internetowa", "internetowej", "www", "the", "and", "i", "oraz",
              "z", "w", "na", "pod", "nazwa", "nazwy", "nazwie", "dzialajacy", "dzialajaca", "dzialajace", "jako", "ltd", "inc"}


def clean_domain(d: str) -> str:
    return d.lower().strip().removeprefix("www.").rstrip("/.")


def entry_names(raw_names: list[str]) -> list[str]:
    """„Everest Group” działający przez everst.eu -> Everest Group."""
    out = []
    for n in raw_names:
        q = QUOTED.findall(n)
        out.extend(q if q else [CUT.sub("", n).strip()])
    return [n for n in out if n]


def person_key(name: str) -> str:
    """Pełne imię i nazwisko bez znaków diakrytycznych, człony posortowane."""
    return " ".join(sorted(t for t in re.sub(r"[^\w\s]", " ", fold(name)).split() if len(t) >= 2))


def identifiers(text: str) -> dict:
    return {
        "krs": sorted(set(KRS_IN_TEXT.findall(text))),
        "nip": sorted({n.replace("-", "") for n in NIP_IN_TEXT.findall(text)}),
        "regon": sorted(set(REGON_IN_TEXT.findall(text))),
        "lei": sorted(set(LEI_IN_TEXT.findall(text))),
    }


@dataclass
class Entry:
    list: str            # knf_warnings | esma_ncasp | esma_casp
    name: str
    cores: list[str]
    domains: list[str]
    krs: list[str]
    nip: list[str]
    data: dict


class Watchlists:
    def __init__(self) -> None:
        self.entries: list[Entry] = []
        self.meta: dict = {}
        knf = DATA / "knf_warnings.json"
        if knf.exists():
            d = json.loads(knf.read_text(encoding="utf-8"))
            self.meta["knf_warnings"] = {"source": d["source"], "url": d["url"], "fetched_at": d["fetched_at"], "count": len(d["entries"])}
            for e in d["entries"]:
                names = entry_names(e["names"])
                self._add("knf_warnings", names[0] if names else e["raw_name"][:120], names, e["domains"], e["krs"], e["nip"], {
                    "raw_name": e["raw_name"], "legal_basis": e["legal_basis"], "section": e["section"], "prosecutor": e["prosecutor"],
                    "judgments": e["judgments"], "info": e["info"], "source_url": d["url"]})
        esma = DATA / "esma_mica.json"
        if esma.exists():
            d = json.loads(esma.read_text(encoding="utf-8"))
            self.meta["esma_mica"] = {"source": d["source"], "url": d["url"], "fetched_at": d["fetched_at"],
                                      "casp": len(d["casp"]), "ncasp": len(d["ncasp"])}
            for kind in ("casp", "ncasp"):
                for e in d[kind]:
                    names = [n for n in {e["name"], e.get("commercial_name") or ""} if n]
                    self._add(f"esma_{kind}", e["name"], names, e["domains"], [], [], {**e, "source_url": d["url"]})
        sanc = DATA / "eu_sanctions.json"
        if sanc.exists():
            d = json.loads(sanc.read_text(encoding="utf-8"))
            self.meta["eu_sanctions"] = {"source": d["source"], "url": d["url"], "fetched_at": d["fetched_at"], "count": len(d["entries"])}
            for e in d["entries"]:
                data = {k: e.get(k) for k in ("type", "ref", "programme", "listed", "regulation", "birth_dates", "citizenships")}
                data["aliases"] = e["names"][:8]
                data["source_url"] = e.get("url") or d["url"]
                if e.get("type") == "person":
                    self._add_person(e["names"], data)
                else:
                    self._add("eu_sanctions", e["names"][0], e["names"], [], [], [], data)

    def _add_person(self, names: list[str], data: dict) -> None:
        """Osoba z listy sankcji: dopasowanie wyłącznie pełnego imienia i nazwiska (min. 2 człony)."""
        cores = []
        for n in names:
            tokens = [t for t in re.sub(r"[^\w\s]", " ", fold(n)).split() if len(t) >= 2]
            if len(tokens) >= 2:
                cores.append(" ".join(tokens))
        if cores:
            self.entries.append(Entry("eu_sanctions", names[0], cores, [], [], [], {**data, "person": True}))

    def _add(self, lst, name, names, domains, krs, nip, data) -> None:
        cores = []
        for n in names:
            c = core_name(n)
            distinctive = re.sub(r"\s+", " ", GENERIC.sub(" ", c)).strip()
            tokens = [t for t in distinctive.split() if t not in STOP_WORDS and t not in LEGAL_WORDS]
            # nazwy zbyt krótkie lub złożone ze słów ogólnych („Podmiot”, „Platforma”) nie są wyszukiwane w treści
            if tokens and (len(" ".join(tokens)) >= 5 or (len(" ".join(tokens)) >= 4 and " " in c)):
                cores.append(c)
        self.entries.append(Entry(lst, name, cores, [clean_domain(x) for x in domains], krs, nip, data))

    def check(self, text: str = "", domains: list[str] | None = None, krs: list[str] | None = None,
              nip: list[str] | None = None, name: str | None = None) -> list[dict]:
        folded = " " + re.sub(r"\s+", " ", re.sub(r"[^\w\s&]", " ", fold(text or ""))) + " "
        name_core = core_name(name) if name else None
        doms = [clean_domain(d) for d in (domains or []) if d]
        hits: dict[tuple, dict] = {}
        for e in self.entries:
            how = None
            if doms and any(domain_matches(d, ed) for d in doms for ed in e.domains):
                how = "domena"
            elif krs and set(krs) & set(e.krs):
                how = "KRS"
            elif nip and set(nip) & set(e.nip):
                how = "NIP"
            elif name_core and (name_core in e.cores or (e.data.get("person") and person_key(name) in {person_key(c) for c in e.cores})):
                how = "nazwa"
            # w treści tylko nazwy wielowyrazowe albo dłuższe (krótkie, np. „bridge”, „circle”, to zwykłe słowa)
            # lista sankcji: tylko nazwy wielowyrazowe (aliasy jednowyrazowe to często zwykłe słowa po przetłumaczeniu formy prawnej)
            elif any(f" {c} " in folded for c in e.cores if " " in c or (len(c) >= 7 and e.list != "eu_sanctions")):
                how = "nazwa w treści"
            if how and (e.list, e.name) not in hits:
                hits[(e.list, e.name)] = {"list": e.list, "name": e.name, "matched_by": how, "domains": e.domains, **e.data}
        order = {"knf_warnings": 0, "eu_sanctions": 1, "esma_ncasp": 2, "esma_casp": 3}
        return sorted(hits.values(), key=lambda h: (order[h["list"]], h["matched_by"] != "domena"))


@lru_cache(maxsize=1)
def get_watchlists() -> Watchlists:
    return Watchlists()
