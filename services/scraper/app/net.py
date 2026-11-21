"""Bezpieczne pobieranie: walidacja URL, ochrona SSRF, rotacja User-Agent i proxy."""
from __future__ import annotations

import ipaddress
import itertools
import os
import random
import socket
from urllib.parse import urlparse

import httpx

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
]

_PROXIES = [p.strip() for p in os.getenv("SCRAPER_PROXIES", "").split(",") if p.strip()]
_proxy_cycle = itertools.cycle(_PROXIES) if _PROXIES else None
ALLOW_PRIVATE = os.getenv("SCRAPER_ALLOW_PRIVATE", "false").lower() == "true"
MAX_BYTES = 5 * 1024 * 1024


class UnsafeUrl(ValueError):
    pass


def random_ua() -> str:
    return random.choice(USER_AGENTS)


def next_proxy() -> str | None:
    return next(_proxy_cycle) if _proxy_cycle else None


def validate_url(url: str) -> str:
    """Akceptuje tylko http(s) do publicznych adresów IP (blokada SSRF)."""
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise UnsafeUrl("Dozwolone są tylko adresy http(s) z nazwą hosta")
    if parsed.username or parsed.password:
        raise UnsafeUrl("Adres nie może zawierać danych logowania")
    if ALLOW_PRIVATE:
        return parsed.geturl()
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise UnsafeUrl(f"Nie można rozwiązać hosta: {parsed.hostname}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise UnsafeUrl("Adres wskazuje na sieć prywatną/lokalną – zablokowano (SSRF)")
    return parsed.geturl()


async def fetch(url: str) -> httpx.Response:
    """Pobranie z ręczną obsługą przekierowań – każdy skok jest ponownie walidowany."""
    current = validate_url(url)
    proxy = next_proxy()
    async with httpx.AsyncClient(timeout=20, proxy=proxy, follow_redirects=False,
                                 headers={"User-Agent": random_ua(), "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.6"}) as client:
        for _ in range(6):
            resp = await client.get(current)
            if resp.is_redirect and resp.headers.get("location"):
                current = validate_url(str(resp.url.join(resp.headers["location"])))
                continue
            if len(resp.content) > MAX_BYTES:
                raise ValueError("Odpowiedź przekracza limit rozmiaru")
            return resp
    raise ValueError("Zbyt wiele przekierowań")
