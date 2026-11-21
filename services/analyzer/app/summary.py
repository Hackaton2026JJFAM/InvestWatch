"""Podsumowanie AI: lokalny LLM (Ollama) na ustrukturyzowanych przesłankach, fallback = szablon.

Zasady: każde zdanie odwołuje się do rule_id; brak wniosków prawnych („sygnał do weryfikacji”).
"""
from __future__ import annotations

import json
import logging
import os
import re

import httpx

log = logging.getLogger("analyzer.summary")
OLLAMA_URL = os.getenv("OLLAMA_URL", "").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma3:4b")
FORBIDDEN = re.compile(r"narusza(?:ją)? prawo|jest nielegaln|popełni|przestępstw|winn[ya]", re.I)
MODULE_NAMES = {"m1": "Finfluencerzy i podmioty trzecie", "m2": "Zgodność i informacja o ryzyku", "m3": "Shadow Advisory"}


def template(result: dict) -> str:
    issues = [f for f in result["findings"] if f["status"] in ("fail", "warn")]
    if not issues:
        return "Nie wykryto przesłanek wymagających weryfikacji. Reguły nieocenione: " + \
            (", ".join(f["rule_id"] for f in result["findings"] if f["status"] == "not_checked") or "brak") + "."
    lines = [f"Wynik {result['score']:.0f}/100. Moduły z sygnałami: "
             + (", ".join(MODULE_NAMES[m] for m in result["modules"]) or "brak") + "."]
    for f in sorted(issues, key=lambda f: (f["status"] != "fail", -f["severity"]))[:6]:
        frag = f" Fragment: „{f['evidence'][0]['text'][:140]}”." if f["evidence"] and f["evidence"][0].get("text") else ""
        lines.append(f"[{f['rule_id']}] {f['title']}: {f['explanation']}{frag}")
    lines.append("Powyższe to sygnały do weryfikacji przez analityka, a nie stwierdzenie naruszenia.")
    return "\n".join(lines)


def _facts(result: dict) -> dict:
    return {
        "score": result["score"], "modules": result["modules"],
        "publisher": result.get("m1", {}).get("publisher"), "firms": [f["name"] for f in result.get("m1", {}).get("firms", [])][:5],
        "advisory_classification": result.get("m3", {}).get("classification"),
        "findings": [{"rule_id": f["rule_id"], "status": f["status"], "title": f["title"], "explanation": f["explanation"],
                      "evidence": [e["text"][:200] for e in f["evidence"][:2]]}
                     for f in result["findings"] if f["status"] in ("fail", "warn")][:12],
    }


async def summarize(result: dict) -> tuple[str, str]:
    if not OLLAMA_URL:
        return template(result), "template"
    prompt = (
        "Jesteś asystentem analityka UKNF. Na podstawie WYŁĄCZNIE poniższych przesłanek (JSON) napisz po polsku "
        "zwięzłe podsumowanie (3-6 zdań). Każde zdanie zakończ odwołaniem w nawiasie kwadratowym do rule_id, np. [3]. "
        "Nie formułuj wniosków prawnych ani nie pisz, że ktoś narusza prawo – używaj sformułowań 'sygnał do weryfikacji'. "
        "Nie dodawaj faktów spoza danych.\n\nPRZESŁANKI:\n" + json.dumps(_facts(result), ensure_ascii=False)
    )
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(f"{OLLAMA_URL}/api/generate",
                                  json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False, "options": {"temperature": 0.1}})
            r.raise_for_status()
            text = r.json().get("response", "").strip()
        if not text or FORBIDDEN.search(text) or not re.search(r"\[[\w.]+\]", text):
            log.info("odrzucono odpowiedź LLM (brak cytowań lub wniosek prawny) – fallback do szablonu")
            return template(result), "template"
        return text, f"ollama:{OLLAMA_MODEL}"
    except Exception as exc:
        log.warning("Ollama niedostępna (%s) – fallback do szablonu", type(exc).__name__)
        return template(result), "template"
