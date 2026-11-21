"""Importer list referencyjnych:

1. Lista ostrzeżeń publicznych KNF (zawiadomienia o podejrzeniu przestępstwa) – app/data/knf_warnings.json
2. Tymczasowy rejestr MiCA ESMA: autoryzowani CASP (CASPS.csv) i podmioty niezgodne (NCASP.csv) – app/data/esma_mica.json

Użycie:
    python -m tools.watchlists_import                      # pobranie obu list
    python -m tools.watchlists_import --knf-html plik.html # z zapisanej strony KNF
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import re
from html import unescape
from pathlib import Path

import httpx

DATA = Path(__file__).resolve().parents[1] / "app" / "data"
KNF_URL = "https://www.knf.gov.pl/dla_konsumenta/ostrzezenia_publiczne"
ESMA_BASE = "https://www.esma.europa.eu/sites/default/files/2024-12/"
ESMA_PAGE = "https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica"
UA = {"User-Agent": "InvestWatch-registry-sync/0.1"}

DOMAIN_RX = re.compile(r"\b((?:[a-z0-9-]+\.)+(?:com|pl|net|org|io|eu|co|uk|de|cy|ltd|biz|info|online|pro|app|exchange|trade|finance|capital|global|cc|me|ai|vip|club|top|xyz|world|group|market|markets|money|investments?|fund))\b", re.I)
KRS_RX = re.compile(r"KRS[:\s]*([0-9]{10})", re.I)
NIP_RX = re.compile(r"NIP[:\s]*([0-9]{3}-?[0-9]{3}-?[0-9]{2}-?[0-9]{2}|[0-9]{10})", re.I)
REGON_RX = re.compile(r"REGON[:\s]*([0-9]{9}(?:[0-9]{5})?)", re.I)


def _text(fragment: str) -> str:
    fragment = re.sub(r"<br\s*/?>", "\n", fragment, flags=re.I)
    return re.sub(r"[ \t]+", " ", unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def _decode(raw: bytes) -> str:
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp1250", errors="replace")


def _split_names(cell: str) -> list[str]:
    # „1. Firma A sp. z o.o. 2. Firma B” -> osobne nazwy
    parts = [p.strip(" ;,.") for p in re.split(r"(?:^|\s)\d{1,2}\.\s+", cell) if p.strip(" ;,.")]
    return parts or [cell.strip()]


def parse_knf(html: str) -> list[dict]:
    entries = []
    for m in re.finditer(r"<table.*?</table>", html, re.S):
        before = _text(html[max(0, m.start() - 4000):m.start()])
        titles = re.findall(r"(Zawiadomienia o podejrzeniu popełnienia przestępstwa.*?)(?:\||$)", before)
        section = titles[-1].strip() if titles else None
        for row in re.findall(r"<tr>(.*?)</tr>", m.group(0), re.S):
            cells = [_text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
            if len(cells) < 6:
                continue
            name_cell, ident, prosecutor, judgments, info = cells[1], cells[2], cells[3], cells[4], cells[5]
            entries.append({
                "names": _split_names(name_cell),
                "raw_name": name_cell,
                "krs": KRS_RX.findall(ident),
                "nip": [n.replace("-", "") for n in NIP_RX.findall(ident)],
                "regon": REGON_RX.findall(ident),
                "identifier_note": ident,
                "domains": sorted({d.lower() for d in DOMAIN_RX.findall(name_cell)}),
                "prosecutor": prosecutor,
                "judgments": None if judgments.strip() in ("-", "") else judgments,
                "info": info,
                "section": section,
                "legal_basis": (re.search(r"z (art\. [^(]+?)(?: \(|$)", section or "") or [None, None])[1],
            })
    return entries


def parse_esma(text: str, kind: str) -> list[dict]:
    rows = list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))
    out = []
    for r in rows:
        site = (r.get("ae_website") or "") + " " + (r.get("ae_website_platform") or "")
        out.append({
            "kind": kind,
            "name": (r.get("ae_lei_name") or r.get("ae_commercial_name") or "").strip(),
            "commercial_name": (r.get("ae_commercial_name") or "").strip() or None,
            "lei": (r.get("ae_lei") or "").strip() or None,
            "country": (r.get("ae_homeMemberState") or r.get("ae_lei_cou_code") or "").strip() or None,
            "authority": (r.get("ae_competentAuthority") or "").strip() or None,
            "domains": sorted({d.lower() for d in DOMAIN_RX.findall(site)}),
            "services": [s.strip() for s in (r.get("ac_serviceCode") or "").split("|") if s.strip()],
            "authorised_on": r.get("ac_authorisationNotificationDate") or None,
            "authorisation_end": r.get("ac_authorisationEndDate") or None,
            "passported_to": [c.strip() for c in (r.get("ac_serviceCode_cou") or "").split("|") if c.strip()],
            "reason": r.get("ae_reason") or None,
            "decision_date": r.get("ae_decision_date") or None,
            "comments": r.get("ae_comments") or r.get("ac_comments") or None,
            "last_update": r.get("ac_lastupdate") or r.get("ae_lastupdate") or None,
        })
    return [e for e in out if e["name"]]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--knf-html")
    ap.add_argument("--skip-esma", action="store_true")
    args = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc).isoformat()

    with httpx.Client(timeout=60, follow_redirects=True, headers=UA) as client:
        raw = Path(args.knf_html).read_bytes() if args.knf_html else client.get(KNF_URL).content
        knf = parse_knf(_decode(raw))
        (DATA / "knf_warnings.json").write_text(json.dumps({
            "source": "KNF – lista ostrzeżeń publicznych", "url": KNF_URL, "fetched_at": now,
            "sha256": hashlib.sha256(raw).hexdigest(), "entries": knf,
        }, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"KNF ostrzeżenia: {len(knf)} wpisów")

        if not args.skip_esma:
            lists = {}
            for kind, fname in (("casp", "CASPS.csv"), ("ncasp", "NCASP.csv")):
                body = client.get(ESMA_BASE + fname).content.decode("utf-8-sig", errors="replace")
                lists[kind] = parse_esma(body, kind)
                print(f"ESMA {fname}: {len(lists[kind])} wpisów")
            (DATA / "esma_mica.json").write_text(json.dumps({
                "source": "ESMA – tymczasowy rejestr MiCA (CASP i podmioty niezgodne)", "url": ESMA_PAGE, "fetched_at": now,
                "casp": lists["casp"], "ncasp": lists["ncasp"],
            }, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
