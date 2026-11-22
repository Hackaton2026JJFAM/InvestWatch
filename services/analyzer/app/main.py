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

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from . import enrich, m1, m3, markets, profile, reserves, rules_m2, signals
from .classifier import get_classifier, simhash
from .model import Doc
from .registry import get_registry
from .watchlists import get_watchlists
from .scoring import aggregate, SCAM_FLOOR
from .context import investment_context
from .model import Finding, NA
from .summary import summarize

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
VERSION = "0.1.0"


class Block(BaseModel):
    """Blok tekstu z renderu (kontrakt ze scraperem). Braki uzupełniane neutralnymi wartościami."""
    text: str = Field(max_length=5000)
    tag: str | None = None
    font_size: float = Field(default=16, ge=0, le=1000)
    font_size_min: float | None = None
    font_weight: int | None = None
    color: list[float] = [0, 0, 0]
    bg: list[float] = [255, 255, 255]
    contrast: float = Field(default=21, ge=0, le=21)
    opacity: float = Field(default=1, ge=0, le=1)
    x: float = 0
    y: float = 0
    w: float = 0
    h: float = 0
    visible: bool = True
    occluded: bool = False
    clipped: bool = False
    clipped_y: bool = False
    offscreen_x: bool = False
    in_footer: bool = False
    in_fine_print: bool = False
    in_collapsed: bool = False
    in_modal: bool = False
    is_link: bool = False
    href: str | None = None
    in_image: bool = False             # napis odczytany OCR z grafiki na stronie
    video_t: float | None = None       # wideo: sekunda pierwszego pojawienia się napisu
    seen_s: float | None = None        # wideo: przez ile sekund napis był na ekranie

    model_config = {"extra": "ignore"}


class Viewport(BaseModel):
    width: int = Field(gt=0, le=10000)
    height: int = Field(gt=0, le=20000)
    page_height: int | None = None
    screenshot_height: int | None = None
    blocks: list[Block] = Field(default=[], max_length=5000)


class Layout(BaseModel):
    engine: str = "none"
    reason: str | None = None
    viewports: dict[str, Viewport] = {}
    video: dict | None = None

    model_config = {"extra": "ignore"}


class Link(BaseModel):
    text: str = Field(default="", max_length=2000)
    href: str = Field(max_length=4096)


class Material(BaseModel):
    url: str = Field(min_length=1, max_length=4096)
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
    links: list[Link] = Field(default=[], max_length=2000)
    layout: Layout = Layout()
    transcript: dict | None = None     # wideo: transkrypcja mowy (Whisper)

    model_config = {"extra": "ignore"}

    @field_validator("content_text")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Treść materiału jest pusta")
        return v


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_registry()      # wczytanie rejestru i trening klasyfikatora przy starcie
    get_classifier()
    get_watchlists()
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
    edu = rules_m2.education_index(doc)
    f2 = rules_m2.run(doc, edu)
    r3 = m3.run(doc)
    sig = signals.run(doc, r3["classification"])
    advertised = any(f.rule_id == "M1.1" and f.status != "na" for f in r1["findings"])
    prof = profile.run(doc, r3["classification"], sig["hits"], r1["publisher"]["type"], advertised)
    # reguły informacji o ryzyku i ocena obietnic zysku – tylko dla treści inwestycyjnych (gry, Steam, konkursy: nie dotyczy)
    ctx = investment_context(doc, r1["firms"], r3["classification"], prof["profile"]["signals"], prof["profile"]["returns"])
    if not ctx["investment"]:
        f2 = [Finding("m2", f.rule_id, f.title, NA, 0, f.legal_basis,
                      "Nie dotyczy – materiał nie dotyczy inwestycji ani instrumentów finansowych (brak instrumentów, firm inwestycyjnych, "
                      "oferty doradczej i słownictwa inwestycyjnego).") for f in f2]
        prof["findings"] = [f for f in prof["findings"] if f.rule_id != "M1.9"]
    extra = sig["findings"] + prof["findings"]
    by_module = {"m1": r1["findings"] + [f for f in extra if f.module == "m1"], "m2": f2,
                 "m3": r3["findings"] + [f for f in extra if f.module == "m3"]}
    agg = aggregate(by_module)
    # mocne sygnały oszustwa zawsze widoczne w ocenie: ryzyko nie niższe niż wynik sygnałów (M1 – reklamy i publikujący)
    scam = prof["profile"]["scam_score"]
    if scam >= SCAM_FLOOR and scam > agg["module_scores"].get("m1", 0):
        agg["module_scores"]["m1"] = float(scam)
        agg["score"] = max(agg["score"], float(scam))
        agg["modules"] = [m for m, v in agg["module_scores"].items() if v >= 20]
        agg["score_floor"] = "scam_signals"
    findings = [f.to_dict() for fs in by_module.values() for f in fs]
    return {
        **agg,
        "findings": findings,
        "m1": {"firms": r1["firms"], "instruments": r1["instruments"], "publisher": r1["publisher"]},
        "m3": {"classification": r3["classification"], "entities": r3["entities"], "license": r3.get("license")},
        "profile": prof["profile"],
        "watchlists": sig["hits"],
        "ml": {"model": clf.version, "train_size": clf.n_train, **clf.document_profile(doc.sentences),
               "embedding": clf.embed(doc.sentences)},
        "context": ctx,
        "education": edu,
        "doc": {"lang": doc.lang, "domain": doc.domain, "sentences": len(doc.sentences), "layout": doc.layout.get("engine"),
                "simhash": simhash(doc.content_text), "highlights": rules_m2.highlights(doc),
                "identifiers": sig["identifiers"]},
        "analyzer_version": VERSION,
        "elapsed_ms": round((time.perf_counter() - t0) * 1000),
    }


@app.post("/analyze")
def analyze(m: Material):
    return analyze_material(m.model_dump())


class FindingIn(BaseModel):
    module: str
    rule_id: str
    title: str
    status: str
    severity: int = 0
    legal_basis: str | None = None
    explanation: str = ""
    evidence: list[dict] = []


class ResultIn(BaseModel):
    """Minimalny kontrakt wyniku analizy potrzebny do podsumowania."""
    score: float = Field(ge=0, le=100)
    modules: list[str] = []
    findings: list[FindingIn]

    model_config = {"extra": "allow"}


class SummaryReq(BaseModel):
    result: ResultIn


@app.post("/summary")
async def summary(req: SummaryReq):
    text, engine = await summarize(req.result.model_dump())
    return {"summary": text, "engine": engine}


@app.exception_handler(Exception)
async def unexpected(_: Request, exc: Exception):
    # Spójny JSON także dla błędów nieprzewidzianych (bez szczegółów wewnętrznych).
    logging.getLogger("analyzer").exception("unhandled error: %s", type(exc).__name__)
    return JSONResponse(status_code=500, content={"detail": "Błąd wewnętrzny analizatora"})


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
    if hit and hit.get("demo"):
        status, note = "demo", "Podmiot fikcyjny z danych demonstracyjnych – nie jest wpisem w rejestrze KNF."
    elif hit:
        status, note = "registered", None
    else:
        status, note = "not_found", "Brak w lokalnym rejestrze KNF nie oznacza nielegalnej działalności – sygnał do weryfikacji."
    return {"name": name, "status": status, "match": hit, "note": note, "registry": reg.meta}


# ---------------------------------------------------------------------------- wzbogacanie danych
def _upstream(fn, *args, **kw):
    try:
        return fn(*args, **kw)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except enrich.NotFound as exc:
        raise HTTPException(404, str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Rejestr niedostępny: {type(exc).__name__}")


@app.get("/enrich/krs/{number}")
def enrich_krs(number: str, full: bool = False):
    return _upstream(enrich.krs, number, full=full)


@app.get("/enrich/gleif")
def enrich_gleif(name: str | None = Query(default=None, max_length=300), lei: str | None = Query(default=None, max_length=20),
                 country: str | None = Query(default=None, pattern=r"^[A-Z]{2}$")):
    return _upstream(enrich.gleif, name=name, lei=lei, country=country)


@app.get("/enrich/gleif/{lei}")
def enrich_gleif_detail(lei: str):
    return _upstream(enrich.gleif_detail, lei)


@app.get("/watchlists/check")
def watchlists_check(name: str | None = Query(default=None, max_length=300), domain: str | None = Query(default=None, max_length=300),
                     krs: str | None = Query(default=None, pattern=r"^[0-9]{10}$"), nip: str | None = Query(default=None, pattern=r"^[0-9]{10}$")):
    hits = get_watchlists().check(name=name, domains=[domain] if domain else [], krs=[krs] if krs else [], nip=[nip] if nip else [])
    return {"hits": hits, "meta": get_watchlists().meta}


@app.get("/watchlists/meta")
def watchlists_meta():
    return get_watchlists().meta


# ---------------------------------------------------------------------------- kryzysy (GPW)
class CrisisReq(BaseModel):
    ticker: str = Field(min_length=2, max_length=20)
    crisis: str = Field(default="covid2020", max_length=30)
    start: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    end: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


@app.get("/markets/crises")
def markets_crises():
    return markets.CRISES


@app.get("/markets/gpw/instruments")
def markets_instruments(date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")):
    try:
        return {"date": date, "instruments": markets.instruments(date)}
    except (markets.MarketDataUnavailable, httpx.HTTPError) as exc:
        raise HTTPException(502, str(exc) or "Archiwum GPW niedostępne")


@app.post("/markets/gpw/crisis")
def markets_crisis(req: CrisisReq):
    try:
        return markets.crisis_report(req.ticker, req.crisis, req.start, req.end)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    except markets.MarketDataUnavailable as exc:
        raise HTTPException(502, str(exc))


# ---------------------------------------------------------------------------- proof of reserves
@app.get("/reserves/okx")
def reserves_okx(force: bool = False):
    try:
        return reserves.okx_report(force=force)
    except reserves.ReportUnavailable as exc:
        raise HTTPException(502, str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Raport niedostępny: {type(exc).__name__}")
