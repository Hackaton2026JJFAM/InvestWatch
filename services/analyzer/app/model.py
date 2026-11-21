"""Wspólne struktury: dokument do analizy i przesłanka (finding)."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

from .text import Sentence, detect_lang, normalize, split_sentences

PASS, FAIL, WARN, NA, NOT_CHECKED = "pass", "fail", "warn", "na", "not_checked"


@dataclass
class Finding:
    module: str
    rule_id: str
    title: str
    status: str
    severity: int = 0              # waga 0-100 używana w scoringu, gdy status = fail (warn = połowa)
    legal_basis: str | None = None
    explanation: str = ""
    evidence: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Doc:
    url: str
    title: str | None
    text: str                      # cała widoczna treść (z ostrzeżeniami ze stopki)
    content_text: str              # treść główna
    sentences: list[Sentence]
    lang: str | None
    platform: str
    author: str | None
    publisher: str | None
    domain: str | None
    links: list[dict]
    layout: dict
    meta: dict

    @property
    def has_layout(self) -> bool:
        return self.layout.get("engine") == "playwright" and bool(self.layout.get("viewports"))

    def blocks(self, viewport: str = "desktop") -> list[dict]:
        return (self.layout.get("viewports", {}).get(viewport) or {}).get("blocks", [])

    @classmethod
    def from_material(cls, m: dict) -> "Doc":
        from urllib.parse import urlparse

        full = normalize(m.get("full_text") or "")
        content = normalize(m.get("content_text") or "")
        text = full if len(full) >= len(content) else content
        title = m.get("title")
        if title and title not in text[:500]:
            text = f"{title}\n{text}"
        url = m.get("final_url") or m.get("url") or ""
        host = (urlparse(url).hostname or "").removeprefix("www.") or None
        return cls(
            url=url, title=title, text=text, content_text=content or text, sentences=split_sentences(text),
            lang=(m.get("lang") or detect_lang(content or text)), platform=m.get("platform") or "web",
            author=m.get("author"), publisher=m.get("publisher"), domain=host, links=m.get("links") or [],
            layout=m.get("layout") or {"engine": "none"}, meta={k: m.get(k) for k in ("social_handle", "published_at", "description")},
        )


def ev(text: str, where: str = "tekst", **extra) -> dict:
    return {"text": text[:400], "where": where, **extra}
