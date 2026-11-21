"""Scraping Engine – API (FastAPI).

POST /scrape        pobranie i render URL
POST /scrape/html   analiza dostarczonego HTML (próbki danych od organizatorów)
POST /scrape/text   sam tekst (np. transkrypcja, post skopiowany ręcznie)
POST /discover      wyszukiwanie podstron z materiałami inwestycyjnymi w obrębie domeny
"""
from __future__ import annotations

import datetime as dt
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, HttpUrl

from .extract import content_hash, discover_links, extract, normalize_text, platform_for
from .net import UnsafeUrl, fetch, validate_url
from .render import Renderer

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


def _material(url: str, final_url: str, html: str, layout: dict) -> dict:
    data = extract(html, final_url)
    data.update({"url": url, "final_url": final_url, "fetched_at": _now(), "layout": layout,
                 "scraper_version": VERSION})
    return data


@app.get("/health")
async def health():
    return {"ok": True, "playwright": renderer.available, "version": VERSION}


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
    if req.render and renderer.available:
        try:
            rendered = await renderer.render(html=req.html)
            rendered.pop("html", None)
            rendered.pop("final_url", None)
            layout = rendered
        except Exception as exc:
            log.warning("render of provided html failed: %s", exc)
    return _material(req.url, req.url, req.html, layout)


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


@app.post("/discover")
async def discover(req: DiscoverReq):
    url = str(req.url)
    try:
        resp = await fetch(url)
    except UnsafeUrl as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(502, f"Nie udało się pobrać strony: {type(exc).__name__}")
    data = extract(resp.text, str(resp.url))
    return {"url": url, "candidates": discover_links(data["links"], str(resp.url), req.limit)}
