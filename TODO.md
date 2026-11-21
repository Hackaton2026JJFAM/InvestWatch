# TODO – InvestWatch

Legenda: [x] zrobione · [ ] do zrobienia · (!) blokuje demo · ❓ wymaga decyzji zespołu

## Zrobione (szkielet + MVP)
- [x] Repo, `docker-compose.yml` (postgres, redis, scraper, analyzer, backend, frontend, ollama w profilu `llm`), `.env.example`
- [x] Schemat bazy (`db/init.sql`): materiały, analizy, przesłanki, alerty, podmioty, rejestry, osoby, kryzysy, rezerwy, pg_trgm
- [x] Scraper: SSRF, rotacja UA i proxy, Playwright w 3 viewportach, pomiar czcionki, kontrastu, przesłonięcia i ukrycia, zrzut ekranu, ekstrakcja treści i metadanych, social (og: + profil z URL), `/discover`
- [x] Analyzer: 18 reguł M2 + G1, M1, M3, klasyfikator zdań TF-IDF+LR, scoring noisy-OR, podsumowanie (Ollama + fallback szablon)
- [x] Rejestr KNF: importer (`tools/knf_import.py`) z paginacją, snapshot 752 podmiotów
- [x] 18 oznaczonych próbek demo (fikcyjne podmioty) + `tools/evaluate.py`; przy progu 45: precision 1.00, recall 0.92
- [x] Testy jednostkowe reguł (14, pytest)
- [x] Backend: API (skany, upload, materiały, analizy, podmioty, wyszukiwarka, dashboard, alerty, ustawienia, kalibracja, źródła), BullMQ z ponawianiem, cron, Socket.io, seed
- [x] Frontend: pulpit, wyniki z filtrami, szczegóły materiału (zakładki M1/M2/M3, zrzut, historia), alerty na żywo, podmioty (panele kategorii), wyszukiwarka, kalibracja (FP/FN, krzywe), skanowanie i źródła
- [x] `npm audit` (0 podatności), `pip-audit` (0 podatności), wersje przypięte

- [x] Lokalny stos bez Dockera (`tools/devstack/restart.ps1`: wbudowany Postgres, kolejka w pamięci)
- [x] Przeglądarka: konsola bez nowych błędów, toasty WebSocket na żywo, panel kalibracji – sprawdzone w trybie dev
- [x] Code-splitting frontendu (leniwe strony; największy chunk 386 kB zamiast 835 kB)
- [x] Testy backendu `npm test` (3 jednostkowe + 5 integracyjnych na działającym stosie: walidacja, SSRF, import → analiza → podobne → deduplikacja)
- [x] Podświetlanie ostrzeżeń i obietnic zysku na zrzucie całej strony (z naruszeniami reguł 4/5/6)
- [x] Prawie-duplikaty (simhash, Hamming ≤ 3 bity) + lista podobnych materiałów; migracje bazy przy starcie
- [x] Import wielu plików naraz (HTML/TXT/JSON/CSV z URL, `labels.json` z etykietami), przeciągnij i upuść
- [x] `DELETE /api/materials/:id`

## Następne kroki (priorytet)
- [ ] (!) Pierwsze uruchomienie `docker compose up --build` i test całego stosu (odłożone – brak Dockera)
- [x] Wykonać testy przeglądarkowe (audyt): 10/12 zaliczonych; toast WebSocket i zapis progu działają.
- [ ] (!) Naprawić listę materiałów i filtry (HTTP 502), odświeżanie licznika alertów oraz ponownie sprawdzić konsolę – zweryfikować wobec raportu audytu.
- [x] Przetestować REST i zapis na osobnym PostgreSQL 16 (audyt): 40/51 zaliczonych w wariancie diagnostycznym.
- [ ] (!) Dodać brakujący sterownik `ioredis` do aplikacji i powtórzyć test backendu w docelowym Compose.
- [ ] (!) Na hackathonie: wczytać próbki od UKNF (pendrive) przez „Import wielu plików”, oznaczyć je i przeliczyć kalibrację
- [x] Konsola bez ostrzeżeń WebSocket (jedno połączenie Socket.io na aplikację)
- [ ] Import obrazów/zrzutów reklam (OCR) – formaty dziś pomijane przy imporcie
- [ ] Przycisk „Usuń materiał” w UI (endpoint już jest)

## Should
- [ ] Adapter KRS (API KRS – sprawdzić limity): zarząd, wspólnicy, kapitał → `persons`, `person_links`
- [ ] Adapter GLEIF (LEI) dla podmiotów zagranicznych
- [ ] Lista ostrzeżeń publicznych KNF jako osobny rejestr (sygnał dla M1/M3)
- [ ] Rejestr ESMA (MiCA CASP) – licencje giełd krypto
- [ ] Rozszerzenie zbioru treningowego klasyfikatora (`app/data/sentences.tsv`) albo fine-tune HerBERT
- [ ] Embeddingi (Ollama `nomic-embed-text`) do grupowania podobnych reklam

## Could
- [ ] Zachowanie w kryzysach dla 1 okresu i 1 podmiotu (dane GPW)
- [ ] Proof of reserves dla 1 giełdy (parser raportu, alert przy pokryciu < 1:1)
- [ ] Wideo/reels: ffmpeg → faster-whisper → OCR (Tesseract/PaddleOCR) → te same reguły
- [ ] Listy sankcji UE dla osób (status „wymaga weryfikacji”)

## Formalności
- [ ] Prezentacja PDF
- [ ] Szczegółowy opis projektu i tytuł
- [ ] Film do 3 minut (opcjonalnie)
- ❓ Repo publiczne czy prywatne na czas oceny
- ❓ Model LLM na demo (`gemma3:4b` vs mniejszy) – zależy od sprzętu

## Stan audytu i CI

- [x] Uruchomić istniejące testy analyzera (14/14), ewaluację 18 próbek (precyzja 1,00; pełność 0,92 przy progu 45) i audyty npm/pip (0 zgłoszeń w dniu audytu).
- [x] Wykonać zestawy audytowe: 161 przypadków, 130 zaliczonych i 31 niezaliczonych. [Raport i reprodukcje](docs/AUDIT_REPORT.md), [wyniki](audit_tests/results/summary.json).
- [x] Poprawić przyczyny nieudanego CI na `test/audit`: niespójny lockfile frontendu i brak instalacji `pip-audit`.
- [ ] Usunąć pozostałe błędy audytu; zielone CI nie zastępuje testu pełnego stosu ani nie oznacza zaliczenia wszystkich przypadków audytowych.
