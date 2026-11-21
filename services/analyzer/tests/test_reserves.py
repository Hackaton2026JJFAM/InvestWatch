"""Parser raportu Proof of Reserves (OKX) na zapisanej stronie i danych syntetycznych."""
import json
from pathlib import Path

import pytest

from app import reserves

FIXTURE = Path(__file__).parent / "fixtures" / "okx_por.html"


def test_parse_saved_okx_page():
    r = reserves.parse_okx(FIXTURE.read_text(encoding="utf-8"))
    btc = next(a for a in r["assets"] if a["coin"] == "BTC")
    assert btc["liabilities"] and btc["reserves"] and btc["coverage"] > 1
    assert r["report_date"] and r["audit_id"] and r["merkle_root"]
    assert r["min_coverage"] is not None


def test_coverage_below_one_is_reported():
    info = {"auditId": "1", "createTime": 1700000000000, "merkleHash": "h", "reserveCurrencies": ["BTC", "ETH"],
            "liabilityBalances": {"BTC": "100", "ETH": "50"}, "reserveBalances": {"BTC": "110", "ETH": "45"}, "capitalRatio": {}}
    html = '<script data-id="x" type="application/json" id="appState">' + json.dumps({"appContext": {"initialProps": {"App": {"auditRootInfo": info}}}}) + "</script>"
    r = reserves.parse_okx(html)
    assert r["below_one"] == ["ETH"] and r["min_coverage"] == 0.9


def test_missing_data_raises():
    with pytest.raises(reserves.ReportUnavailable):
        reserves.parse_okx("<html>brak danych</html>")
