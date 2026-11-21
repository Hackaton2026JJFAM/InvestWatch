"""Agregacja zapisanych wyników; nie uruchamia ani nie udaje testów."""
import json
from pathlib import Path
import xml.etree.ElementTree as ET

root = Path(__file__).parent / "results"
rows = []
failures = []
for path in sorted(root.glob("*.xml")):
    tests = ET.parse(path).findall(".//testcase")
    failed = [t for t in tests if t.find("failure") is not None or t.find("error") is not None]
    skipped = [t for t in tests if t.find("skipped") is not None]
    rows.append({"file": path.name, "total": len(tests), "passed": len(tests) - len(failed) - len(skipped),
                 "failed": len(failed), "skipped": len(skipped)})
    for t in failed:
        f = t.find("failure")
        if f is None:
            f = t.find("error")
        failures.append({"file": path.name, "test": t.get("name"),
                         "message": f.get("message"), "detail": (f.text or "")})
out = {"suites": rows, "totals": {k: sum(r[k] for r in rows) for k in ("total", "passed", "failed", "skipped")},
       "failures": failures}
(root / "summary.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"suites": rows, "totals": out["totals"]}, indent=2))
