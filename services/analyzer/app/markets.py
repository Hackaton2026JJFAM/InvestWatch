"""Zachowanie spółki giełdowej w kryzysie – dane dzienne z archiwum notowań GPW.

Źródło: https://www.gpw.pl/archiwum-notowan (tabela dzienna wszystkich akcji – type=10 – i indeksów – type=1).
Jedno żądanie na dzień i typ, z buforem na dysku (dane historyczne się nie zmieniają) i odstępem
między żądaniami. Kursy nie są korygowane o dywidendy i splity – wynik to przybliżenie.

Metryki dla okresu kryzysu (np. krach COVID-19):
  maksymalne obsunięcie (max drawdown) od szczytu w okresie, dzień dna, dni do odrobienia strat,
  zmienność roczna, beta i obsunięcie względem WIG, najgorsze sesje.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os
import re
import tempfile
import threading
import time
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

URL = "https://www.gpw.pl/archiwum-notowan"
SOURCE_PAGE = "https://www.gpw.pl/archiwum-notowan"
UA = {"User-Agent": "Mozilla/5.0 (compatible; InvestWatch-markets/0.1)", "Accept-Language": "pl"}
CACHE = Path(os.getenv("GPW_CACHE") or Path(tempfile.gettempdir()) / "investwatch-gpw")
DELAY = float(os.getenv("GPW_DELAY", "0.25"))
BENCHMARK = "WIG"

# okresy kryzysów: od ostatnich tygodni przed spadkami do odbicia rynku
CRISES = {
    "covid2020": {"name": "Krach COVID-19", "start": "2020-02-17", "end": "2020-07-31"},
    "ukraina2022": {"name": "Inwazja Rosji na Ukrainę", "start": "2022-02-01", "end": "2022-06-30"},
}

_lock = threading.Lock()
_last_request = 0.0


class MarketDataUnavailable(Exception):
    pass


def _num(s: str) -> float | None:
    s = s.replace("\xa0", "").replace(" ", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def parse_day(html: str) -> dict[str, dict]:
    """Tabela archiwum -> {nazwa: {open, high, low, close, change_pct, turnover_k}}."""
    soup = BeautifulSoup(html, "html.parser")
    table = next((t for t in soup.find_all("table") if any("Nazwa" in th.get_text() for th in t.find_all("th"))), None)
    out: dict[str, dict] = {}
    if table is None:
        return out
    for tr in table.find_all("tr"):
        c = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        if len(c) < 8 or not c[0]:
            continue
        close = _num(c[5])
        if close is None:
            continue
        out[c[0].upper()] = {"open": _num(c[2]), "high": _num(c[3]), "low": _num(c[4]), "close": close,
                             "change_pct": _num(c[6]), "turnover_k": _num(c[7])}
    return out


def _fetch(day: dt.date, kind: int) -> dict[str, dict]:
    """Dzień z archiwum (z buforem). kind: 10 = akcje, 1 = indeksy. Pusty słownik = brak sesji."""
    path = CACHE / f"{kind}-{day.isoformat()}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    global _last_request
    with _lock:
        wait = DELAY - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
    params = {"fetch": "0", "type": str(kind), "instrument": "", "date": day.strftime("%d-%m-%Y")}
    with httpx.Client(timeout=30, headers=UA, follow_redirects=True) as c:
        r = c.get(URL, params=params)
    if r.status_code >= 400:
        raise MarketDataUnavailable(f"Archiwum GPW zwróciło HTTP {r.status_code}")
    data = parse_day(r.text)
    if day < dt.date.today():  # przeszłe dni się nie zmieniają – można buforować także brak sesji
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def _weekdays(start: dt.date, end: dt.date):
    d = start
    while d <= end:
        if d.weekday() < 5:
            yield d
        d += dt.timedelta(days=1)


def instruments(day: str | None = None) -> list[str]:
    """Nazwy akcji notowanych w danym dniu (domyślnie: pierwszy dzień okresu COVID)."""
    d = dt.date.fromisoformat(day or CRISES["covid2020"]["start"])
    for _ in range(7):
        data = _fetch(d, 10)
        if data:
            return sorted(data)
        d += dt.timedelta(days=1)
    return []


def series(ticker: str, start: dt.date, end: dt.date) -> tuple[list[dict], list[dict]]:
    ticker = ticker.upper().strip()
    own, bench = [], []
    for d in _weekdays(start, end):
        stocks = _fetch(d, 10)
        if not stocks:
            continue  # dzień bez sesji
        idx = _fetch(d, 1)
        if ticker in stocks and stocks[ticker]["close"]:
            own.append({"date": d.isoformat(), **stocks[ticker]})
        if BENCHMARK in idx:
            bench.append({"date": d.isoformat(), "close": idx[BENCHMARK]["close"]})
    return own, bench


def _drawdown(closes: list[float]) -> tuple[float, int, int]:
    """(max obsunięcie <= 0, indeks szczytu, indeks dna)."""
    peak_i, best = 0, (0.0, 0, 0)
    for i, c in enumerate(closes):
        if c > closes[peak_i]:
            peak_i = i
        dd = c / closes[peak_i] - 1
        if dd < best[0]:
            best = (dd, peak_i, i)
    return best


def _returns(closes: list[float]) -> list[float]:
    return [math.log(b / a) for a, b in zip(closes, closes[1:]) if a > 0 and b > 0]


def metrics(own: list[dict], bench: list[dict]) -> dict:
    """Faza kryzysu = od początku okresu do 10 sesji po dnie WIG. Obsunięcie spółki liczone od jej
    szczytu przed dnem rynku; odrobienie strat = pierwszy dzień z kursem >= tego szczytu."""
    closes = [p["close"] for p in own]
    dates = [p["date"] for p in own]
    bmap = {b["date"]: b["close"] for b in bench}
    if len(bench) > 1:
        b_dd, _, b_ti = _drawdown([b["close"] for b in bench])
        market_trough = bench[b_ti]["date"]
    else:
        b_dd, market_trough = None, dates[len(dates) // 2]
    t_idx = next((i for i, d in enumerate(dates) if d >= market_trough), len(dates) - 1)
    phase_end = min(len(closes), t_idx + 11)
    dd, pi, ti = _drawdown(closes[:phase_end])
    peak, trough = own[pi], own[ti]
    rec = next((own[j] for j in range(ti + 1, len(own)) if closes[j] >= closes[pi]), None)
    window_dd = _drawdown(closes)[0]
    rets = _returns(closes)
    vol = (sum((r - sum(rets) / len(rets)) ** 2 for r in rets) / (len(rets) - 1)) ** 0.5 * math.sqrt(252) if len(rets) > 2 else None

    common = [(p["close"], bmap[p["date"]]) for p in own if p["date"] in bmap]
    beta = None
    if len(common) > 10:
        ra = _returns([a for a, _ in common])
        rb = _returns([b for _, b in common])
        mb = sum(rb) / len(rb)
        ma = sum(ra) / len(ra)
        var_b = sum((x - mb) ** 2 for x in rb)
        beta = round(sum((x - ma) * (y - mb) for x, y in zip(ra, rb)) / var_b, 2) if var_b else None

    worst = sorted(({"date": own[i + 1]["date"], "change_pct": round((closes[i + 1] / closes[i] - 1) * 100, 2)}
                    for i in range(len(closes) - 1)), key=lambda e: e["change_pct"])[:3]
    base_own, base_b = closes[0], (bench[0]["close"] if bench else None)
    chart = [{"date": p["date"], "stock": round(p["close"] / base_own * 100, 2),
              "wig": round(bmap[p["date"]] / base_b * 100, 2) if base_b and p["date"] in bmap else None} for p in own]
    return {
        "max_drawdown": round(dd, 4),
        "market_trough": market_trough,
        "peak": {"date": peak["date"], "close": peak["close"]},
        "trough": {"date": trough["date"], "close": trough["close"]},
        "recovered": rec is not None,
        "recovery_date": rec["date"] if rec else None,
        "recovery_days": (dt.date.fromisoformat(rec["date"]) - dt.date.fromisoformat(trough["date"])).days if rec else None,
        "recovery_pct_at_end": round(closes[-1] / closes[pi] - 1, 4),
        "period_return": round(closes[-1] / closes[0] - 1, 4),
        "window_max_drawdown": round(window_dd, 4),
        "volatility": round(vol, 4) if vol is not None else None,
        "beta_wig": beta,
        "benchmark_drawdown": round(b_dd, 4) if b_dd is not None else None,
        "relative_drawdown": round(dd - b_dd, 4) if b_dd is not None else None,
        "worst_sessions": worst,
        "sessions": len(own),
        "chart": chart,
    }


def crisis_report(ticker: str, crisis: str = "covid2020", start: str | None = None, end: str | None = None) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9.\-]{2,20}", ticker or ""):
        raise ValueError("Nazwa skrócona spółki na GPW: 2–20 znaków (np. PKOBP, CDPROJEKT, XTB)")
    period = dict(CRISES.get(crisis) or {})
    if start and end:
        period = {"name": period.get("name") or "Okres użytkownika", "start": start, "end": end}
    if not period:
        raise ValueError(f"Nieznany okres kryzysu: {crisis}")
    s, e = dt.date.fromisoformat(period["start"]), dt.date.fromisoformat(period["end"])
    if e <= s or (e - s).days > 400:
        raise ValueError("Okres musi trwać od 1 dnia do ~13 miesięcy")
    try:
        own, bench = series(ticker, s, e)
    except httpx.HTTPError as exc:
        raise MarketDataUnavailable(f"Archiwum GPW niedostępne: {type(exc).__name__}") from exc
    if len(own) < 5:
        raise LookupError(f"Brak notowań „{ticker.upper()}” na GPW w okresie {period['start']} – {period['end']} "
                          "(sprawdź nazwę skróconą z tabeli notowań)")
    return {
        "ticker": ticker.upper(), "crisis": crisis, "period": period, "benchmark": BENCHMARK,
        **metrics(own, bench),
        "source_url": SOURCE_PAGE,
        "note": "Kursy zamknięcia z archiwum GPW, bez korekty o dywidendy i splity – przybliżenie zachowania w kryzysie.",
        "computed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
