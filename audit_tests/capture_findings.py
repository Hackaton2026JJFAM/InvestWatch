"""Zapis rzeczywistych odpowiedzi dla istotnych reprodukcji."""
import json
from pathlib import Path

import httpx

from test_http import analyze, rule


cases = {
    "m1_suffix": (
        "Dom Maklerski Vistula Capital S.A. Polecam akcje i ETF. Z moim kodem polecającym bonus.",
        {"url": "https://evilvistula-capital.example/post", "author": "@audit_synthetic"}),
    "m1_generic_firm_name": ("Reklama. Dom maklerski oferuje akcje. Zarabiaj.", {}),
    "m2_negated": ("Materiał edukacyjny. Nie obiecujemy gwarantowanego zysku. "
                   "Nie istnieje zysk bez ryzyka. Możesz stracić cały kapitał.", {}),
    "m2_fake_risk": ("Reklama. Zysk 12% rocznie. Nasz zespół lubi ryzykować.", {}),
    "m2_negated_disclosure": ("To nie jest reklama. Zarabiaj 15% rocznie. Otwórz konto.", {}),
    "m3_without_broker": (
        "Syntetyczna Aurum Advisory Sp. z o.o. Wealth management. "
        "Przygotujemy indywidualne rekomendacje zakupu akcji dopasowane do Twojej sytuacji. Pakiet 990 zł/mies.", {}),
    "m3_with_broker": (
        "Syntetyczna Aurum Advisory Sp. z o.o. Wealth management. "
        "Przygotujemy indywidualne rekomendacje zakupu akcji dopasowane do Twojej sytuacji. Pakiet 990 zł/mies. "
        "Transakcje wykonasz przez Dom Maklerski Vistula Capital S.A.", {}),
    "m3_with_broker_disclosure": (
        "#reklama. Syntetyczna Aurum Advisory Sp. z o.o. Wealth management. "
        "Przygotujemy indywidualne rekomendacje zakupu akcji dopasowane do Twojej sytuacji. Pakiet 990 zł/mies. "
        "Transakcje wykonasz przez Dom Maklerski Vistula Capital S.A.", {}),
}
out = {}
for name, (text, meta) in cases.items():
    result = analyze(text, **meta)
    out[name] = {"input": {"text": text, **meta}, "result": result}
out["invalid_api"] = []
for endpoint, payload in [
    ("/analyze", {"url": "x", "content_text": ""}),
    ("/analyze", {"url": "x", "content_text": "Reklama. Zysk 10% rocznie.",
                  "layout": {"engine": "playwright", "viewports": {"desktop": "bad"}}}),
    ("/summary", {"result": {}}),
]:
    response = httpx.post("http://127.0.0.1:8002" + endpoint, json=payload)
    out["invalid_api"].append({"path": endpoint, "input": payload,
                               "status": response.status_code, "body": response.text,
                               "content_type": response.headers.get("content-type")})
Path("audit_tests/results/finding-examples.json").write_text(
    json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({name: {
    "score": value["result"]["score"], "module_scores": value["result"]["module_scores"],
    "publisher": value["result"]["m1"]["publisher"],
    "m3_1": rule(value["result"], "M3.1")["status"],
} for name, value in out.items() if name != "invalid_api"}, ensure_ascii=True, indent=2))
