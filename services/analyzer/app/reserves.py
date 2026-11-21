"""Proof of Reserves – raport publikowany przez giełdę (OKX).

Źródło: publiczna strona https://www.okx.com/en-eu/proof-of-reserves – raport jest osadzony w HTML
(`<script id="appState">`, obiekt auditRootInfo): zobowiązania wobec klientów (liabilityBalances),
rezerwy (reserveBalances), wskaźnik deklarowany przez giełdę (capitalRatio), data i hash drzewa Merkle.

Pokrycie liczymy sami: rezerwy / zobowiązania, dla każdego aktywa objętego raportem.
To DEKLARACJA podmiotu, a nie audyt – tak też jest prezentowana.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import time

import httpx

OKX_URL = "https://www.okx.com/en-eu/proof-of-reserves"
UA = {"User-Agent": "Mozilla/5.0 (compatible; InvestWatch-reserves/0.1)", "Accept-Language": "en"}
APPSTATE = re.compile(r'<script[^>]*id="appState"[^>]*>(.*?)</script>', re.S)
_cache: dict[str, tuple[float, dict]] = {}
TTL = 3600


class ReportUnavailable(Exception):
    pass


def _num(v) -> float | None:
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def parse_okx(html: str) -> dict:
    m = APPSTATE.search(html)
    if not m:
        raise ReportUnavailable("Strona nie zawiera danych raportu (zmiana formatu?)")
    try:
        info = json.loads(m.group(1))["appContext"]["initialProps"]["App"]["auditRootInfo"]
    except (KeyError, json.JSONDecodeError) as exc:
        raise ReportUnavailable(f"Nieoczekiwana struktura raportu: {type(exc).__name__}") from exc
    liab, resv, declared = info.get("liabilityBalances") or {}, info.get("reserveBalances") or {}, info.get("capitalRatio") or {}
    assets = []
    for coin in info.get("reserveCurrencies") or []:
        if not coin:
            continue
        l, r = _num(liab.get(coin)), _num(resv.get(coin))
        coverage = round(r / l, 4) if l and r is not None and l > 0 else None
        assets.append({"coin": coin, "liabilities": l, "reserves": r, "coverage": coverage,
                       "declared_ratio": declared.get(coin), "name": (info.get("fullNames") or {}).get(coin)})
    covered = [a for a in assets if a["coverage"] is not None]
    created = info.get("createTime")
    report_date = dt.datetime.fromtimestamp(created / 1000, dt.timezone.utc).date().isoformat() if created else None
    return {
        "exchange": "OKX",
        "audit_id": str(info.get("auditId") or ""),
        "report_date": report_date,
        "merkle_root": info.get("merkleHash"),
        "assets": assets,
        "min_coverage": min((a["coverage"] for a in covered), default=None),
        "below_one": [a["coin"] for a in covered if a["coverage"] < 1.0],
        "source_url": OKX_URL,
        "note": "Dane to deklaracja giełdy (Proof of Reserves), nie audyt finansowy.",
    }


def okx_report(force: bool = False) -> dict:
    hit = _cache.get("okx")
    if hit and not force and time.time() - hit[0] < TTL:
        return hit[1]
    with httpx.Client(timeout=30, headers=UA, follow_redirects=True) as c:
        r = c.get(OKX_URL)
        if r.status_code >= 400:
            raise ReportUnavailable(f"Strona raportu zwróciła HTTP {r.status_code}")
        report = parse_okx(r.text)
    report["fetched_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    _cache["okx"] = (time.time(), report)
    return report
