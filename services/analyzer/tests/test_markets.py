"""Zachowanie w kryzysie (GPW): parser tabeli archiwum i metryki na danych syntetycznych."""
import datetime as dt

from app import markets

HTML = """<html><body><table class="table"><tr><th></th><th>CALL</th></tr></table>
<table class="table footable"><tr><th>Nazwa</th><th>Waluta</th><th>Kurs otwarcia</th><th>Kurs maksymalny</th>
<th>Kurs minimalny</th><th>Kurs zamknięcia</th><th>Zmiana kursu %</th><th>Wartość obrotu (w tys.)</th></tr>
<tr><td>11BIT</td><td>PLN</td><td>294,0000</td><td>337,5000</td><td>256,0000</td><td>337,0000</td><td>14,24</td><td>14&nbsp;762,74</td></tr>
<tr><td>WIG</td><td></td><td>38&nbsp;031,23</td><td>38&nbsp;031,23</td><td>35&nbsp;588,11</td><td>37&nbsp;738,36</td><td>-2,31</td><td>1&nbsp;403&nbsp;930,70</td></tr>
</table></body></html>"""


def test_parse_day_numbers_with_spaces_and_commas():
    d = markets.parse_day(HTML)
    assert d["11BIT"]["close"] == 337.0 and d["11BIT"]["change_pct"] == 14.24
    assert d["WIG"]["close"] == 37738.36 and d["WIG"]["turnover_k"] == 1403930.70


def test_parse_day_without_session():
    assert markets.parse_day("<html><p>Brak danych</p></html>") == {}


def _days(n):
    start = dt.date(2020, 2, 17)
    return [(start + dt.timedelta(days=i)).isoformat() for i in range(n)]


def test_metrics_crisis_phase_and_recovery():
    d = _days(25)
    # spadek do 65 w kryzysie, odrobienie 104 w 9. sesji; późniejszy spadek do 60 (sesja 20) jest poza fazą kryzysu
    stock = [100, 104, 90, 70, 65, 72, 80, 95, 105, 110] + [110] * 10 + [60] + [112] * 4
    wig = [100, 101, 92, 80, 75, 78, 82, 86, 90, 92] + [93] * 15
    own = [{"date": x, "close": c} for x, c in zip(d, stock)]
    bench = [{"date": x, "close": c} for x, c in zip(d, wig)]
    m = markets.metrics(own, bench)
    assert m["market_trough"] == d[4]
    assert m["peak"]["close"] == 104 and m["trough"]["close"] == 65
    assert m["recovery_date"] == d[8] and m["recovery_days"] == 4
    assert m["benchmark_drawdown"] == -0.2574   # 101 -> 75
    assert m["window_max_drawdown"] < m["max_drawdown"]     # spadek do 60 widoczny tylko w całym oknie


def test_metrics_simple_recovery():
    d = _days(30)
    stock = [100, 95, 80, 70, 75, 85, 95, 101] + [102] * 22
    wig = [100, 96, 85, 78, 80, 88, 94, 98] + [99] * 22
    m = markets.metrics([{"date": x, "close": c} for x, c in zip(d, stock)], [{"date": x, "close": c} for x, c in zip(d, wig)])
    assert m["max_drawdown"] == -0.3
    assert m["trough"]["date"] == d[3] and m["recovered"] and m["recovery_date"] == d[7]
    assert m["recovery_days"] == 4
    assert m["relative_drawdown"] == -0.08
    assert m["chart"][0] == {"date": d[0], "stock": 100.0, "wig": 100.0}


def test_crisis_report_validates_ticker():
    import pytest
    with pytest.raises(ValueError):
        markets.crisis_report("x; DROP", "covid2020")
    with pytest.raises(ValueError):
        markets.crisis_report("PKOBP", "nieznany")
