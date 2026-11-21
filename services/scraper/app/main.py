"""Scraping Engine – API (FastAPI).

POST /scrape        pobranie i render URL
POST /scrape/html   analiza dostarczonego HTML (próbki danych od organizatorów)
POST /scrape/text   sam tekst (np. transkrypcja, post skopiowany ręcznie)
POST /scrape/image  grafika reklamy / zdjęcie -> OCR
POST /scrape/video  wideo z platformy (TikTok, Instagram, YouTube, Facebook, X, …) -> transkrypcja + OCR klatek
POST /scrape/video/file  surowy plik wideo w treści żądania (application/octet-stream)
POST /discover      wyszukiwanie podstron z materiałami inwestycyjnymi w obrębie domeny

/scrape rozpoznaje adresy wideo i bezpośrednie linki do obrazów i kieruje je do właściwego potoku;
przy renderze strony największe grafiki (banery) przechodzą OCR.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import json
import logging
import os
import re
import tempfile
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field, HttpUrl

from .extract import content_hash, discover_links, extract, normalize_text, platform_for
from .net import UnsafeUrl, fetch, validate_url
from . import ocr, video
from .render import Renderer, SourceHttpError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("scraper")
renderer = Renderer()
VERSION = "0.1.0"


@asynccontextmanager
async def lifespan(_: FastAPI):
    await renderer.start()
    if os.getenv("WHISPER_PRELOAD", "false").lower() == "true":
        # model pobiera się i ładuje w tle – pierwsze wideo nie czeka na pobranie ~0,5 GB
        asyncio.get_running_loop().run_in_executor(None, video.preload)
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


class VideoReq(BaseModel):
    url: HttpUrl
    title: str | None = Field(default=None, max_length=500)
    author: str | None = Field(default=None, max_length=200)
    platform: str | None = Field(default=None, max_length=30)


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


def _fold_words(s: str) -> set[str]:
    return {w for w in re.findall(r"\w+", s.lower()) if len(w) > 2}


def ocr_page_images(images: list[dict], page_text: str) -> tuple[list[dict], dict]:
    """OCR grafik ze strony -> bloki w układzie strony (współrzędne i czcionka w px renderu).
    Pomija napisy, które i tak są w DOM (tekst alternatywny, nakładka HTML)."""
    if not images or not ocr.available():
        return [], {"images": len(images), "ocr": ocr.available(), "blocks": 0}
    page_words = _fold_words(page_text)
    out: list[dict] = []
    for im in images:
        try:
            data = ocr.ocr_image(im["png"])
        except Exception as exc:
            log.info("page image OCR skipped: %s", type(exc).__name__)
            continue
        k = im["w"] / ocr.TARGET_W  # bloki OCR są w skali 1366 px szerokości obrazu
        for b in data["layout"]["viewports"]["desktop"]["blocks"]:
            words = _fold_words(b["text"])
            if len(words) < 2 or len(words & page_words) / len(words) > 0.8:
                continue
            out.append({**b, "tag": "img-ocr", "in_image": True, "image_src": im.get("src"),
                        "x": round(im["x"] + b["x"] * k), "y": round(im["y"] + b["y"] * k),
                        "w": round(b["w"] * k), "h": round(b["h"] * k),
                        "font_size": round(b["font_size"] * k, 1), "font_size_min": round(b["font_size"] * k, 1),
                        "in_footer": bool(im.get("in_footer")) or b["in_footer"],
                        "is_link": bool(im.get("is_link")), "href": im.get("href")})
    return out, {"images": len(images), "ocr": True, "blocks": len(out)}


def _material(url: str, final_url: str, html: str, layout: dict, image_blocks: list[dict] | None = None,
              image_meta: dict | None = None) -> dict:
    data = extract(html, final_url)
    data.update({"url": url, "final_url": final_url, "fetched_at": _now(), "layout": layout, "scraper_version": VERSION})
    if image_meta is not None:
        layout["image_ocr"] = image_meta
    if image_blocks and layout.get("viewports", {}).get("desktop"):
        layout["viewports"]["desktop"]["blocks"].extend(image_blocks)
        extra = "\n".join(b["text"] for b in image_blocks)
        data["full_text"] = ((data.get("full_text") or data.get("content_text") or "") + "\n" + extra).strip()
        data["content_text"] = ((data.get("content_text") or "") + "\n" + extra).strip()
    data["layout_hash"] = layout_hash(layout)
    return data


async def _page_image_ocr(layout: dict, html: str) -> tuple[list[dict], dict | None]:
    images = layout.pop("_images", None) or []
    if not images:
        return [], None
    text = re.sub(r"<[^>]+>", " ", html)
    return await asyncio.to_thread(ocr_page_images, images, text)


IMAGE_EXT = re.compile(r"\.(png|jpe?g|webp|gif|bmp|tiff?)$", re.I)
URL_RE = re.compile(r"(?:https?://)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:/\S*)?")


def _image_material(raw: bytes, url: str, title=None, author=None, platform=None) -> dict:
    data = ocr.ocr_image(raw)
    if not data["content_text"].strip():
        raise ValueError("Nie rozpoznano tekstu na obrazie")
    text = data["content_text"]
    return {
        "url": url, "final_url": url, "fetched_at": _now(), "title": title, "author": author,
        "publisher": None, "published_at": None, "lang": None, "platform": platform or platform_for(url),
        "social_handle": None, "content_hash": content_hash(text), "layout_hash": layout_hash(data["layout"]),
        "scraper_version": VERSION, **data,
    }


def _video_material(data: dict, url: str, title=None, author=None, platform=None) -> dict:
    text = normalize_text(data.get("full_text") or "")
    if not text.strip():
        raise video.VideoRejected("Nie rozpoznano mowy ani tekstu w wideo")
    layout = data["layout"]
    # transkrypcja trafia też do layoutu – zapisuje się razem z materiałem bez zmian schematu bazy
    layout.setdefault("video", {}).update({"transcript": data.get("transcript"), "transcript_timed": data.get("transcript_timed"),
                                           "meta": data.get("video_meta")})
    return {
        "url": url, "final_url": data.get("final_url") or url, "fetched_at": _now(),
        "title": title or data.get("title"), "author": author or data.get("author"), "publisher": None,
        "published_at": data.get("published_at"), "lang": (data.get("transcript") or {}).get("language"),
        "description": data.get("description"),
        "platform": platform or video.platform_of(url) or platform_for(url), "social_handle": data.get("social_handle"),
        "content_text": normalize_text(data.get("content_text") or text), "full_text": text, "content_hash": content_hash(text),
        "links": [{"text": u, "href": u if u.startswith("http") else f"https://{u}"} for u in sorted(set(URL_RE.findall(text.lower())))][:50],
        "layout": layout, "layout_hash": layout_hash(layout) if layout.get("viewports") else None,
        "transcript": data.get("transcript"), "scraper_version": VERSION,
    }


def _video_error(exc: Exception) -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, UnsafeUrl):
        return HTTPException(400, str(exc))
    if isinstance(exc, video.VideoRejected):
        return HTTPException(422, str(exc))
    if isinstance(exc, video.VideoUnavailable) and "zalogowania" in str(exc):
        return HTTPException(422, str(exc))  # ponawianie nic nie zmieni – potrzebny plik od analityka
    if isinstance(exc, video.VideoUnavailable):
        # brak narzędzi = 501 (nie ponawiać); problem po stronie platformy = 502
        return HTTPException(501 if str(exc).startswith("Brak ") else 502, str(exc))
    log.exception("video processing failed")
    return HTTPException(422, f"Nie udało się przetworzyć wideo: {type(exc).__name__}")


@app.get("/health")
async def health():
    return {"ok": True, "playwright": renderer.available, "ocr": ocr.available(), "video": video.capabilities(), "version": VERSION}


@app.post("/scrape")
async def scrape(req: ScrapeReq):
    url = str(req.url)
    try:
        validate_url(url)
    except UnsafeUrl as exc:
        raise HTTPException(400, str(exc))
    if video.is_video_url(url):
        return await scrape_video(VideoReq(url=url))
    if IMAGE_EXT.search(req.url.path or ""):
        return await _scrape_image_url(url)
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
        if resp.headers.get("content-type", "").startswith("image/"):
            return await _image_from_bytes(resp.content, url)
        html, final_url = resp.text, str(resp.url)
    blocks, meta = await _page_image_ocr(layout, html)
    return _material(url, final_url, html, layout, blocks, meta)


async def _image_from_bytes(raw: bytes, url: str) -> dict:
    try:
        return await asyncio.to_thread(_image_material, raw, url)
    except ocr.OcrUnavailable as exc:
        raise HTTPException(501, str(exc))
    except Exception as exc:
        raise HTTPException(422, f"Nie udało się odczytać obrazu: {exc if isinstance(exc, ValueError) else type(exc).__name__}")


async def _scrape_image_url(url: str) -> dict:
    """Bezpośredni link do grafiki/zdjęcia reklamy -> OCR."""
    try:
        resp = await fetch(url)
    except UnsafeUrl as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(502, f"Nie udało się pobrać obrazu: {type(exc).__name__}")
    if resp.status_code >= 400:
        raise HTTPException(502, f"Źródło zwróciło HTTP {resp.status_code}")
    return await _image_from_bytes(resp.content, url)


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
    blocks, meta = await _page_image_ocr(layout, html)
    material = _material(req.url, req.url, html, layout, blocks, meta)
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


_video_slots = asyncio.Semaphore(int(os.getenv("VIDEO_CONCURRENCY", "1")))  # Whisper na CPU – po jednym


@app.post("/scrape/video")
async def scrape_video(req: VideoReq):
    """Reels/shorts/filmy z platform -> mowa (Whisper) + napisy na ekranie (OCR klatek) -> materiał."""
    url = str(req.url)
    async with _video_slots:
        try:
            data = await asyncio.to_thread(video.process_url, url)
            return _video_material(data, url, req.title, req.author, req.platform)
        except Exception as exc:
            raise _video_error(exc)


@app.post("/scrape/video/file")
async def scrape_video_file(request: Request, url: str = Query(default="upload://video", max_length=2048),
                            title: str | None = Query(default=None, max_length=500),
                            author: str | None = Query(default=None, max_length=200),
                            platform: str | None = Query(default=None, max_length=30)):
    """Plik wideo (mp4/webm/mov…) w treści żądania – materiały wymagające logowania albo z dysku."""
    fd, path = tempfile.mkstemp(prefix="iw-upload-", suffix=".bin")
    try:
        size = 0
        with os.fdopen(fd, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > video.MAX_BYTES:
                    raise HTTPException(413, f"Plik przekracza {video.MAX_BYTES // 1024 // 1024} MB")
                f.write(chunk)
        if size < 1000:
            raise HTTPException(422, "Pusty lub zbyt mały plik wideo")
        async with _video_slots:
            try:
                data = await asyncio.to_thread(video.process_file, path)
                return _video_material(data, url, title, author, platform)
            except Exception as exc:
                raise _video_error(exc)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


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
