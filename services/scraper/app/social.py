"""Wyszukiwanie publicznych postów i rolek po hashtagu / frazie na TikToku, Instagramie, X i Facebooku.

Strony tagów i wyszukiwarki tych platform wymagają zalogowania, więc kandydatów bierzemy z publicznego
indeksu wyszukiwarki (DuckDuckGo, wersja HTML, region PL) zapytaniem `"#tag" site:platforma`.
Zasady: maks. jedno zapytanie na kilka sekund, bufor wyników, żadnego obchodzenia ograniczeń – przy
odpowiedzi „za dużo zapytań” zwracamy czytelny błąd i próbujemy w kolejnym przebiegu harmonogramu.

Dla znalezionych postów dociągamy zasięg i autora (yt-dlp – tylko metadane; oEmbed dla X/TikToka)
oraz rozpoznajemy język (monitoring nastawiony na treści polskie).
"""
from __future__ import annotations

import concurrent.futures as cf
import os
import re
import threading
import time
from html import unescape
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from .net import random_ua

SEARCH_URL = "https://html.duckduckgo.com/html/"
MIN_INTERVAL = float(os.getenv("SOCIAL_SEARCH_INTERVAL", "6"))  # s między zapytaniami do wyszukiwarki
CACHE_TTL = 1800
SITES = {"tiktok": "tiktok.com", "instagram": "instagram.com", "x": "x.com", "facebook": "facebook.com"}
POST_RE = {
    "tiktok": re.compile(r"https?://(?:www\.|m\.)?tiktok\.com/@[\w.\-]+/(?:video|photo)/\d+"),
    "instagram": re.compile(r"https?://(?:www\.)?instagram\.com/(?:[\w.]+/)?(?:reel|reels|p|tv)/[\w\-]+"),
    "x": re.compile(r"https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/\w{1,15}/status/\d+"),
    "facebook": re.compile(r"https?://(?:www\.|m\.)?facebook\.com/(?:reel/\d+|watch/?\?v=\d+|[\w.\-]+/(?:videos|posts)/[\w.\-]+)"),
}
PL_CHARS = re.compile(r"[ąćęłńóśźż]", re.I)
PL_WORDS = re.compile(r"\b(?:się|jest|nie|jak|dla|że|czy|już|tylko|zarob\w*|pieniądz\w*|złot\w*|zł|kasa|kasy|dzień|dziennie|"
                      r"miesięcznie|inwest\w*|giełd\w*|konto|link|darmow\w*|polsk\w*|teraz|można|tak|ale|mój|moj\w*)\b", re.I)

_lock = threading.Lock()
_last = 0.0
_cache: dict[str, tuple[float, list[dict]]] = {}


class SearchThrottled(RuntimeError):
    """Wyszukiwarka ograniczyła liczbę zapytań – spróbować w następnym przebiegu."""


def is_polish(text: str | None) -> bool:
    t = text or ""
    return len(PL_CHARS.findall(t)) >= 2 or len(PL_WORDS.findall(t)) >= 2


def _clean(url: str) -> str:
    u = unquote(unescape(url)).split("#")[0]
    u = re.sub(r"[?&](?:utm_\w+|igsh|is_from_webapp|sender_device|lang|s|t)=[^&]*", "", u)
    return u.replace("twitter.com/", "x.com/").replace("mobile.x.com", "x.com").replace("m.facebook", "www.facebook").rstrip("/?&")


def web_search(query: str, polish: bool = True) -> list[dict]:
    """Wyniki wyszukiwarki: [{url, title, snippet}] (z buforem i odstępem między zapytaniami)."""
    key = f"{polish}|{query}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    global _last
    with _lock:
        wait = MIN_INTERVAL - (time.monotonic() - _last)
        if wait > 0:
            time.sleep(wait)
        _last = time.monotonic()
        r = httpx.get(SEARCH_URL, params={"q": query, "kl": "pl-pl" if polish else "wt-wt"},
                      headers={"User-Agent": random_ua(), "Accept-Language": "pl-PL,pl;q=0.9" if polish else "en"},
                      timeout=25, follow_redirects=True)
    if r.status_code in (202, 403, 429) or re.search(r"anomaly|unusual traffic|captcha", r.text[:20000], re.I):
        raise SearchThrottled("Wyszukiwarka tymczasowo ograniczyła zapytania – wyniki pojawią się w kolejnym przebiegu monitoringu")
    if r.status_code >= 400:
        raise RuntimeError(f"Wyszukiwarka zwróciła HTTP {r.status_code}")
    out = []
    for block in re.findall(r'<div class="result[^"]*results_links.*?</div>\s*</div>', r.text, re.S) or [r.text]:
        href = re.search(r'class="result__a"[^>]*href="([^"]+)"', block)
        title = re.search(r'class="result__a"[^>]*>(.*?)</a>', block, re.S)
        snip = re.search(r'class="result__snippet"[^>]*>(.*?)</a>', block, re.S)
        if href:
            raw = href.group(1)
            if "uddg=" in raw:
                raw = parse_qs(urlparse(raw).query).get("uddg", [raw])[0]
            strip = lambda s: unescape(re.sub(r"<[^>]+>", "", s or "")).strip()  # noqa: E731
            out.append({"url": unquote(raw), "title": strip(title.group(1) if title else ""), "snippet": strip(snip.group(1) if snip else "")})
    _cache[key] = (time.time(), out)
    return out


def _search_query(platform: str, kind: str, query: str) -> str:
    q = query.strip().lstrip("#")
    term = f'"#{q}"' if kind == "hashtag" else f'"{q}"'
    return f"{term} site:{SITES[platform]}"


def _meta(url: str, platform: str) -> dict:
    """Zasięg i autor posta: yt-dlp (tylko metadane), dla X/TikToka zapasowo oEmbed."""
    info: dict = {}
    try:
        import yt_dlp
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True, "socket_timeout": 15,
                               "js_runtimes": {"deno": {}, "node": {}}, "http_headers": {"User-Agent": random_ua()}}) as ydl:
            i = ydl.extract_info(url, download=False) or {}
        info = {"views": i.get("view_count"), "likes": i.get("like_count"), "followers": i.get("channel_follower_count"),
                "author": i.get("uploader") or i.get("channel") or i.get("creator"), "duration": i.get("duration"),
                "text": (i.get("description") or i.get("title") or "")[:1000], "published": i.get("timestamp") or i.get("upload_date"),
                "has_video": bool(i.get("duration") or i.get("formats"))}
    except Exception:
        pass
    if not info.get("text") or not info.get("author"):
        o = oembed(url, platform)
        if o:
            info = {**o, **{k: v for k, v in info.items() if v}}
    return info


def oembed(url: str, platform: str) -> dict | None:
    """Publiczny oEmbed (bez logowania): autor i tekst posta X / podpis TikToka."""
    endpoint = {"x": "https://publish.twitter.com/oembed", "tiktok": "https://www.tiktok.com/oembed"}.get(platform)
    if not endpoint:
        return None
    try:
        r = httpx.get(endpoint, params={"url": url, "omit_script": "1", "lang": "pl"}, headers={"User-Agent": random_ua()},
                      timeout=15, follow_redirects=True)
        if r.status_code != 200:
            return None
        d = r.json()
        html = d.get("html") or ""
        text = unescape(re.sub(r"<[^>]+>", " ", html)) if platform == "x" else (d.get("title") or "")
        text = re.sub(r"\s+", " ", text).strip()
        return {"author": d.get("author_name"), "author_url": d.get("author_url"), "text": text[:2000]} if (text or d.get("author_name")) else None
    except Exception:
        return None


def discover(platform: str, kind: str, query: str, limit: int = 20, polish: bool = True) -> dict:
    if platform not in SITES or kind not in ("hashtag", "search"):
        raise ValueError(f"Nieobsługiwane: {platform}/{kind}")
    q = _search_query(platform, kind, query)
    results = web_search(q, polish)
    seen, items = set(), []
    for res in results:
        m = POST_RE[platform].search(res["url"])
        if not m:
            continue
        url = _clean(m.group(0))
        if url in seen:
            continue
        seen.add(url)
        items.append({"url": url, "platform": platform, "title": res["title"] or None, "snippet": res["snippet"]})
        if len(items) >= limit:
            break
    # metadane równolegle (ograniczona pula – uprzejmie wobec platform)
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        metas = list(pool.map(lambda it: _meta(it["url"], platform), items))
    out = []
    for it, meta in zip(items, metas):
        text = " ".join(x for x in [it.get("title"), it.get("snippet"), meta.get("text")] if x)
        out.append({
            "url": it["url"], "id": it["url"].rstrip("/").split("/")[-1], "title": (meta.get("text") or it.get("title") or "")[:200] or None,
            "platform": platform, "author": meta.get("author"), "author_url": meta.get("author_url"),
            "views": meta.get("views"), "likes": meta.get("likes"), "followers": meta.get("followers"),
            "duration": meta.get("duration"), "published": meta.get("published"), "live": False,
            "lang": "pl" if is_polish(text) else None, "snippet": it.get("snippet"),
        })
    return {"platform": platform, "kind": kind, "query": query, "source": f"wyszukiwarka: {q}", "count": len(out), "items": out}
