"""Testy arytmetyki bez FastAPI i modelu ML."""
import importlib
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "analyzer"))
from app.model import Finding
from app.scoring import aggregate, category, module_score


class ScoringTest(unittest.TestCase):
    def finding(self, status, severity):
        return Finding("m2", "test", "syntetyczna", status, severity)

    def test_empty(self):
        self.assertEqual(module_score([]), 0)
        self.assertEqual(aggregate({})["score"], 0)

    def test_pass_na_not_checked_do_not_add_risk(self):
        for status in ("pass", "na", "not_checked"):
            self.assertEqual(module_score([self.finding(status, 100)]), 0)

    def test_warn_is_half_fail_weight(self):
        self.assertEqual(module_score([self.finding("warn", 60)]), 30)
        self.assertEqual(module_score([self.finding("fail", 60)]), 60)

    def test_noisy_or(self):
        self.assertEqual(module_score([self.finding("fail", 40), self.finding("fail", 50)]), 70)

    def test_aggregate_max_and_module_cutoff(self):
        result = aggregate({"m1": [self.finding("warn", 30)], "m2": [self.finding("fail", 60)]})
        self.assertEqual(result["score"], 60)
        self.assertEqual(result["modules"], ["m2"])

    def test_threshold_boundaries(self):
        self.assertEqual(category(45, 45), "wysokie")
        self.assertEqual(category(27, 45), "średnie")
        self.assertEqual(category(26.9, 45), "niskie")
        self.assertEqual(category(0, 0), "wysokie")


if __name__ == "__main__":
    unittest.main()
