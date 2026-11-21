"""Lokalna baza referencyjna firm inwestycyjnych (snapshot rejestru KNF + wpisy demo).

Brak podmiotu w bazie NIE oznacza nielegalnej działalności – to sygnał do weryfikacji.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from rapidfuzz import fuzz, process

from .text import fold

DATA = Path(__file__).parent / "data"

LEGAL_FORMS = re.compile(
    r"\b(?:s\.?\s?a\.?|sp\.?\s?z\s?o\.?\s?o\.?|sp\.?\s?k\.?|spolka akcyjna|spolka z ograniczona odpowiedzialnoscia|"
    r"ltd\.?|limited|gmbh|ag|plc|llc|inc\.?|b\.?v\.?|n\.?v\.?|s\.?r\.?o\.?|a\.?s\.?|s\.?a\.?r\.?l\.?|se|sas|kft|oyj|ab|asa|"
    r"oddzial w polsce|oddzial|branch|w likwidacji|europe|holding)\b\.?",
    re.I,
)
GENERIC = re.compile(r"\b(?:dom maklerski|biuro maklerskie|bank|towarzystwo funduszy inwestycyjnych|tfi|investment|investments|"
                     r"capital|securities|financial|services|markets|management|asset|group|global|international|polska|poland)\b")
ENTITY_RX = re.compile(
    r"([A-ZĄĆĘŁŃÓŚŹŻ0-9][\w&.\-ĄĆĘŁŃÓŚŹŻąćęłńóśźż]*(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ0-9&][\w&.\-ĄĆĘŁŃÓŚŹŻąćęłńóśźż]*){0,5})\s*,?\s+"
    r"(S\.A\.|Sp\.\s?z\s?o\.o\.|sp\.\s?z\s?o\.o\.|Ltd\.?|Limited|GmbH|AG|PLC|plc|LLC|B\.V\.|S\.à r\.l\.|AS|SE|sp\.k\.)"
)


def domain_matches(host: str | None, domain: str) -> bool:
    """host == domena albo jej subdomena (granica etykiety, nie sam sufiks znaków)."""
    host = (host or "").lower().rstrip(".")
    domain = domain.lower().strip(".")
    return bool(domain) and (host == domain or host.endswith("." + domain))


def core_name(name: str) -> str:
    s = fold(name)
    s = LEGAL_FORMS.sub(" ", s)
    s = re.sub(r"[^\w\s&]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


@dataclass
class Firm:
    name: str
    core: str
    distinctive: str
    category: str
    country: str | None
    supervisor: str | None
    license_date: str | None
    scope: str | None
    demo: bool
    domains: list[str]
    former_names: list[str]

    def public(self) -> dict:
        out = {k: v for k, v in self.__dict__.items() if k not in ("core", "distinctive")}
        # proweniencja: wpisy demo nigdy nie są przedstawiane jako wpis w rejestrze KNF
        out["registry_status"] = "demo" if self.demo else "registered"
        return out


class Registry:
    def __init__(self) -> None:
        self.firms: list[Firm] = []
        self.meta: dict = {}
        self._load()
        self._cores = [f.core for f in self.firms]

    def _add(self, raw: dict, demo: bool) -> None:
        names = [raw["name"], *raw.get("former_names", []), *raw.get("aliases", [])]
        for i, n in enumerate(names):
            core = core_name(n)
            if len(core) < 3:
                continue
            distinctive = re.sub(r"\s+", " ", GENERIC.sub(" ", core)).strip()
            self.firms.append(Firm(
                # nazwa złożona wyłącznie ze słów ogólnych (np. „Dom Maklerski INC”) nie jest wyszukiwana w treści
                name=raw["name"], core=core, distinctive=distinctive if len(distinctive) >= 3 else "",
                category=raw.get("category", "unknown"), country=raw.get("country"), supervisor=raw.get("supervisor"),
                license_date=raw.get("license_date"), scope=raw.get("scope"), demo=demo, domains=raw.get("domains", []),
                former_names=raw.get("former_names", []) if i == 0 else [],
            ))

    def _load(self) -> None:
        knf = DATA / "knf_registry.json"
        if knf.exists():
            data = json.loads(knf.read_text(encoding="utf-8"))
            self.meta = {"source": data.get("source"), "fetched_at": data.get("fetched_at"), "lists": data.get("lists")}
            for f in data["firms"]:
                self._add(f, demo=False)
        demo = DATA / "demo_registry.json"
        if demo.exists() and os.getenv("DEMO_REGISTRY", "true").lower() == "true":
            for f in json.loads(demo.read_text(encoding="utf-8"))["firms"]:
                self._add(f, demo=True)

    def lookup(self, name: str, min_score: int = 88) -> dict | None:
        """Dopasowanie nazwy podmiotu do rejestru (fuzzy, bez formy prawnej)."""
        core = core_name(name)
        if len(core) < 3 or not self._cores:
            return None
        match = process.extractOne(core, self._cores, scorer=fuzz.token_sort_ratio)
        if match and match[1] >= min_score:
            firm = self.firms[match[2]]
            return {**firm.public(), "match_score": round(match[1], 1), "matched_as": core}
        return None

    def find_in_text(self, text: str, domain: str | None = None) -> list[dict]:
        """Wyszukanie nazw firm z rejestru w treści materiału."""
        folded = " " + re.sub(r"[^\w\s&]", " ", fold(text)) + " "
        folded = re.sub(r"\s+", " ", folded)
        hits: dict[str, dict] = {}
        for firm in self.firms:
            for variant in ({firm.core, firm.distinctive} if firm.distinctive else ()):
                if len(variant) < 4 and " " not in variant:
                    continue  # zbyt krótkie nazwy dają fałszywe trafienia
                if f" {variant} " in folded and firm.name not in hits:
                    hits[firm.name] = {**firm.public(), "matched_as": variant}
            if domain and any(domain_matches(domain, d) for d in firm.domains) and firm.name not in hits:
                hits[firm.name] = {**firm.public(), "matched_as": f"domena {domain}"}
        return list(hits.values())

    def search(self, q: str, limit: int = 10) -> list[dict]:
        core = core_name(q)
        if not core:
            return []
        res = process.extract(core, self._cores, scorer=fuzz.WRatio, limit=limit)
        seen, out = set(), []
        for _, score, idx in res:
            f = self.firms[idx]
            if f.name not in seen and score >= 60:
                seen.add(f.name)
                out.append({**f.public(), "score": round(score, 1)})
        return out


def extract_entity_names(text: str) -> list[str]:
    """Nazwy podmiotów z formą prawną (S.A., sp. z o.o., Ltd ...) występujące w treści."""
    out = []
    for m in ENTITY_RX.finditer(text):
        name = f"{m.group(1).strip()} {m.group(2)}"
        words = m.group(1).split()
        if words and words[0].lower() in {"w", "z", "i", "oraz", "przez", "the", "and"}:
            name = " ".join(words[1:]) + " " + m.group(2)
        if len(name) > 5 and name not in out:
            out.append(name)
    return out[:20]


@lru_cache(maxsize=1)
def get_registry() -> Registry:
    return Registry()
