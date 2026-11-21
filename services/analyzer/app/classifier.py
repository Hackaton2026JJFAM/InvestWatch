"""Klasyfikator zdań (statystyczny, lokalny): profit / risk / advisory / education / neutral.

Reprezentacja wektorowa: TF-IDF na n-gramach znakowych (odporne na fleksję polską) i słownych.
Model: regresja logistyczna (wieloklasowa). Trenowany przy starcie na app/data/sentences.tsv,
uzupełnia reguły jawne – nie zastępuje ich. Docelowo: HerBERT fine-tune (TODO.md).
"""
from __future__ import annotations

import csv
import hashlib
from functools import lru_cache
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.feature_extraction.text import TfidfVectorizer

from .text import Sentence, fold

DATA = Path(__file__).parent / "data" / "sentences.tsv"


class SentenceClassifier:
    def __init__(self) -> None:
        rows = list(csv.DictReader(DATA.open(encoding="utf-8"), delimiter="\t"))
        texts = [fold(r["text"]) for r in rows]
        labels = [r["label"] for r in rows]
        self.pipeline = Pipeline([
            ("features", FeatureUnion([
                ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True, min_df=1)),
                ("word", TfidfVectorizer(analyzer="word", ngram_range=(1, 2), sublinear_tf=True)),
            ])),
            ("clf", LogisticRegression(max_iter=2000, C=4.0, class_weight="balanced")),
        ])
        self.pipeline.fit(texts, labels)
        self.classes = list(self.pipeline.classes_)
        self.n_train = len(rows)
        self.version = "tfidf-lr-" + hashlib.sha1(DATA.read_bytes()).hexdigest()[:8]

    def label(self, sentences: list[Sentence]) -> None:
        if not sentences:
            return
        probs = self.pipeline.predict_proba([fold(s.text) for s in sentences])
        for s, p in zip(sentences, probs):
            s.labels = {c: round(float(v), 3) for c, v in zip(self.classes, p)}

    def document_profile(self, sentences: list[Sentence]) -> dict:
        if not sentences:
            return {}
        m = np.array([[s.labels.get(c, 0) for c in self.classes] for s in sentences])
        top = {c: [s.text[:200] for s in sorted(sentences, key=lambda s: -s.labels.get(c, 0))[:2] if s.labels.get(c, 0) > 0.5]
               for c in self.classes if c != "neutral"}
        return {"mean": dict(zip(self.classes, np.round(m.mean(0), 3).tolist())),
                "max": dict(zip(self.classes, np.round(m.max(0), 3).tolist())), "top_sentences": top}


@lru_cache(maxsize=1)
def get_classifier() -> SentenceClassifier:
    return SentenceClassifier()


def simhash(text: str, bits: int = 64) -> str:
    """Odcisk do wykrywania prawie-duplikatów (odległość Hamminga)."""
    tokens = fold(text).split()
    shingles = [" ".join(tokens[i:i + 3]) for i in range(max(len(tokens) - 2, 1))]
    v = [0] * bits
    for sh in shingles:
        h = int.from_bytes(hashlib.md5(sh.encode()).digest()[:8], "big")
        for i in range(bits):
            v[i] += 1 if h >> i & 1 else -1
    return f"{sum(1 << i for i in range(bits) if v[i] > 0):016x}"
