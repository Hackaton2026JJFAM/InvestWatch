# TrustLens

**Automatyczny nadzór nad reklamą inwestycyjną w internecie i mediach społecznościowych** – zadanie UKNF #InvestWatch (HackNation 2026). Nazwa robocza w kodzie: InvestWatch.

System wyszukuje reklamy i oferty finansowe (strony WWW, TikTok, Instagram, Facebook, YouTube, X i inne; tekst, grafika, wideo), ocenia je w trzech modułach – M1 finfluencerzy i podmioty trzecie, M2 informacja o ryzyku (18 wymogów z załącznika), M3 doradztwo bez zezwolenia – i pokazuje wyniki z alertami w czasie rzeczywistym oraz panelem kalibracji progu. Działa lokalnie, na otwartym oprogramowaniu, bez płatnych API.

Szczegółowy opis projektu: [docs/OPIS_PROJEKTU.md](docs/OPIS_PROJEKTU.md).

## Quick Start

```bash
cp .env.example .env        # ustaw POSTGRES_PASSWORD i ADMIN_PASSWORD
docker compose up -d --build
```

Dashboard: http://localhost:8080 (domyślnie tylko z tego komputera, `WEB_BIND`). Przy pierwszym starcie ładowane są 3 oznaczone próbki do testów (`data/samples`: strona z „pewnym zyskiem”, oznaczona współpraca, TikTok) i fikcyjne podmioty DEMO; pełen zestaw 23 próbek (z grafiką do OCR i reelsem do transkrypcji) wczytuje `SEED_SAMPLES=all`, a `SEED_DEMO=false` wyłącza próbki całkiem. Próbki mają oznaczenie „próbka” i można je ukryć przełącznikiem „pokaż próbki demo”.

Przeglądanie i import materiałów nie wymagają logowania. Zmiana progu, zarządzanie źródłami, ładowanie próbek i usuwanie materiałów wymagają hasła administratora (`ADMIN_PASSWORD`).

Lokalny LLM do podsumowań (opcjonalnie):

```bash
docker compose --profile llm up -d
docker compose exec ollama ollama pull gemma3:4b
# w .env: OLLAMA_URL=http://ollama:11434, potem: docker compose up -d analyzer
```

Bez Ollamy podsumowanie powstaje z szablonu na podstawie tych samych przesłanek.

## Wymagania sprzętowe

| Tryb | CPU | RAM | Dysk |
|---|---|---|---|
| Podstawowy (bez LLM) | 2 rdzenie | 4 GB | 5 GB (obraz Playwright ~2 GB) |
| Z Ollamą (`gemma3:4b`) | 4 rdzenie | 10 GB | 10 GB; GPU opcjonalne |

Wideo: model Whisper `small` zajmuje ~0,5 GB (wolumen `whisper`, pobierany przy pierwszym starcie) i ~1 GB RAM. Na CPU przetwarza nagranie w czasie ~0,5× jego długości.

## Serwisy

| Serwis | Technologia | Port wewn. | Rola |
|---|---|---|---|
| `frontend` | React 19 + Vite, Recharts, Socket.io, nginx | 80 → `WEB_PORT` | Dashboard, proxy `/api` i `/socket.io` |
| `backend` | Node 22, Express 5, BullMQ, node-cron, zod | 4000 | API, kolejka z ponawianiem, harmonogram, WebSocket, zapis do bazy |
| `scraper` | Python, FastAPI, Playwright, BeautifulSoup, Tesseract, yt-dlp, faster-whisper | 8001 | Pobieranie, render 3 viewportów, OCR obrazów i banerów, wideo (transkrypcja + OCR klatek), ekstrakcja treści i metadanych, ochrona SSRF, rotacja UA/proxy |
| `analyzer` | Python, FastAPI, scikit-learn, RapidFuzz | 8002 | Moduły 1–3, klasyfikator zdań, embeddingi, scoring, rejestr KNF, podsumowanie |
| `postgres` | PostgreSQL 16 (pg_trgm, unaccent) | 5432 | Materiały, analizy, przesłanki, alerty, podmioty |
| `redis` | Valkey 8 (BSD, protokół Redis) | 6379 | Kolejka zadań |
| `ollama` | profil `llm` | 11434 | Lokalny model do podsumowań |

## Konfiguracja (`.env`)

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `POSTGRES_USER/PASSWORD/DB` | – | Dane bazy |
| `WEB_PORT`, `WEB_BIND` | 8080, 127.0.0.1 | Port dashboardu i adres nasłuchu (`0.0.0.0` = dostęp z sieci) |
| `ADMIN_PASSWORD` | – | Hasło administratora; puste = operacje administracyjne wyłączone |
| `SECURE_COOKIES` | false | `true` za reverse proxy z HTTPS |
| `ALLOWED_ORIGINS` | – | Dodatkowe Origin dopuszczone do WebSocket (domyślnie tylko ten sam host) |
| `SCAN_CRON` | `0 */6 * * *` | Harmonogram skanowania źródeł |
| `DEFAULT_THRESHOLD` | 45 | Początkowy próg ryzyka 0–100 (później zmiana w panelu kalibracji) |
| `SCRAPER_PROXIES` | – | Lista proxy rozdzielona przecinkami |
| `SCRAPER_ALLOW_PRIVATE` | false | Zezwolenie na adresy prywatne (domyślnie blokada SSRF) |
| `WHISPER_MODEL` | small | Model transkrypcji wideo (`tiny`, `base`, `small`, `medium`); na słabszym sprzęcie `base` (~3× szybszy) |
| `WHISPER_THREADS` | połowa rdzeni | Wątki CPU dla Whispera – reszta zostaje dla renderu stron i odpowiedzi API |
| `VIDEO_TRANSCRIBE` | true | `false` wyłącza transkrypcję mowy (z filmów liczą się wtedy napisy z OCR i opis) |
| `SCRAPER_HEALTH_TIMEOUT_MS` | 10000 | Czas oczekiwania backendu na `/health` scrapera; brak odpowiedzi przy pracy = „zajęty”, nie awaria |
| `WHISPER_PRELOAD` | true | Ładowanie modelu w tle przy starcie scrapera |
| `VIDEO_MAX_SECONDS`, `VIDEO_MAX_MB` | 900, 250 | Analizowany fragment wideo (dłuższe filmy – pierwsze N sekund) i limit rozmiaru pliku |
| `SCRAPER_COOKIES_FILE` | – | Opcjonalny plik cookies (format Netscape) dla materiałów wymagających logowania |
| `WATCH_CRON` | `15 */3 * * *` | Uruchamianie zapisanych zapytań monitoringu wideo |
| `WORKER_CONCURRENCY`, `VIDEO_WORKER_CONCURRENCY` | 2, 1 | Równoległość torów kolejki: strony / wideo (Whisper) – zwiększaj razem z `--scale scraper=N` |
| `SOCIAL_SEARCH_INTERVAL` | 6 | Minimalny odstęp (s) między zapytaniami do wyszukiwarki przy hashtagach TikTok/Instagram/X/Facebook |
| `VIDEO_REFRESH_DAYS` | 7 | Wideo przeanalizowane w tym okresie nie jest pobierane ponownie |
| `TAGS_CRON`, `TAG_AUTO_WATCH`, `TAG_AUTO_MIN_VIEWS` | `5 * * * *`, 8, 5000 | Przeliczanie rankingu hashtagów i automatyczny monitoring czołówki |
| `RESERVES_CRON` | `30 6 * * *` | Odczyt raportu Proof of Reserves (OKX); działa przy `ENRICH_AUTO=true` |
| `OLLAMA_URL`, `OLLAMA_MODEL` | –, `gemma3:4b` | LLM do podsumowań |
| `ENRICH_AUTO` | true | Automatyczne wzbogacanie nowych spółek (KRS, GLEIF, listy) – wymaga internetu z analizatora |
| `SEED_DEMO` | true | Próbki przy pustej bazie i fikcyjne podmioty DEMO w rejestrze (oznaczone jako DEMO, nigdy jako wpis KNF) |
| `SEED_SAMPLES` | 3 próbki | Lista plików z `data/samples` wczytywanych przy pustej bazie; `all` = wszystkie (kalibracja) |

## Uruchomienie bez Dockera (dev)

Wymaga Python ≥ 3.12 i Node ≥ 20. Wbudowany PostgreSQL z npm, kolejka w pamięci (`REDIS_URL=memory`). Restart całego stosu jednym poleceniem (Windows; logi w `.devdata/logs`, `-ResetDb` zakłada bazę od zera, hasło administratora z `.env`, domyślnie `investwatch-dev`):

```bash
powershell -ExecutionPolicy Bypass -File tools/devstack/restart.ps1
```

Ręcznie, każde polecenie w osobnym terminalu:

```bash
cd tools/devstack && npm install && node start-db.mjs                    # PostgreSQL :5433
cd services/scraper && ../../.venv/Scripts/python -m uvicorn app.main:app --port 8001
cd services/analyzer && ../../.venv/Scripts/python -m uvicorn app.main:app --port 8002
cd services/backend && DATABASE_URL=postgres://investwatch:investwatch@localhost:5433/investwatch REDIS_URL=memory SAMPLES_DIR=../../data/samples node src/index.js
cd services/frontend && npx vite                                         # http://localhost:5173
```

## Rozwój i testy

```bash
python -m venv .venv && .venv/Scripts/pip install -r services/analyzer/requirements-dev.txt -r services/scraper/requirements.txt
cd services/analyzer && ../../.venv/Scripts/python -m pytest -q
cd services/backend && npm test                                          # integracyjne wymagają działającego stosu
AUDIT_ADMIN_PASSWORD=... python -m pytest audit_tests -q                 # testy audytowe, opis w audit_tests/README.md
python -m tools.evaluate --samples ../../data/samples --threshold 45   # wymaga scrapera i analyzera
python -m tools.knf_import --out app/data/knf_registry.json            # odświeżenie rejestru KNF
python -m tools.watchlists_import                                      # odświeżenie listy ostrzeżeń KNF i rejestru MiCA ESMA
```

Bezpieczeństwo łańcucha dostaw: wersje zależności są przypięte; CI (`.github/workflows/ci.yml`) uruchamia `pip-audit` i `npm audit`; obrazy Node przerywają build przy podatnościach wysokiego ryzyka (`npm audit --audit-level=high`). `GET /api/health` to gotowość całego stosu (503, gdy brakuje bazy, kolejki, scrapera lub analizatora), `GET /api/live` – sam proces. Sekrety są tylko w `.env`, poza repozytorium.

## Dokumentacja

- [Szczegółowy opis projektu](docs/OPIS_PROJEKTU.md) – problem, moduły 1–3, kalibracja, architektura, ograniczenia
- [Architektura](docs/ARCHITECTURE.md) – przepływ zadania, kontrakt danych, scoring, źródła danych
- [Proces z asystentami AI](docs/AI_WORKFLOW.md) · [Raport audytu](docs/AUDIT_REPORT.md) · [Lista zadań](TODO.md)
