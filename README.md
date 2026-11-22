# InvestWatch

System monitorowania reklam i ofert inwestycyjnych dla UKNF (HackNation 2026). Pobiera treści z internetu i mediów społecznościowych, analizuje je w trzech modułach i pokazuje wyniki na dashboardzie z alertami w czasie rzeczywistym.

- **M1 Finfluencerzy i podmioty trzecie**: firma z rejestru KNF, reklamujący, treść i URL; kody polecające; brak oznaczenia współpracy.
- **M2 Zgodność i informacja o ryzyku**: 18 reguł z załącznika UKNF (art. 44 rozp. 2017/565), w tym reguły wizualne 4–8 mierzone w przeglądarce (czcionka, kontrast WCAG, przesłonięcie, ukrycie, desktop/tablet/telefon).
- **M3 Shadow Advisory**: oferta indywidualnego doradztwa (art. 76 u.o.i.f.) vs materiał edukacyjny, weryfikacja podmiotu w rejestrze.

Wzbogacanie danych podmiotów: **KRS** (kapitał, adres, NIP/REGON, zarząd, prokurenci, wspólnicy), **GLEIF** (kody LEI), **lista ostrzeżeń publicznych KNF** (669 wpisów) i **rejestr MiCA ESMA** (409 autoryzowanych CASP, 217 podmiotów bez licencji). Trafienia z list są przesłankami M1/M3 (dopasowanie po domenie, KRS, NIP lub nazwie). Numer KRS nie jest wymagany – dla polskich spółek z kodem LEI system odczytuje go z GLEIF. Strona **Rejestry** pozwala sprawdzić dowolny podmiot (odpis KRS aktualny lub pełny z historią, rekord LEI ze strukturą grupy), a karta podmiotu pokazuje wszystkie dane z rejestrów z wyszukiwarką.

Materiały można dodawać jako adres URL, HTML, tekst albo **obraz reklamy** (PNG/JPG/WebP, OCR Tesseract w kontenerze scrapera). Tekst z obrazu dostaje pozycję, wysokość liter i kontrast, więc reguły wizualne (rozmiar czcionki ostrzeżenia, kontrast, stopka) działają także na grafikach. Banery z tekstem w obrazie na renderowanych stronach również przechodzą OCR.

**Wideo i reels** (TikTok, Instagram, YouTube/Shorts, Facebook, X, Threads, LinkedIn, Vimeo, Twitch, Reddit, Dailymotion, Rumble i in., albo wgrany plik do 250 MB): yt-dlp pobiera publiczny materiał, faster-whisper przepisuje mowę, a OCR czyta napisy z klatek. Na wynik działają te same reguły, plus czas wyświetlania ostrzeżenia (poniżej 3 s to naruszenie) i ostrzeżenie wypowiedziane, ale nie pokazane na ekranie. Materiały wymagające zalogowania kończą się komunikatem „wgraj plik ręcznie”.

**Oszustwa i finfluencerzy:** każdy materiał (strona, post, wideo po transkrypcji i OCR) dostaje profil publikującego: podejrzenie oszustwa, płatna promocja, doradca, edukacja albo informacja. Do tego sygnały z cytatami (presja czasu, WhatsApp/Telegram, bot AI, „zacznij od 250 zł”, wizerunek znanych osób) i ocena realizmu obietnic przeliczona na rok („2% dziennie” ≈ 730% rocznie). Oficjalne strony firm i strony własne usługodawców nie są traktowane jak podmiot trzeci, a zadeklarowana licencja doradcy obniża M3 do „do weryfikacji”.

**Monitoring popularnych treści:** strona „Monitoring wideo” pokazuje popularne polskie hashtagi i frazy-przynęty oszustów („darmowa kasa”, „szybki zarobek”, „gwarantowany zysk”…). Wyszukuje kandydatów po #hashtagu lub frazie na YouTube, TikToku, Instagramie, X i Facebooku (YouTube natywnie z regionem PL, pozostałe przez publiczny indeks wyszukiwarki, bo strony tagów platform wymagają logowania), a także po profilu twórcy (YouTube, TikTok). Domyślnie tylko treści po polsku. Ranking hashtagów przelicza się co godzinę z danych (zasięg, liczba materiałów, ryzyko, trend), a najpopularniejsze tagi są automatycznie monitorowane na wszystkich platformach i wstrzymywane, gdy wypadną z czołówki.

**Weryfikacja analityka:** w podsumowaniu ikona ołówka włącza tryb edycji, w którym można odrzucić wybrane punkty. System przelicza wtedy wynik po weryfikacji i generuje nowe podsumowanie bez nich, a decyzja obowiązuje także po ponownej analizie. Ma próg wyświetleń, a zapisane zapytania uruchamia według harmonogramu, więc system działa profilaktycznie, a nie tylko na zgłoszenia. Wyniki można filtrować po zasięgu, tagu, typie publikującego i rodzaju materiału, a sortowanie „priorytet” to ryzyko × zasięg.

**Rynek:** strona „Rezerwy giełd (PoR)” pokazuje raport Proof of Reserves OKX (pokrycie per aktywo, alert przy pokryciu < 1:1 lub braku nowego raportu > 45 dni; to deklaracja giełdy, nie audyt). Karta podmiotu ma panel „Zachowanie w kryzysach (GPW)”: kurs spółki wobec WIG w okresie krachu COVID-19 lub wybuchu wojny w Ukrainie (maks. spadek, dni do odrobienia strat, beta, zmienność) z archiwum notowań gpw.pl.

Każdy wynik ma przesłanki: `rule_id`, podstawę prawną, uzasadnienie i cytowany fragment. Wynik to sygnał do weryfikacji, nie stwierdzenie naruszenia.

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
| `analyzer` | Python, FastAPI, scikit-learn, RapidFuzz | 8002 | Moduły 1–3, klasyfikator zdań, scoring, rejestr KNF, podsumowanie |
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

Architektura: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Proces pracy z asystentami AI: [docs/AI_WORKFLOW.md](docs/AI_WORKFLOW.md). Lista zadań: [TODO.md](TODO.md).

## Dane i ograniczenia

- Publiczne API KRS anonimizuje imiona, nazwiska i PESEL członków organów – osób nie łączymy między spółkami; każda pozycja ma status „wymaga weryfikacji”.
- Trafienie na liście ostrzeżeń po samej nazwie to słabszy sygnał (WARN) niż po domenie, KRS lub NIP (FAIL).
- Rejestr KNF to snapshot publicznych list (domy maklerskie, banki, oddziały i notyfikowane firmy zagraniczne; 752 podmioty). Brak podmiotu w rejestrze nie oznacza nielegalnej działalności.
- Próbki demo używają fikcyjnych podmiotów i domen `.example`.
- Poziom ryzyka: 0–30 niskie, 31–70 średnie, 71–100 wysokie. Próg alertu (panel kalibracji) jest osobny i decyduje tylko o alercie.
- Oficjalny materiał firmy (plik/tekst bez autora i domeny, podpisany przez firmę z rejestru KNF) nie jest oceniany w Module 1 – moduł dotyczy podmiotów trzecich i finfluencerów. Materiał edukacyjny bez wezwań do działania nie podlega regułom 1–2 Modułu 2.
- Duplikaty: odcisk simhash (64 bity) i odległość Hamminga w PostgreSQL; ta sama treść na kilku portalach jest oznaczana jako duplikat (≤ 3 bity).
- Monitoring zbiera tylko materiały polskojęzyczne (ustawienie `polish_only`); ręczna analiza działa dla każdego języka.
- Treści z platform społecznościowych są pobierane z publicznych metadanych lub importowane ręcznie. System nie obchodzi zabezpieczeń platform.
