"""Ekstrakcja treści i metadanych z HTML (bez menu, stopki i elementów zbędnych)."""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

NOISE_TAGS = ["script", "style", "noscript", "svg", "iframe", "form", "nav", "header", "aside", "template"]
NOISE_HINTS = re.compile(r"(cookie|consent|newsletter|breadcrumb|menu|navbar|sidebar|share|social|related|comments?)", re.I)

SOCIAL_HOSTS = {
    "facebook.com": "facebook", "fb.com": "facebook", "instagram.com": "instagram",
    "tiktok.com": "tiktok", "youtube.com": "youtube", "youtu.be": "youtube",
    "x.com": "x", "twitter.com": "x", "linkedin.com": "linkedin", "t.me": "telegram",
}

DISCOVERY_KEYWORDS = re.compile(
    r"(inwest|invest|oferta|offer|promo|kampan|forex|cfd|krypto|crypto|zysk|profit|fundusz|fund|"
    r"akcj|obligac|etf|portfel|portfolio|doradztw|advisory|wealth|family-office|trading|handel|rachunek|konto)",
    re.I,
)


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = text.replace(" ", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()


def content_hash(text: str) -> str:
    canon = re.sub(r"\W+", " ", text.lower()).strip()
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def platform_for(url: str) -> str:
    host = (urlparse(url).hostname or "").lower().removeprefix("www.").removeprefix("m.")
    for h, name in SOCIAL_HOSTS.items():
        if host == h or host.endswith("." + h):
            return name
    return "web"


def social_handle(url: str, platform: str) -> str | None:
    path = [p for p in urlparse(url).path.split("/") if p]
    if not path:
        return None
    if platform == "tiktok":
        return next((p for p in path if p.startswith("@")), None)
    if platform in ("instagram", "x", "facebook", "telegram") and path[0] not in ("p", "reel", "watch", "share", "status"):
        return "@" + path[0].lstrip("@")
    if platform == "youtube":
        return next((p for p in path if p.startswith("@")), None)
    return None


def _meta(soup: BeautifulSoup, *names: str) -> str | None:
    for n in names:
        tag = soup.find("meta", attrs={"property": n}) or soup.find("meta", attrs={"name": n})
        if tag and tag.get("content"):
            return tag["content"].strip()
    return None


def _jsonld(soup: BeautifulSoup) -> list[dict]:
    out = []
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        items = data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []
        out.extend(i for i in items if isinstance(i, dict))
    return out


def extract(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, "lxml")
    lang = (soup.html.get("lang") if soup.html else None) or _meta(soup, "og:locale")
    title = _meta(soup, "og:title") or (soup.title.string.strip() if soup.title and soup.title.string else None)
    ld = _jsonld(soup)

    author = _meta(soup, "author", "article:author", "twitter:creator")
    published = _meta(soup, "article:published_time", "datePublished", "pubdate", "date")
    publisher = _meta(soup, "og:site_name")
    for item in ld:
        a = item.get("author")
        if not author and a:
            author = a.get("name") if isinstance(a, dict) else a[0].get("name") if isinstance(a, list) and a and isinstance(a[0], dict) else str(a)
        published = published or item.get("datePublished")
        p = item.get("publisher")
        if not publisher and isinstance(p, dict):
            publisher = p.get("name")

    platform = platform_for(url)
    handle = social_handle(url, platform)

    links = []
    for a in soup.find_all("a", href=True):
        links.append({"text": normalize_text(a.get_text(" "))[:200], "href": urljoin(url, a["href"])})

    full_text = normalize_text(soup.get_text("\n"))

    body = soup.body or soup
    for t in body.find_all(NOISE_TAGS):
        t.decompose()
    for t in body.find_all(True):
        if t.attrs is None:
            continue
        hint = " ".join(t.get("class", []) or []) + " " + (t.get("id") or "")
        if NOISE_HINTS.search(hint) and len(t.get_text(strip=True)) < 2000:
            t.decompose()
    main = body.find("article") or body.find("main") or body
    blocks = []
    for el in main.find_all(["h1", "h2", "h3", "h4", "p", "li", "td", "blockquote", "small", "div", "span", "footer"]):
        if el.find(["p", "div", "li", "h1", "h2", "h3", "table"]):
            continue
        txt = normalize_text(el.get_text(" "))
        if txt:
            blocks.append(txt)
    seen, content = set(), []
    for b in blocks:
        if b not in seen:
            seen.add(b)
            content.append(b)
    content_text = "\n".join(content) or full_text
    if platform != "web":
        desc = _meta(soup, "og:description", "description")
        if desc and desc not in content_text:
            content_text = desc + "\n" + content_text

    return {
        "title": title,
        "author": author or handle,
        "publisher": publisher,
        "published_at": published,
        "lang": (lang or "").split("-")[0].split("_")[0].lower() or None,
        "description": _meta(soup, "og:description", "description"),
        "platform": platform,
        "social_handle": handle,
        "content_text": content_text,
        "full_text": full_text,
        "content_hash": content_hash(content_text),
        "links": links[:400],
    }


def discover_links(links: list[dict], base_url: str, limit: int) -> list[str]:
    host = urlparse(base_url).hostname
    scored: dict[str, int] = {}
    for link in links:
        href = link["href"].split("#")[0]
        p = urlparse(href)
        if p.scheme not in ("http", "https") or p.hostname != host or href == base_url:
            continue
        score = len(DISCOVERY_KEYWORDS.findall(href)) * 2 + len(DISCOVERY_KEYWORDS.findall(link["text"]))
        if score:
            scored[href] = max(score, scored.get(href, 0))
    return [u for u, _ in sorted(scored.items(), key=lambda kv: -kv[1])[:limit]]
