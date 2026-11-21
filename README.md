# InvestWatch

System monitorowania reklam i ofert inwestycyjnych dla UKNF (HackNation 2026). Pobiera treści z internetu i mediów społecznościowych, analizuje je w trzech modułach i pokazuje wyniki na dashboardzie z alertami w czasie rzeczywistym.

- **M1 Finfluencerzy i podmioty trzecie**: firma z rejestru KNF, reklamujący, treść i URL; kody polecające; brak oznaczenia współpracy.
- **M2 Zgodność i informacja o ryzyku**: 18 reguł z załącznika UKNF (art. 44 rozp. 2017/565), w tym reguły wizualne 4–8 mierzone w przeglądarce (czcionka, kontrast WCAG, przesłonięcie, ukrycie, desktop/tablet/telefon).
- **M3 Shadow Advisory**: oferta indywidualnego doradztwa (art. 76 u.o.i.f.) vs materiał edukacyjny, weryfikacja podmiotu w rejestrze.

Każdy wynik ma przesłanki: `rule_id`, podstawę prawną, uzasadnienie i cytowany fragment. Wynik to sygnał do weryfikacji, nie stwierdzenie naruszenia.

## Quick Start

```bash
cp .env.example .env        # ustaw POSTGRES_PASSWORD
docker compose up -d --build
```

Dashboard: http://localhost:8080. Przy pierwszym starcie ładowanych jest 18 oznaczonych próbek demo (`data/samples`). Wyłącza to `SEED_DEMO=false`.

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

## Serwisy

| Serwis | Technologia | Port wewn. | Rola |
|---|---|---|---|
| `frontend` | React 19 + Vite, Recharts, Socket.io, nginx | 80 → `WEB_PORT` | Dashboard, proxy `/api` i `/socket.io` |
| `backend` | Node 22, Express 5, BullMQ, node-cron, zod | 4000 | API, kolejka z ponawianiem, harmonogram, WebSocket, zapis do bazy |
| `scraper` | Python, FastAPI, Playwright, BeautifulSoup | 8001 | Pobieranie, render 3 viewportów, ekstrakcja treści i metadanych, ochrona SSRF, rotacja UA/proxy |
| `analyzer` | Python, FastAPI, scikit-learn, RapidFuzz | 8002 | Moduły 1–3, klasyfikator zdań, scoring, rejestr KNF, podsumowanie |
| `postgres` | PostgreSQL 16 (pg_trgm, unaccent) | 5432 | Materiały, analizy, przesłanki, alerty, podmioty |
| `redis` | Redis 7 | 6379 | Kolejka zadań |
| `ollama` | profil `llm` | 11434 | Lokalny model do podsumowań |

## Konfiguracja (`.env`)

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `POSTGRES_USER/PASSWORD/DB` | – | Dane bazy |
| `WEB_PORT` | 8080 | Port dashboardu |
| `SCAN_CRON` | `0 */6 * * *` | Harmonogram skanowania źródeł |
| `DEFAULT_THRESHOLD` | 45 | Próg ryzyka 0–100 (zmiana w panelu kalibracji) |
| `SCRAPER_PROXIES` | – | Lista proxy rozdzielona przecinkami |
| `SCRAPER_ALLOW_PRIVATE` | false | Zezwolenie na adresy prywatne (domyślnie blokada SSRF) |
| `OLLAMA_URL`, `OLLAMA_MODEL` | –, `gemma3:4b` | LLM do podsumowań |
| `SEED_DEMO` | true | Załadowanie próbek przy pustej bazie |

## Uruchomienie bez Dockera (dev)

Wbudowany PostgreSQL z npm, kolejka w pamięci (`REDIS_URL=memory`). Każde polecenie w osobnym terminalu:

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
python -m tools.evaluate --samples ../../data/samples --threshold 45   # wymaga scrapera i analyzera
python -m tools.knf_import --out app/data/knf_registry.json            # odświeżenie rejestru KNF
```

Bezpieczeństwo łańcucha dostaw: wersje zależności są przypięte; CI (`.github/workflows/ci.yml`) uruchamia `pip-audit` i `npm audit`, a obrazy Docker przerywają build przy podatnościach wysokiego ryzyka. Sekrety są tylko w `.env`, poza repozytorium.

Architektura: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Proces pracy z asystentami AI: [docs/AI_WORKFLOW.md](docs/AI_WORKFLOW.md). Lista zadań: [TODO.md](TODO.md).

## Dane i ograniczenia

- Rejestr KNF to snapshot publicznych list (domy maklerskie, banki, oddziały i notyfikowane firmy zagraniczne; 752 podmioty). Brak podmiotu w rejestrze nie oznacza nielegalnej działalności.
- Próbki demo używają fikcyjnych podmiotów i domen `.example`.
- Treści z platform społecznościowych są pobierane z publicznych metadanych lub importowane ręcznie. System nie obchodzi zabezpieczeń platform.
