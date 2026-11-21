"""Adapter rejestru firm inwestycyjnych KNF.

Pobiera (lub czyta z plików) publiczne listy KNF i zapisuje snapshot JSON
używany przez analizator jako lokalna baza referencyjna.

Użycie:
    python -m tools.knf_import --out app/data/knf_registry.json            # pobranie z knf.gov.pl
    python -m tools.knf_import --from-dir ./knf_html --out app/data/knf_registry.json
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import time
from html import unescape
from pathlib import Path

import httpx

BASE = "https://www.knf.gov.pl/podmioty/Podmioty_rynku_kapitalowego/Firmy_inwestycyjne_i_Agenci_firm_inwestycyjnych/"
LISTS = {
    "domy_maklerskie": "dom_maklerski",
    "Banki_prowadzace_dzialalnosc_maklerska": "bank_maklerski",
    "notyfikowane_firmy_inwestycyjne_oddzialy": "oddzial_zagranicznej_firmy",
    "notyfikowane_zagraniczne_firmy_inwestycyjne": "zagraniczna_firma_bez_oddzialu",
}

TABLE_RE = re.compile(r"<table[^>]*>(.*?)</table>", re.S | re.I)
ROW_RE = re.compile(r"<tr[^>]*>\s*<th[^>]*>(.*?)</th>\s*<td[^>]*>(.*?)</td>\s*</tr>", re.S | re.I)
STRIKE_RE = re.compile(r"<strike>(.*?)</strike>", re.S | re.I)


def _text(fragment: str) -> str:
    fragment = re.sub(r"<br\s*/?>|</li>", "\n", fragment, flags=re.I)
    return unescape(re.sub(r"<[^>]+>", "", fragment)).strip()


def decode(raw: bytes) -> str:
    for enc in ("utf-8", "cp1250", "iso-8859-2"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_page(html: str, category: str) -> list[dict]:
    firms = []
    for table in TABLE_RE.findall(html):
        fields: dict[str, str] = {}
        former: list[str] = []
        for th, td in ROW_RE.findall(table):
            key = _text(th).lower()
            if key.startswith("nazwa"):
                former = [_text(s) for s in STRIKE_RE.findall(td)]
                td = STRIKE_RE.sub("", td)
            fields[key] = _text(td)
        def pick(*prefixes: str) -> str | None:
            for k, v in fields.items():
                if any(k.startswith(p) for p in prefixes):
                    return v
            return None

        name = (pick("nazwa") or "").split("\n")[0].strip()
        if not name:
            continue
        address = [l.strip() for l in (pick("dane teleadresowe", "adres") or "").split("\n") if l.strip()]
        country = pick("państwo", "kraj")
        firms.append(
            {
                "name": name,
                "former_names": former,
                "category": category,
                "address": address,
                "country": country or ("PL" if category in ("dom_maklerski", "bank_maklerski") else None),
                "supervisor": pick("organ nadzoru"),
                "license_date": (pick("data zezwolenia", "data wpisu", "data wpływu") or "").split("\n")[0] or None,
                "scope": pick("zakres", "usługi inwestycyjne", "a - usługi"),
                "raw": fields,
            }
        )
    return firms


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--from-dir", help="katalog z zapisanymi stronami <nazwa_listy>.html")
    ap.add_argument("--max-pages", type=int, default=80)
    ap.add_argument("--delay", type=float, default=0.7)
    args = ap.parse_args()

    firms: list[dict] = []
    sources = []
    for slug, category in LISTS.items():
        digest = hashlib.sha256()
        parsed: list[dict] = []
        if args.from_dir:
            raw = (Path(args.from_dir) / f"{slug}.html").read_bytes()
            digest.update(raw)
            parsed = parse_page(decode(raw), category)
        else:
            seen: set[str] = set()
            with httpx.Client(timeout=30, follow_redirects=True,
                              headers={"User-Agent": "InvestWatch-registry-sync/0.1"}) as client:
                for page in range(1, args.max_pages + 1):
                    raw = client.get(BASE + slug, params={"page": page} if page > 1 else None).content
                    batch = [f for f in parse_page(decode(raw), category) if f["name"] not in seen]
                    if not batch:
                        break
                    digest.update(raw)
                    seen.update(f["name"] for f in batch)
                    parsed.extend(batch)
                    time.sleep(args.delay)  # nie obciążamy serwera KNF
        sources.append({"list": slug, "url": BASE + slug, "count": len(parsed), "sha256": digest.hexdigest()})
        print(f"{slug}: {len(parsed)}")
        firms.extend(parsed)

    out = {
        "source": "KNF – Rejestr firm inwestycyjnych (publiczne listy)",
        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "lists": sources,
        "firms": firms,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"zapisano {len(firms)} podmiotów -> {args.out}")


if __name__ == "__main__":
    main()
