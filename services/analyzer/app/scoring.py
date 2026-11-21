"""Funkcje scoringowe: przesłanki -> wynik 0-100 (niezależny od progu).

Wynik modułu = noisy-OR wag przesłanek: 100 * (1 - Π(1 - w_i)), gdzie w_i = waga reguły
dla statusu fail, połowa wagi dla warn. Wynik materiału = maksimum z modułów.
Próg (threshold) stosuje backend – zmiana progu nie zmienia wyniku klasyfikatora.
"""
from __future__ import annotations

from .model import FAIL, WARN, Finding


def module_score(findings: list[Finding]) -> float:
    keep = 1.0
    for f in findings:
        w = f.severity / 100 if f.status == FAIL else f.severity / 200 if f.status == WARN else 0
        keep *= 1 - min(max(w, 0), 0.95)
    return round(100 * (1 - keep), 1)


def aggregate(by_module: dict[str, list[Finding]]) -> dict:
    scores = {m: module_score(fs) for m, fs in by_module.items()}
    total = max(scores.values()) if scores else 0.0
    return {"score": total, "module_scores": scores, "modules": [m for m, s in scores.items() if s >= 20]}


def category(score: float, threshold: float) -> str:
    if score >= threshold:
        return "wysokie"
    if score >= threshold * 0.6:
        return "średnie"
    return "niskie"
