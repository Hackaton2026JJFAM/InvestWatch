# Testy audytowe InvestWatch

Testy dodane podczas audytu, bez zmian kodu aplikacji. Używają wyłącznie
syntetycznych treści i fikcyjnych podmiotów. Testy backendu wymagają osobnej,
pustej bazy testowej; nie uruchamiać przeciwko bazie użytkownika.

Wyniki i ograniczenia: `docs/AUDIT_REPORT.md` (ścieżka od katalogu głównego repo).
Zależności serwisów wymagają **Python >=3.12**. Nie uruchamiać wszystkich testów
na danych produkcyjnych.

Uruchomienie testów HTTP (serwisy Python na portach 8001/8002):

```powershell
python -m pytest audit_tests/test_http.py -v --junitxml=audit_tests/results/http.xml
python -m pytest audit_tests/test_visual.py -v --junitxml=audit_tests/results/visual.xml
python -m pytest audit_tests/test_backend.py -v --junitxml=audit_tests/results/backend.xml
python -m pytest audit_tests/test_backend_workflows.py -v --junitxml=audit_tests/results/backend-workflows.xml
python -m pytest audit_tests/test_browser.py -v --junitxml=audit_tests/results/browser.xml
python -m unittest audit_tests/test_scoring.py -v
node --test audit_tests/test_node.mjs
```

Backend: port 4000, frontend Vite: 5173. Operacje administracyjne (próg, źródła) wymagają `AUDIT_ADMIN_PASSWORD` równego `ADMIN_PASSWORD` backendu. Testy Chromium wymagają
`python -m playwright install chromium`. Domyślne porty serwisów Python można
zmienić zmiennymi `AUDIT_SCRAPER`, `AUDIT_ANALYZER`; backendu: `AUDIT_BACKEND`.

`start_db.mjs` tworzy nowy PostgreSQL na porcie 55432 i stosuje oryginalny schemat.
Odmawia startu, jeśli jego katalog bazy już istnieje; nie resetuje go.
Wymaga narzędzia `embedded-postgres` zainstalowanego poza repozytorium
oraz `AUDIT_NODE_ROOT` wskazującego katalog narzędzi.
Testy Node/`browser_smoke.mjs` potrzebują w tym katalogu także
`socket.io-client` i `playwright` (smoke używa zainstalowanego Edge).

Wariant diagnostyczny audytu wymagał dodatkowego `ioredis` w zewnętrznym
`NODE_PATH` — **oryginalny manifest backendu go nie zawiera**.
Nie ukrywać tego warunku przy interpretacji wyników.

Testy świadomie zawierają asercje oczekiwanego zachowania, także dla wykrytych
błędów. Nie oznaczamy ich jako pominiętych ani oczekiwanych porażek.

Kontrolowane źródło HTTP:

1. `python audit_tests/fixture_server.py` — syntetyczny serwer na 18080.
2. W oddzielnym terminalu, w `services/scraper`, ustawić
   `$env:SCRAPER_ALLOW_PRIVATE='true'`, następnie
   `python -m uvicorn app.main:app --host 127.0.0.1 --port 18001`.
   Ta opcja dotyczy wyłącznie kontrolowanej instancji testowej, nie głównego scrapera.
3. `python -m pytest audit_tests/test_controlled_scrape.py -v`

`test_public_scrape.py` wykonuje kilka odczytów `example.com`; nie uruchamiać
w pętli i nie używać jako testu dostępności tej zewnętrznej domeny.
`retry_outage.py` wymaga świadomego zatrzymania **wyłącznie testowego** analyzera.
`seed_pipeline.mjs` wymaga świeżej bazy bez załadowanych 18 próbek i sprawdza
rzeczywisty potok oraz odbiór zdarzeń WebSocket.

`python audit_tests/summarize_results.py` agreguje już zapisane XML;
nie uruchamia testów i nie nadaje samodzielnie statusów PASS.
