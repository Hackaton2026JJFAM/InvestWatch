"""Ewaluacja potoku scraper -> analyzer na oznaczonych próbkach (data/samples/labels.json).

Użycie: python -m tools.evaluate --samples ../../data/samples [--threshold 60] [--verbose]
Wymaga działających serwisów: scraper (8001) i analyzer (8002).
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

import httpx


def main() -> None:
    # UTF-8 niezależnie od strony kodowej konsoli (Windows cp1250 nie zna np. „≥”)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", required=True)
    ap.add_argument("--scraper", default="http://localhost:8001")
    ap.add_argument("--analyzer", default="http://localhost:8002")
    ap.add_argument("--threshold", type=float, default=60)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    root = Path(args.samples)
    labels = json.loads((root / "labels.json").read_text(encoding="utf-8"))
    rows = []
    with httpx.Client(timeout=120) as c:
        for name, meta in labels.items():
            if name.startswith("_"):
                continue
            if name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                # grafika reklamy – OCR w scraperze; bez Tesseracta (np. lokalnie na Windows) próbka jest pomijana
                b64 = base64.b64encode((root / name).read_bytes()).decode()
                r = c.post(f"{args.scraper}/scrape/image", json={"image": b64, "url": meta.get("url", f"upload://{name}")})
                if r.status_code == 501:
                    print(f"POMINIĘTO {name}: {r.json().get('detail')}")
                    continue
                res = c.post(f"{args.analyzer}/analyze", json=r.json()).json()
                rows.append((name, meta["ground_truth"], res))
                continue
            if name.lower().endswith((".mp4", ".webm", ".mov")):
                # wideo – Whisper + OCR klatek w scraperze (plik w treści żądania)
                r = c.post(f"{args.scraper}/scrape/video/file", params={"url": meta.get("url", f"upload://{name}"), "platform": meta.get("platform")},
                           content=(root / name).read_bytes(), headers={"content-type": "video/mp4"}, timeout=900)
                if r.status_code == 501:
                    print(f"POMINIĘTO {name}: {r.json().get('detail')}")
                    continue
                res = c.post(f"{args.analyzer}/analyze", json=r.json()).json()
                rows.append((name, meta["ground_truth"], res))
                continue
            raw = (root / name).read_text(encoding="utf-8")
            if name.endswith(".json"):
                d = json.loads(raw)
                mat = c.post(f"{args.scraper}/scrape/text", json={k: d.get(k) for k in ("text", "url", "title", "author", "platform")}).json()
            else:
                mat = c.post(f"{args.scraper}/scrape/html", json={"html": raw, "url": meta.get("url", f"https://sample.example/{name}")}).json()
            res = c.post(f"{args.analyzer}/analyze", json=mat).json()
            rows.append((name, meta["ground_truth"], res))

    tp = fp = fn = tn = 0
    for name, gt, res in rows:
        pred = res["score"] >= args.threshold
        tp += gt and pred
        fp += (not gt) and pred
        fn += gt and not pred
        tn += (not gt) and not pred
        mark = "OK " if gt == pred else ("FP " if pred else "FN ")
        fails = [f"{f['rule_id']}" + ("!" if f["status"] == "fail" else "?") for f in res["findings"] if f["status"] in ("fail", "warn")]
        print(f"{mark} {res['score']:5.1f} {json.dumps(res['module_scores'])} {name}  [{' '.join(fails)}]")
        if args.verbose:
            for f in res["findings"]:
                if f["status"] in ("fail", "warn"):
                    print(f"      {f['rule_id']:>4} {f['status']:4} {f['explanation'][:150]}")
    prec = tp / (tp + fp) if tp + fp else 0
    rec = tp / (tp + fn) if tp + fn else 0
    print(f"\nprog={args.threshold}  TP={tp} FP={fp} FN={fn} TN={tn}  precision={prec:.2f} recall={rec:.2f}")


if __name__ == "__main__":
    main()
