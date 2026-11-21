"""Silnik analityczny InvestWatch – API (FastAPI).

POST /analyze          materiał (JSON ze scrapera) -> zunifikowany wynik modułów 1-3
POST /summary          wynik analizy -> podsumowanie (Ollama lub szablon)
GET  /rules            katalog reguł Modułu 2
GET  /registry/search  wyszukiwanie w rejestrze KNF
GET  /registry/check   dopasowanie nazwy podmiotu do rejestru
"""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query
from pydantic import BaseModel, Field

from . import m1, m3, rules_m2
from .classifier import get_classifier, simhash
from .model import Doc
from .registry import get_registry
from .scoring import aggregate
from .summary import summarize

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
VERSION = "0.1.0"


class Material(BaseModel):
    url: str = Field(max_length=4096)
    final_url: str | None = None
    title: str | None = None
    author: str | None = None
    publisher: str | None = None
    published_at: str | None = None
    lang: str | None = None
    description: str | None = None
    platform: str | None = "web"
    social_handle: str | None = None
    content_text: str = Field(max_length=1_000_000)
    full_text: str | None = Field(default=None, max_length=2_000_000)
    links: list[dict] = []
    layout: dict = {}

    model_config = {"extra": "ignore"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_registry()      # wczytanie rejestru i trening klasyfikatora przy starcie
    get_classifier()
    yield


app = FastAPI(title="InvestWatch Analyzer", version=VERSION, lifespan=lifespan)


@app.get("/health")
def health():
    reg = get_registry()
    clf = get_classifier()
    return {"ok": True, "version": VERSION, "registry_firms": len({f.name for f in reg.firms}),
            "registry_fetched_at": reg.meta.get("fetched_at"), "classifier": clf.version}


def analyze_material(m: dict) -> dict:
    t0 = time.perf_counter()
    doc = Doc.from_material(m)
    clf = get_classifier()
    clf.label(doc.sentences)
    r1 = m1.run(doc)
    f2 = rules_m2.run(doc)
    r3 = m3.run(doc)
    by_module = {"m1": r1["findings"], "m2": f2, "m3": r3["findings"]}
    agg = aggregate(by_module)
    findings = [f.to_dict() for fs in by_module.values() for f in fs]
    return {
        **agg,
        "findings": findings,
        "m1": {"firms": r1["firms"], "instruments": r1["instruments"], "publisher": r1["publisher"]},
        "m3": {"classification": r3["classification"], "entities": r3["entities"]},
        "ml": {"model": clf.version, "train_size": clf.n_train, **clf.document_profile(doc.sentences)},
        "doc": {"lang": doc.lang, "domain": doc.domain, "sentences": len(doc.sentences), "layout": doc.layout.get("engine"),
                "simhash": simhash(doc.content_text)},
        "analyzer_version": VERSION,
        "elapsed_ms": round((time.perf_counter() - t0) * 1000),
    }


@app.post("/analyze")
def analyze(m: Material):
    return analyze_material(m.model_dump())


class SummaryReq(BaseModel):
    result: dict


@app.post("/summary")
async def summary(req: SummaryReq):
    text, engine = await summarize(req.result)
    return {"summary": text, "engine": engine}


@app.get("/rules")
def rules():
    return [{"rule_id": k, "title": t, "legal_basis": b, "weight": w, "visual": k in rules_m2.VISUAL_RULES}
            for k, (t, b, w) in rules_m2.CATALOG.items()]


@app.get("/registry/search")
def registry_search(q: str = Query(min_length=2, max_length=200)):
    return get_registry().search(q)


@app.get("/registry/check")
def registry_check(name: str = Query(min_length=2, max_length=300)):
    reg = get_registry()
    hit = reg.lookup(name)
    return {"name": name, "status": "registered" if hit else "not_found", "match": hit,
            "note": None if hit else "Brak w lokalnym rejestrze KNF nie oznacza nielegalnej działalności – sygnał do weryfikacji.",
            "registry": reg.meta}
