"""Scraping Engine – API (FastAPI).

POST /scrape        pobranie i render URL
POST /scrape/html   analiza dostarczonego HTML (próbki danych od organizatorów)
POST /scrape/text   sam tekst (np. transkrypcja, post skopiowany ręcznie)
POST /discover      wyszukiwanie podstron z materiałami inwestycyjnymi w obrębie domeny
"""
from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import json
import logging
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, HttpUrl

from .extract import content_hash, discover_links, extract, normalize_text, platform_for
from .net import UnsafeUrl, fetch, validate_url
from . import ocr
from .render import Renderer, SourceHttpError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("scraper")
renderer = Renderer()
VERSION = "0.1.0"


@asynccontextmanager
async def lifespan(_: FastAPI):
    await renderer.start()
    yield
    await renderer.stop()


app = FastAPI(title="InvestWatch Scraper", version=VERSION, lifespan=lifespan)


class ScrapeReq(BaseModel):
    url: HttpUrl
    render: bool = True


class HtmlReq(BaseModel):
    html: str = Field(min_length=1, max_length=5_000_000)
    url: str = Field(default="about:sample", max_length=2048)
    render: bool = True
    title: str | None = Field(default=None, max_length=500)
    author: str | None = Field(default=None, max_length=200)
    platform: str | None = Field(default=None, max_length=30)


class ImageReq(BaseModel):
    image: str = Field(min_length=20, max_length=14_500_000, description="base64 lub data URL (PNG/JPEG/WebP)")
    url: str = Field(default="about:image", max_length=2048)
    title: str | None = Field(default=None, max_length=500)
    author: str | None = Field(default=None, max_length=200)
    platform: str | None = Field(default=None, max_length=30)


class TextReq(BaseModel):
    text: str = Field(min_length=1, max_length=500_000)
    url: str = Field(default="about:text", max_length=2048)
    title: str | None = None
    author: str | None = None
    platform: str | None = None


class DiscoverReq(BaseModel):
    url: HttpUrl
    limit: int = Field(default=10, ge=1, le=50)


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


RISK_HINT = re.compile(r"ryzyk|strat|utrat|risk|lose|loss", re.I)


def layout_hash(layout: dict) -> str | None:
    """Odcisk cech wizualnych ostrzeżeń (rozmiar, kontrast, widoczność, położenie) – zmiana wyglądu
    reklamy przy tej samej treści daje nową wersję materiału zamiast duplikatu."""
    feats = []
    for vp, data in sorted((layout.get("viewports") or {}).items()):
        for b in data.get("blocks", []):
            if RISK_HINT.search(b["text"]):
                feats.append([vp, b["text"][:120], round(b["font_size"]), round(b["contrast"], 1), b["visible"],
                              b["in_collapsed"], b["in_footer"], b["in_fine_print"], b["clipped"], b.get("clipped_y"),
                              b["occluded"], round(b.get("opacity", 1), 1)])
    if not layout.get("viewports"):
        return None
    return hashlib.sha256(json.dumps(feats, ensure_ascii=False).encode()).hexdigest()


def _material(url: str, final_url: str, html: str, layout: dict) -> dict:
    data = extract(html, final_url)
    data.update({"url": url, "final_url": final_url, "fetched_at": _now(), "layout": layout,
                 "layout_hash": layout_hash(layout), "scraper_version": VERSION})
    return data


@app.get("/health")
async def health():
    return {"ok": True, "playwright": renderer.available, "ocr": ocr.available(), "version": VERSION}


@app.post("/scrape")
async def scrape(req: ScrapeReq):
    url = str(req.url)
    try:
        validate_url(url)
    except UnsafeUrl as exc:
        raise HTTPException(400, str(exc))
    layout: dict = {"engine": "none"}
    html = None
    final_url = url
    if req.render and renderer.available:
        try:
            rendered = await renderer.render(url=url)
            html, final_url = rendered.pop("html"), rendered.pop("final_url")
            layout = rendered
        except SourceHttpError as exc:
            raise HTTPException(502, str(exc))
        except Exception as exc:
            log.warning("render failed for %s: %s", url, exc)
            layout = {"engine": "none", "reason": f"render_error: {type(exc).__name__}"}
    if html is None:
        try:
            resp = await fetch(url)
        except UnsafeUrl as exc:
            raise HTTPException(400, str(exc))
        except Exception as exc:
            raise HTTPException(502, f"Nie udało się pobrać strony: {type(exc).__name__}")
        if resp.status_code >= 400:
            raise HTTPException(502, f"Źródło zwróciło HTTP {resp.status_code}")
        html, final_url = resp.text, str(resp.url)
    return _material(url, final_url, html, layout)


@app.post("/scrape/html")
async def scrape_html(req: HtmlReq):
    layout: dict = {"engine": "none"}
    html = req.html
    if req.render and renderer.available:
        try:
            rendered = await renderer.render(html=req.html)
            # ekstrakcja z DOM po renderze – ta sama migawka co pomiary layoutu
            html = rendered.pop("html", None) or req.html
            rendered.pop("final_url", None)
            layout = rendered
        except Exception as exc:
            log.warning("render of provided html failed: %s", exc)
    material = _material(req.url, req.url, html, layout)
    # metadane podane ręcznie przez analityka mają pierwszeństwo przed odczytanymi z dokumentu
    for key in ("title", "author", "platform"):
        if getattr(req, key):
            material[key] = getattr(req, key)
    return material


@app.post("/scrape/text")
async def scrape_text(req: TextReq):
    text = normalize_text(req.text)
    return {
        "url": req.url, "final_url": req.url, "fetched_at": _now(), "title": req.title,
        "author": req.author, "publisher": None, "published_at": None, "lang": None,
        "platform": req.platform or platform_for(req.url), "social_handle": None,
        "content_text": text, "full_text": text, "content_hash": content_hash(text),
        "links": [], "layout": {"engine": "none", "reason": "text_only"}, "scraper_version": VERSION,
    }


@app.post("/scrape/image")
async def scrape_image(req: ImageReq):
    """Zrzut/grafika reklamy -> OCR -> materiał z blokami (pozycja, wysokość liter, kontrast)."""
    try:
        raw = ocr.decode_image(req.image)
        data = await asyncio.to_thread(ocr.ocr_image, raw)
    except ocr.OcrUnavailable as exc:
        raise HTTPException(501, str(exc))
    except ValueError as exc:
        raise HTTPException(422, f"Niepoprawny obraz: {exc}")
    except Exception as exc:  # uszkodzony plik / nieobsługiwany format
        raise HTTPException(422, f"Nie udało się odczytać obrazu: {type(exc).__name__}")
    if not data["content_text"].strip():
        raise HTTPException(422, "Nie rozpoznano tekstu na obrazie")
    text = data["content_text"]
    return {
        "url": req.url, "final_url": req.url, "fetched_at": _now(), "title": req.title, "author": req.author,
        "publisher": None, "published_at": None, "lang": None, "platform": req.platform or platform_for(req.url),
        "social_handle": None, "content_hash": content_hash(text), "layout_hash": layout_hash(data["layout"]),
        "scraper_version": VERSION, **data,
    }


@app.post("/discover")
async def discover(req: DiscoverReq):
    url = str(req.url)
    try:
        resp = await fetch(url)
    except UnsafeUrl as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(502, f"Nie udało się pobrać strony: {type(exc).__name__}")
    if resp.status_code >= 400:
        raise HTTPException(502, f"Źródło zwróciło HTTP {resp.status_code}")
    data = extract(resp.text, str(resp.url))
    return {"url": url, "candidates": discover_links(data["links"], str(resp.url), req.limit)}
