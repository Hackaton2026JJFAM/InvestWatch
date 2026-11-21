# InvestWatch — raport testów i zgodności

Data audytu: 21.11.2026. Punkt odniesienia: commit `450a8e6`.

## Wniosek

**Projekt nie jest jeszcze gotowy do powtarzalnego uruchomienia i prezentacji z czystego repozytorium.**
Wykryto blokery instalacji frontendu i pracy backendu oraz błąd SQL
uniemożliwiający domyślne wyświetlenie listy materiałów.
Architektura odpowiada kierunkowi zadania, ale nie oznacza to pełnej zgodności
funkcjonalnej ani formalnej.

Nie naprawiano kodu aplikacji, manifestów, lockfile ani schematu.
Dodano tylko testy audytowe, ich wyniki i ten raport.

## 1. Metoda i bezpieczeństwo danych

- Przed testami `git status --short`: wyłącznie dwa nieśledzone PDF użytkownika.
- Nie resetowano repozytorium, nie usuwano danych aplikacji ani wolumenów.
- PostgreSQL utworzono od zera poza repozytorium, na `127.0.0.1:55432`,
  baza `investwatch_audit`. Uruchomiono **oryginalny** `db/init.sql`.
- Treści testowe są syntetyczne; użyto fikcyjnych firm, profilu
  `@audit_synthetic`, domen `.example` i istniejących próbek demo.
- Narzędzia pomocnicze i interpretery instalowano do
  `C:\Users\jkacz\AppData\Local\Temp\opencode\investwatch-*`.
- Nie podmieniano odpowiedzi scrapera/analyzera w testach HTTP i przeglądarkowych.
  Jedynie trzy testy jednostkowe klienta HTTP celowo podstawiają `fetch`
  (kontrakt błędów/204/nie-JSON); nie są dowodem integracji z backendem.
- Instancję backendu zapętlającą błędy zatrzymano. Jej log urósł do
  **2 649 658 886 bajtów w około 2,5 minuty**; zachowano początek
  (`audit_tests/results/backend-original-start.txt`), usunięto wyłącznie ten
  wygenerowany przez audyt nadmierny log, nie dane projektu.

### Dwa warianty uruchomienia — nie należy ich utożsamiać

1. **Oryginalna instalacja:** backend `npm ci` działa, ale start nie daje
   responsywnego API z powodu braku `ioredis`; frontend `npm ci` kończy się błędem.
2. **Diagnostyczny:** bez zmian plików projektu dostarczono `ioredis`
   przez `NODE_PATH` wskazujący katalog narzędzi audytowych. Frontend zainstalowano
   przez `npm install --package-lock=false --ignore-scripts`.
   Testy aplikacji w tym wariancie nie unieważniają blockerów wariantu 1.

Środowisko: Windows, Python 3.12.16, Node 22.23.5 (dodatkowo sprawdzono npm pod Node 20.20.2),
PostgreSQL 16.16 z rozszerzeniami `pg_trgm` i `unaccent`.
Zamiast niedostępnego Redisa użyto **Memurai Developer 8.2.1 / Redis API 8.2.11**
na porcie 56379, wyłącznie jako testowej usługi zgodnej z protokołem Redis.
To nie jest potwierdzenie zgodności z obrazem `redis:7-alpine` i nie jest
propozycja dodania Memurai do stosu projektu.

Render: prawdziwy Chromium 159.0.8154.6, Playwright Python 1.65.2;
dodatkowy smoke frontendu na Edge 157.0.4341.60.
Test kontrolowanego źródła używał osobnego scrapera na 18001 z
`SCRAPER_ALLOW_PRIVATE=true` i syntetycznego serwera na 18080.
Główny scraper na 8001 zachował domyślną blokadę adresów prywatnych.

## 2. Struktura i komunikacja

```text
Przeglądarka → frontend React/nginx
  /api → backend Express → PostgreSQL
  /socket.io ↔ Socket.io backendu
  backend → BullMQ → Redis → worker backendu
  worker → scraper FastAPI/Playwright → WWW
  worker → analyzer FastAPI → M1 + M2 + M3 → agregacja scoringu
  analyzer → opcjonalna Ollama; domyślnie szablon
  node-cron → źródła + /discover → kolejka
```

- `services/scraper`: HTML, tekst, URL, metadane social, render 3 viewportów.
- `services/analyzer`: TF-IDF + regresja logistyczna, reguły, snapshot KNF,
  scoring noisy-OR; wynik całości to maksimum wyników modułów.
- `services/backend`: REST, transakcje, materiały, analizy/przesłanki, podmioty,
  alerty, harmonogram, źródła i seed.
- `services/frontend`: pulpit, filtry, szczegóły, statusy, alerty, wyszukiwarka,
  podmioty i kalibracja.
- `db/init.sql`: pełna treść i metadane w SQL/JSONB, historia analiz, powiązania,
  kolejka logiczna `scan_jobs`; fizyczna kolejka w Redisie.
- Docker Compose: 6 serwisów podstawowych + opcjonalna Ollama; tylko frontend
  ma publikowany port. PostgreSQL/Redis mają trwałe wolumeny.

### Konfiguracja

- Brak lokalnego `.env` przy rozpoczęciu testów. `.env.example` jest obecny,
  `.env` ignorowany przez Git. Nie wykryto śledzonego `.env`.
- YAML Compose parsuje się, lecz nie wykonano walidacji semantycznej Docker CLI:
  faktyczne `docker compose --env-file .env.example config -q` kończy się
  `CommandNotFoundException`.
- Docker, obrazy, healthchecki kontenerów, nginx i pełny start Compose:
  **niezweryfikowane**, nie „zaliczone”.
- Brak healthchecku backendu; frontend zależy tylko od rozpoczęcia procesu.
- Obrazy `postgres:16-alpine`, `redis:7-alpine`, `nginx:1.27-alpine`,
  `node:22-alpine`, `python:3.12-slim` nie są przypięte digestem.
- `REDIS_URL` traci hasło, użytkownika, TLS i numer bazy:
  dla `rediss://audit:synthetic@localhost:56379/4` konfiguracja zwraca tylko
  `{"host":"localhost","port":56379}`.
- `DEFAULT_THRESHOLD=90` daje w świeżo zainicjalizowanej bazie efektywny próg 45,
  bo SQL zawsze wstawia 45. Zmienna działa wyłącznie jako fallback braku rekordu.
- Zwykła inicjalizacja schematu działa; to skrypt pierwszego uruchomienia,
  nie mechanizm migracji istniejącej bazy.

## 3. Potwierdzone błędy uruchomienia i integracji

### B01 — P0: frontend nie przechodzi `npm ci`

**Odtworzenie:** w `services/frontend` uruchomić `npm ci`.
Sprawdzono również `npm ci --dry-run --ignore-scripts --no-audit` pod Node 22.

**Wynik:** `EUSAGE`, brak w lockfile:
`@emnapi/core@2.0.0-beta.2`, `@emnapi/runtime@2.0.0-beta.2`.

**Skutek:** niepowtarzalna instalacja; etap `RUN npm ci` w Dockerfile
i CI używają dokładnie tej ścieżki. Samego builda Docker nie wykonano.

**Propozycja:** odtworzyć spójny lockfile w docelowym Node/npm, dodać smoke test
pełnego builda Compose. Audyt nie zmienił lockfile.

### B02 — P0: brak sterownika kolejki i pętla błędów

**Odtworzenie:** backend `npm ci`, działająca testowa baza/Redis,
następnie `node src/index.js` bez dodatkowych modułów w `NODE_PATH`.

**Wynik:** `BullMQ could not load the optional 'ioredis' package`.
`npm ls ioredis --all` pokazuje pustą listę. Worker emituje miliony błędów,
żądanie `/api/health` nie odpowiada w 15 s.

**Skutek:** brak responsywnego API, brak przetwarzania, ryzyko wyczerpania dysku/CPU.

**Propozycja:** jawna zależność sterownika zgodnego z BullMQ 6, fail-fast przy
błędzie inicjalizacji, ograniczenie logowania/pętli ponawiania, test gotowości.

### B03 — P0: lista materiałów i większość filtrów zwracają 502

**Odtworzenie w wariancie diagnostycznym:**

```text
GET /api/materials
→ 502 {"error":"bind message supplies 1 parameters, but prepared statement \"\" requires 0"}
GET /api/materials?platform=web
→ 502 {"error":"could not determine data type of parameter $1"}
GET /api/materials?risk=wysokie
→ 200
```

Przyczyna: `services/backend/src/routes/materials.js:24-35` przekazuje próg
jako `$1` również do zapytania `count`, które bez filtra ryzyka go nie używa.

**Skutek:** domyślny ekran wyników i filtrowanie bez wybranego ryzyka nie działają.

**Propozycja:** osobna lista parametrów/liczenie placeholderów dla `count`
albo użycie wspólnego CTE; test wszystkich kombinacji filtrów na PostgreSQL.

### B04 — P1: health fałszywie potwierdza sprawność stosu

**Odtworzenie:** dostępna baza/kolejka, nieuruchomione scraper i analyzer,
`GET /api/health`.

**Wynik:** HTTP 200, `ok:true`, `scraper:null`, `analyzer:null`.

**Propozycja:** oddzielić liveness od readiness; readiness sprawdza wszystkie
usługi krytyczne, worker, kolejkę oraz dostępność renderu; zwraca 503.

### B05 — P1: brak uwierzytelniania i kontroli dostępu

W routingu aplikacji nie ma uwierzytelniania ani ról. Operacje ustawień,
statusów, importu, uruchamiania źródeł i odczytu materiałów nie wymagają tożsamości.
Compose publikuje `${WEB_PORT}:80` bez ograniczenia do loopback.

**Propozycja:** na demo ograniczyć dostęp do hosta/zaufanej sieci, przed realnym
użyciem dodać autoryzację, role, audyt zmian, limity żądań i zasobów.
Nie jest to automatycznie naruszenie konkretnego paragrafu konkursu,
ale istotna wada bezpieczeństwa systemu dla UKNF.

### B06 — P1: WebSocket przyjmuje obcy Origin

**Odtworzenie:** `audit_tests/test_node.mjs`, ostatni test: prawdziwy handshake
WebSocket z `Origin: https://evil-audit.example`.

**Wynik:** połączenie zaakceptowane. `cors: { origin:false }` nie jest kontrolą
pochodzenia handshake WebSocket ani uwierzytelnianiem.

**Skutek:** możliwość subskrypcji zdarzeń z obcej strony, jeżeli host aplikacji
jest osiągalny z przeglądarki.

**Propozycja:** walidacja `Origin`/`allowRequest` i uwierzytelnienie Socket.io.

### B07 — P2: klient REST ukrywa nieprawidłowy JSON przy HTTP 200

**Odtworzenie:** jednostkowy test `test_node.mjs` podaje HTML 200 zamiast JSON.
`services/frontend/src/api.js:9` zwraca `{}` zamiast zgłosić błąd.

**Skutek:** wtórne błędy renderowania i trudna diagnostyka proxy/kontraktu.

**Propozycja:** weryfikować Content-Type/parsowanie i schemat odpowiedzi.

### B08 — P1: zmiana wyglądu reklamy jest pomijana jako duplikat

**Odtworzenie:** `test_backend.py::test_style_only_change_is_not_duplicate`:
dwa importy HTML pod tym samym syntetycznym URL, identyczny tekst,
ale ostrzeżenie najpierw 16 px, potem 6 px.

**Wynik:** drugie zadanie `duplicate`, bez nowego materiału i analizy.
Hash zależy tylko od `content_text`, nie wyglądu.

**Skutek:** monitoring nie zauważy ukrycia ryzyka przez CSS; wynik M2 pozostaje stary.
**Propozycja:** oddzielić deduplikację treści od wersjonowania/renderu wyglądu,
uwzględniać fingerprint istotnych cech wizualnych.

### B09 — P1: import HTML gubi dane podane przez analityka

**Odtworzenie:** `POST /api/scans/upload` z HTML bez metadanych oraz
`author:"@audit_synthetic"`, `title:"Tytuł nadany przy imporcie"`,
`platform:"instagram"`, syntetycznym URL `.example`.

**Wynik:** materiał zapisany, ale `author:null`, `title:null`, `platform:"web"`.
Gałąź HTML w `routes/scans.js:33` przekazuje tylko HTML/URL/etykietę.

**Skutek:** utrata autora/platformy potrzebnych M1 i filtrowaniu.
**Propozycja:** przenieść metadane przez kolejkę/klienta scrapera i ustalić
priorytet wartości ręcznych względem odczytanych z dokumentu.

### B10 — P2: pusty dokument analizowany jako poprawne wejście

**Odtworzenie:** `POST :8002/analyze {"url":"x","content_text":""}`.
**Wynik:** HTTP 200, zamiast walidacji braku treści. URL również nie musi być URL.
**Propozycja:** minimalna niebiała treść i jawny kontrakt typów URL
(z dopuszczeniem osobnego identyfikatora importu, jeśli potrzebny).

### B11 — P1: zagnieżdżone niepoprawne dane powodują 500 bez JSON

**Odtworzenie:**

```json
POST :8002/analyze
{"url":"https://audit.example","content_text":"Reklama. Zysk 10% rocznie.",
 "layout":{"engine":"playwright","viewports":{"desktop":"bad"}}}
```

Także `POST :8002/summary {"result":{}}`.
**Wynik:** HTTP 500, `text/plain`, `Internal Server Error`;
odpowiednio `AttributeError` i `KeyError` w logach.

**Propozycja:** modele Pydantic dla viewportów, bloków, wyniku i przesłanek,
walidacja semantyczna, spójny JSON błędu 4xx.

### B12 — P1: fikcyjne podmioty demo mają oficjalny status `registered`

**Odtworzenie:** `GET :8002/registry/check?name=Dom%20Maklerski%20Vistula%20Capital%20S.A.`.
**Wynik:** `status:"registered"` i `note:null`, choć `match.demo:true`.
`demo_registry.json` ładowany jest zawsze, niezależnie od `SEED_DEMO`.

**Skutek:** logika uprawnień i część UI traktuje fikcję jak wpis KNF.
**Propozycja:** oddzielne statusy/proweniencja, tryb demo i brak użycia wpisów
demo do potwierdzania realnych uprawnień.

### B13 — P1: błędne rozpoznawanie firm i ich domen w M1

**Odtworzenie:** materiał z nazwą demo Vistula i autorem `@audit_synthetic`,
URL `https://evilvistula-capital.example/post`.
**Wynik:** `publisher.type:"firma"`; wynik M1 tylko 17,5.
`endswith(d)` nie sprawdza granicy domeny. Heurystyka fragmentu nazwy w domenie
również nie jest dowodem własności.

Ponadto samo „Dom maklerski oferuje akcje” dopasowuje w istniejącym snapshocie
konkretny podmiot `DOM MAKLERSKI INC S.A.`: normalizacja usuwa `INC` jako formę
prawną i zostawia pospolite określenie.

**Propozycja:** dopasowanie host == domena lub host kończący się `"."+domena`,
zweryfikowane domeny/profil podmiotu, zakaz uznawania nazw generycznych za
identyfikator firmy. Test: `finding-examples.json`, przypadki `m1_*`.

### B14 — P1: M2 nie rozumie negacji i myli słowo z ostrzeżeniem

**Odtworzenie:** `POST /analyze`, tekst w `content_text` i `full_text`:

| Tekst syntetyczny | Niepoprawny wynik |
|---|---|
| „Materiał edukacyjny. Nie obiecujemy gwarantowanego zysku. Nie istnieje zysk bez ryzyka. Możesz stracić cały kapitał.” | `G1:fail`, wynik 86,3 — fałszywie dodatni |
| „To nie jest reklama. Zarabiaj 15% rocznie. Otwórz konto.” | reguła 2 `pass` — negacja uznana za oznaczenie |
| „Reklama. Zysk 12% rocznie. Nasz zespół lubi ryzykować.” | reguła 3 `pass`, wynik 35 — brak rzeczywistego ostrzeżenia pominięty |

**Propozycja:** negacja/cytat/kontekst zdania i klasyfikacja funkcji wypowiedzi,
nie samo występowanie rdzeni; rozszerzyć niezależny zbiór walidacyjny.

### B15 — P1: M3 przypisuje zezwolenie brokera innej firmie doradczej

**Odtworzenie:** `capture_findings.py`, `m3_without_broker` → `m3_with_broker`.
Syntetyczna Aurum Advisory oferuje płatne rekomendacje dopasowane do klienta.
Sama oferta: M3=75, `M3.1:fail`.
Dopisać „Transakcje wykonasz przez Dom Maklerski Vistula Capital S.A.”:
M3=20,9, `M3.1:warn`, tytuł „Doradztwo świadczone przez podmiot z rejestru”.
Po dodaniu `#reklama` wynik **całego materiału** spada do 20,9, poniżej progu 45.

Przyczyna: `authorized = any(...) or bool(reg.find_in_text(...))` sprawdza
dowolną wzmiankę, a nie podmiot świadczący usługę.

**Propozycja:** relacje podmiot–usługa–zezwolenie, a nie autoryzacja dokumentu
przez obecność dowolnej nazwy; zakres zezwolenia i status demo osobno.

### B16 — P1: niepełna analiza widoczności i błędne współrzędne

**Odtworzenie:** `test_visual.py`, dwa testy:
- mobile: `.risk{max-height:1px;overflow:hidden;width:300px}` w media query;
  reguła 8 daje `pass`, mimo pionowego obcięcia ostrzeżenia;
- dwa kolejne bloki z dużymi marginesami: zapisane `y=[2060,1402]`,
  choć drugi leży ponad 1000 px za pierwszym.

Przyczyny: sprawdzany głównie overflow poziomy; skrypt przewija stronę
w trakcie pomiaru bloków, ale używa początkowego `scrollY`.
**Skutek:** pomijanie ukrycia ryzyka i zniekształcona ocena położenia/ekspozycji.
**Propozycja:** mierzyć oba kierunki clippingu, viewporty i aktualne współrzędne,
oddzielić przewijanie do hit-testu od pomiaru geometrycznego.

### B17 — P1: render importowanego HTML nie zasila ekstrakcji treści

**Odtworzenie:** import HTML ze skryptem dodającym
`<p>Syntetyczna treść dynamiczna</p>` w `DOMContentLoaded`, `render:true`.
**Wynik:** render działa, ale zdania brak w `content_text`.
`/scrape/html` wyrzuca `rendered["html"]` i ekstrahuje oryginalne `req.html`.
**Propozycja:** spójny snapshot DOM do pomiarów i ekstrakcji, z zachowaniem
kopii oryginału; nie mieszać treści sprzed renderu z layoutem po renderze.

### B18 — P2: licznik nieprzeczytanych alertów zostaje nieaktualny

**Odtworzenie:** w szczegółach nowego materiału z alertem kliknąć
„Zweryfikowany”. Backend zmienia status alertu i `read=true`.
**Wynik w Chromium:** licznik w bazie spada z 2 do 1; badge nadal pokazuje 2.
`material:status` odświeża widoki, ale nie wywołuje `refreshCounters`,
a backend nie emituje w tej ścieżce `alert:update`.
**Propozycja:** spójny event kontraktu aktualizacji alertów/liczników.

### B19 — P1: błędy źródła 404 maskowane jako poprawne pobranie

**Odtworzenie kontrolowane:** uruchomić `fixture_server.py` (:18080) oraz
osobny scraper :18001 z `SCRAPER_ALLOW_PRIVATE=true`.
`POST /scrape {"url":"http://127.0.0.1:18080/404","render":true}`.
**Wynik:** HTTP 200, materiał „Syntetyczny błąd 404”. Bez renderu: poprawnie 502.
`POST /discover` dla tego samego URL również zwraca 200 i pustą listę.

**Skutek:** strona błędu może wejść do bazy jako reklama; awaria wygląda jak
brak wyników wyszukiwania. Potwierdzono także rozbieżność na publicznym URL.
**Propozycja:** uwzględniać status odpowiedzi `page.goto` i `fetch` w obu ścieżkach,
zachować kod źródła w diagnostyce.

### B20 — P2: ewaluator `--verbose` wywraca się na Windows cp1250

**Odtworzenie:** `python -m tools.evaluate --samples ../../data/samples --threshold 45 --verbose`
w `services/analyzer`, przy standardowym kodowaniu cp1250.
**Wynik:** `UnicodeEncodeError` przy znaku `≥`; przerwanie po drugiej próbce.
Uruchomienie **bez zmiany kodu**, `python -X utf8 -m tools.evaluate ...`,
kończy się poprawnie dla wszystkich 18 próbek.
**Propozycja:** jawne UTF-8 dla CLI/logów i dokumentacja wymagań.

## 4. Testy automatyczne i wyniki

Wyniki w `audit_tests/results/`: pliki JUnit XML, odpowiedzi JSON, przykłady
błędów i zrzuty ekranu. Nie stosowano `xfail`, nie ukrywano porażek.
Powtórne uruchomienie tych samych przypadków nie zwiększa liczby testów.

| Sprawdzenie | Wynik |
|---|---|
| Backend `npm ci --ignore-scripts --no-fund` | instalacja poprawna |
| Backend `npm test` | błąd: brak katalogu `test/` |
| Frontend `npm ci` | błąd B01 |
| Frontend instalacja bez zapisu lockfile + `npm run build` | build działa, bundle JS 835,31 kB / gzip 241,92 kB |
| Backend `npm audit --json` | 0 zgłoszonych podatności |
| Frontend `npm audit --json` | 0 zgłoszonych podatności; nie oznacza poprawności lockfile |
| Audytowe testy Node | 6 PASS / 2 FAIL (B06, B07) |
| Istniejące testy analyzera | 14 PASS |
| HTTP scraper/analyzer + render M2 | 45 PASS / 12 FAIL |
| Backend REST + zapis i kalibracja | 32 PASS / 11 FAIL |
| Pozostałe workflow REST | 8 PASS |
| Chromium frontend (prawdziwe API) | 10 PASS / 2 FAIL |
| Publiczne pobieranie HTML | 3 PASS / 2 FAIL |
| Kontrolowane pobieranie/przekierowania/discover | 6 PASS / 2 FAIL |
| Arytmetyka scoringu, `unittest` i zapis JUnit przez pytest | 6 PASS |
| **Łącznie przypadki w zapisanych zestawach** | **161: 130 PASS / 31 FAIL / 0 SKIP** |
| Pełny `pip-audit -r ... -r ...` | 35 zależności, 0 zgłoszonych podatności |
| `pip check` | brak niespełnionych zależności |
| PostgreSQL 16: schemat + rozszerzenia | poprawne |
| Compose CLI / obrazy | zablokowane brakiem Dockera |

Pierwsza próba instalacji Pythona na dostępnym Python 3.11.9 rzeczywiście
nie powiodła się: `numpy==2.5.5` wymaga Python >=3.12.
To ograniczenie środowiska i brak jasnego minimum w instrukcji lokalnej,
nie dowód błędu obrazu `python:3.12-slim`.

Konsola Chromium w testach Vite nie była czysta: 4 odpowiedzi 502 i 4 komunikaty
`Failed to load resource` dla listy materiałów oraz 12 ostrzeżeń o zamkniętym
handshake WebSocket przy montowaniu/nawigacji w trybie deweloperskim.
Nie odnotowano `pageerror` JavaScript. Log Vite zawierał też `ECONNABORTED`
proxy WebSocket. Nie przypisano tych ostrzeżeń automatycznie do produkcyjnego
nginx, którego nie uruchomiono.

### Co faktycznie działa w wariancie diagnostycznym

- Walidacja podstawowych pól REST i odpowiedzi 400/404, w tym nieprawidłowy JSON.
- Blokada SSRF dla IPv4, IPv6, localhost, sieci prywatnej, adresu metadanych
  i URL z danymi logowania (6 przypadków). Zadanie z SSRF kończy się
  `failed` po 1 próbie, bez zbędnego ponawiania.
- Pobranie publicznego HTML z renderem i bez; kontrolowane przekierowanie;
  discovery wybiera właściwe inwestycyjne linki z tej samej domeny.
- Ekstrakcja tytułu, autora, języka, daty, metadanych social; normalizacja,
  deduplikacja powtarzających się bloków i hash.
- Trzy prawdziwe viewporty + screenshot; detekcja małej czcionki, niskiego
  kontrastu, ostrzeżenia w stopce, zamkniętego details i ukrycia na mobile.
- Typowe przypadki M1, M2 i M3, edukacja, oraz oferta doradztwa maskowana
  samą deklaracją edukacyjną; nie obejmuje to błędów B12–B17.
- Scoring noisy-OR, połowiczna waga `warn`, maksimum modułów, granice
  kategorii, deterministyczność i niezależność wyniku od progu.
- Zapis materiału, wyniku, przesłanek, podmiotów i alertu; historia po ponownej
  analizie; etykiety kalibracji; statusy; odczyty/wyszukiwanie podmiotów;
  obsługa pustych paneli wzbogacania danych.
- Zmiana progu przez API i suwak przeglądarki zmienia decyzje/FP/FN,
  nie zmienia punktacji. Zapis progu aktualizuje rzeczywisty backend.
- Toast wysokiego ryzyka w Chromium po rzeczywistym imporcie.
- Brak wykonania wstrzykniętego SQL w sprawdzonym zapytaniu wyszukiwania.

### Potok 18 próbek: baza i WebSocket

Skrypt `seed_pipeline.mjs` rzeczywiście uruchomił `/api/seed` przez BullMQ.
Wszystkie 18 zadań ukończyło się po jednej próbie. Przybyło:
**18 materiałów, 18 analiz, 406 przesłanek i 11 alertów**.
Klient WebSocket odebrał **18 `material:new` i 11 `alert:new`**.
To test pełnego przepływu w wariancie z dodatkowym sterownikiem i Memurai,
nie test oryginalnego Compose.

### Awaria analyzera i ponawianie

Analyzer audytowy faktycznie zatrzymano, bez atrap HTTP. Nowe zadanie przeszło
3 próby z backoffem, po **15,17 s** otrzymało `failed`, poprawny opis błędu
i `finished_at`; nie zapisano niepełnego materiału.
Health nadal zwracał `ok:true` mimo `analyzer:null` — ponowne potwierdzenie B04.
Po ponownym uruchomieniu analyzera nowy import rzeczywiście zakończył się
zapisem materiału i analizy; gotowość wszystkich usług potwierdzono w
`recovery.json`. Nie naprawiano usług w kodzie.
Pierwsza próba samego skryptu awarii przerwała się na zbyt wąskim
`except ConnectError`; poprawiono wyłącznie harness testowy, po czym test
wykonano od początku. Nie była to poprawka aplikacji.

### Trafność i kalibracja na 18 próbkach demo

| Próg | TP | FP | FN | TN |
|---:|---:|---:|---:|---:|
| 0 | 12 | 6 | 0 | 0 |
| 20 | 12 | 2 | 0 | 4 |
| 45 | 11 | 0 | 1 | 6 |
| 60 | 7 | 0 | 5 | 6 |
| 80 | 6 | 0 | 6 | 6 |
| 100 | 0 | 0 | 12 | 6 |

Przy 45: precision **1,00**, recall **0,9167**, F1 **0,9565**, accuracy **17/18**.
Jedyny FN: `12_ike_podatek.html`, wynik 40, reguła 16 `fail`, ale bez alertu.
Obniżenie progu do 40/20 wyłapuje IKE, lecz oznacza też dwa poprawnie oznaczone
materiały finfluencerów (wynik M1=40) jako wysokie ryzyko.
To wskazuje na potrzebę rozdzielenia faktu monitorowania współpracy od
ryzyka nieprawidłowości i kalibracji wag, nie na błąd arytmetyki progu.

Te 18 przykładów to mały, autorski zbiór demo. Wyniki nie są miarodajnym
oszacowaniem jakości na rzeczywistym ruchu UKNF ani dowodem pełności reguł.

## 5. Bezpieczeństwo i łańcuch dostaw

- Audyty npm faktycznie wykonano; wynik 0 znanych podatności nie jest dowodem
  braku błędów logiki i autoryzacji.
- CI wywołuje `pip-audit`, ale `requirements-dev.txt` zawiera tylko
  `-r requirements.txt` i `pytest`; brak instalacji `pip-audit` w jobie.
  Świeże CI nie ma gwarantowanego narzędzia do obowiązkowego skanu.
- Python Dockerfile nie wykonują `pip-audit`, mimo szerszej deklaracji README
  o blokowaniu obrazów przy podatnościach.
- Bezpieczeństwa obrazów systemowych nie skanowano — brak Dockera.
- `scraper/app/net.py` waliduje adresy prywatne i przekierowania HTTP.
  Pozostaje ryzyko DNS rebinding/TOCTOU: adres sprawdzony przez resolver
  nie jest przypinany do połączenia. To uwaga z przeglądu, nie udowodniony exploit.
- Limit `MAX_BYTES` w `fetch` sprawdzany jest dopiero po pobraniu całej odpowiedzi;
  Playwright nie ma odpowiadającego mu limitu zasobów strony.
  Nie wykonywano destrukcyjnego testu wyczerpania pamięci.
- Chromium uruchamiany z `--no-sandbox`; dla obcego HTML potrzebna silna izolacja
  procesów/kontenerów i ruchu wychodzącego.
- Brak globalnej polityki retencji, usuwania/anonymizacji danych i rejestru
  operacji analityków. Nie jest to pełny audyt RODO.

### Licencja Redis — konkretna rozbieżność z wytyczną open source

Odczytano manifest i konfigurację obrazu przez Docker Registry HTTP API,
bez uruchamiania kontenera. W chwili audytu `redis:7-alpine` dla linux/amd64
ma `REDIS_VERSION=7.4.12`, manifest:
`sha256:e4ee3e03ce8f75471f40937a7c6b2b0e500390b6812fcdf5cb32c01295ded446`.
Plik https://raw.githubusercontent.com/redis/redis/7.4.12/LICENSE.txt
potwierdza wybór **RSALv2 lub SSPLv1**, a nie licencję OSI-approved.

Przy ścisłym rozumieniu wymagania „Stos Open Source” ten wybór **nie spełnia
wytycznej wyłącznie otwartych baz/bibliotek**. Nie oznacza to samo w sobie
nielegalności użycia on-premise. Propozycja: wybrać utrzymywane rozwiązanie
na odpowiedniej otwartej licencji, potwierdzić kompatybilność BullMQ i uzgodnić
interpretację z mentorami. Nie zmieniano obrazu ani Compose.

Model Gemma także wymaga osobnej weryfikacji warunków modelu i redystrybucji;
„darmowy model” z treści zadania nie jest równoznaczny z licencją kodu OSI.

## 6. Zgodność z treścią zadania UKNF

Źródło: lokalny `UKNF - Pełna treść zadania konkursowego.pdf`, 5 stron.
„Częściowo” nie oznacza zaliczenia wymagania działającego MVP.

| Wymaganie | Ocena na podstawie repozytorium i testów |
|---|---|
| Modułowy backend, frontend, silnik Python | zgodna architektura |
| Kolejka open source, harmonogram, Playwright, JSON | implementacja obecna; oryginalny start kolejki blokuje B02 |
| Baza metadanych i treści SQL | schemat uruchomiony na PostgreSQL 16 |
| Social Media: Facebook/Instagram/TikTok | parser publicznych metadanych i ręczny import; brak pełnych kolektorów/API/wideo; skuteczności na realnych platformach nie potwierdzono |
| Rotacja User-Agent i proxy | implementacja obecna; rzeczywiste proxy i rotacja wyjściowych IP niezweryfikowane |
| M1: firma–reklamujący–treść–URL, okresowa aktualizacja | częściowo: potok działa, ale błędy metadanych/identyfikacji B09, B12–B13 |
| M2: proporcja i wyrazistość ryzyka, model statystyczny | częściowo: typowe reguły działają, ale B08, B14, B16–B17; brak tabeli załącznika do pełnego porównania |
| M3: oferta doradztwa i zezwolenie | częściowo: poprawne typowe przykłady, istotne błędne powiązanie uprawnień B15 |
| Normalizacja/tokeny/wektory | TF-IDF jest reprezentacją wektorową; semantyczne embeddingi niezaimplementowane |
| Silnik inferencji Ollama/vLLM/llama.cpp | Ollama opcjonalna i domyślnie wyłączona; realnego modelu nie uruchomiono |
| Agregacja M1–M3, scoring | implementacja i niezależne testy arytmetyki |
| Dashboard i filtry | ekran działa w Chromium; domyślna lista/większość filtrów blokowana B03 |
| Trendy Recharts i propsy React | ekran/wykresy renderują się; użyte propsy |
| Zmiana statusów i WebSocket | rzeczywisty przepływ i toast działają; licznik B18 i bezpieczeństwo B06 |
| Kalibracja threshold i FP/FN | przetestowana przez REST i Chromium; brak niezależnego zbioru walidacyjnego poza demo |
| Jednokomendowy start on-premise Compose | **niepotwierdzony; znane blokery instalacji/startu** |
| Brak płatnych API | nie znaleziono płatnego API w ścieżce inferencji |
| Wyłącznie open source | **rozbieżność: aktualny `redis:7-alpine` to Redis 7.4.12, RSALv2/SSPLv1**; model wymaga osobnej oceny |
| Skanowanie npm/pip i sekrety `.env` | oba skany wykonane, 0 znanych podatności; CI pip ma lukę instalacji narzędzia; `.env` ignorowany |
| Minimalne README: quick start, sprzęt, konfiguracja | obecne; instrukcja lokalna nie podaje Python >=3.12 |
| Tytuł i opis kodu/repozytorium | obecne |
| Szczegółowy opis projektu | README/architektura są, ale osobny opis do zgłoszenia niegotowy (`TODO.md:42`) |
| **Prezentacja PDF** | **brak w repozytorium**; oba obecne PDF są dokumentami organizatora, nie prezentacją projektu |
| Film ≤3 min | brak, ale jest opcjonalny |

**Ważne:** dokument zadania odwołuje się do listy wymogów w załączniku,
lecz w dostarczonych dwóch PDF nie ma tabeli 18 wymagań dla reklam.
Nie można potwierdzić zgodności każdej reguły z tym załącznikiem.
Należy uzyskać go od mentorów i przygotować mapę wymaganie → reguła → test.

## 7. Zgodność z regulaminami — co można, a czego nie można potwierdzić

Sprawdzono:

1. lokalny `UKNF - Regulamin Zadania Konkursowego.pdf` (22 strony),
2. dodatkowo regulamin ogólny HackNation podlinkowany na stronie organizatora,
   pobrany 21.11.2026:
   https://hacknation.pl/api/public/dokumenty/28c74284-6390-4665-b8aa-bf4367db79c0/regulamin-hacknation_19.11.pdf

To weryfikacja dokumentów i technicznych dowodów, nie opinia prawna
ani potwierdzenie skutecznego zgłoszenia.

| Podstawa | Wniosek |
|---|---|
| UKNF §2, §4 ust.1–3 i 8: 21.11 godz.11:00–22.11 godz.11:00, maks.24 h, przekazanie w terminie | dwa widoczne commity po rozpoczęciu konkursu; to nie dowodzi czasu powstania całości kodu ani wysłania zgłoszenia |
| UKNF §3, §4 ust.4 i 6: pełnoletność, zdolność prawna, zgłoszenie/oświadczenia, stacjonarność, ≤6 osób | brak danych do weryfikacji; trzeba potwierdzić organizacyjnie, nie publikować danych osobowych w repo |
| UKNF §5 ust.9: brak dostępu do zadania przed startem | historia repo nie pozwala potwierdzić ani wykluczyć; brak podstaw do zarzutu naruszenia |
| UKNF §5 ust.4: demo30%, procesAI20%, architektura20%, zgodność20%, atrakcyjność10% | dokument procesu AI obecny, lecz blokery demo mają duży wpływ; nie przyznaję pozornej punktacji jury |
| UKNF §7 i zał.3 §2 ust.13: kod źródłowy, narzędzia, biblioteki, możliwość odtworzenia | źródła i manifesty są; B01/B02 ograniczają odtwarzalność; brak kompletnego zestawienia licencji/SBOM |
| UKNF zał.3 §5: prawa do wkładu i wyodrębnienie cudzych elementów | brak dowodu pełni praw, zgód autorów i licencji danych/modelu; wymaga potwierdzenia przez zespół/prawnika |
| Regulamin ogólny pkt5 ust.6: kwalifikacja, pitch ≤5 min + pytania ≤5 min | przygotować scenariusz demo mieszczący się w limicie |
| Regulamin ogólny pkt5 ust.9: bez zmian po terminie | przed zgłoszeniem zamrozić właściwy commit/tag i zachować dowód wysłania |
| UKNF §10 ust.5: pierwszeństwo umowy UKNF, potem regulamin UKNF, potem ogólny | w razie rozbieżności konsultować z organizatorem; nie zakładać ogólnej swobody licencyjnej |

Nie znaleziono w przeczytanych regulaminach zakazu stosowania asystentów AI;
treść zadania wręcz ocenia opis takiego procesu. Nie zastępuje to obowiązku
weryfikacji wygenerowanego kodu i praw do wkładu.
`docs/AI_WORKFLOW.md` opisuje proces, ale dwa commity nie dowodzą faktycznego
stosowania review/PR i niezależnej ewaluacji przy każdej zmianie.

**Ocena końcowa zgodności formalnej na ten moment: niepotwierdzona, nie „w pełni zgodna”.**
Brak prezentacji w repo to konkretny brak pakietu do zgłoszenia, nie dowód,
że nie istnieje ona poza repozytorium. Rejestracji, zgód i spełnienia warunków
osobowych nie da się sprawdzić testami oprogramowania.

## 8. Ograniczenia audytu

- Nie wykonano Docker Compose ani testów nginx/kontenerów, bo Docker nie istnieje.
- Memurai jest zamiennikiem testowym, nie rzeczywistym obrazem Redis 7.
- Brak dowodu skuteczności na realnych social mediach, OCR/transkrypcji,
  uwierzytelnionych źródłach i produkcyjnych proxy.
- Nie trenowano/nie oceniano na danych UKNF z pendrive; takich danych nie dostarczono.
- Nie uruchomiono Ollamy/modelu i nie potwierdzono jakości jego generacji.
- Ochrona podsumowań LLM jest niepełna w przeglądzie statycznym:
  kod wymaga jednego cytowania, nie cytowania każdego zdania ani istnienia
  cytowanych reguł. Nie wykonywano generacji prawdziwym modelem.
- Brak testu obciążeniowego, długotrwałości, awarii hosta, odtwarzania kopii
  i pełnego pentestu. Nie wykonywano destrukcyjnych ataków DoS.
- Nie dokonywano automatycznej oceny prawnej konkretnych reklam/podmiotów.

## 9. Co poprawić przed prezentacją — kolejność

1. **P0:** spójny lockfile frontendu, brakujący sterownik kolejki/fail-fast,
   błąd parametrów zapytań listy materiałów.
2. **P0 organizacyjne:** przygotować prezentację PDF, szczegółowy opis,
   sprawdzić pakiet i termin zgłoszenia oraz dostęp jury do repo.
3. **P1:** test pełnego stosu na Dockerze od czystych obrazów, gotowość usług,
   end-to-end import → analiza → zapis → alert → ekran wyników.
4. **P1:** bezpieczeństwo dostępu i WebSocketów, oddzielenie danych demo
   od stwierdzeń o prawdziwych uprawnieniach, powiązanie zezwolenia z właściwym
   doradcą (B15), wykrywanie zmian CSS i ukrywania ostrzeżeń.
5. Potwierdzić z mentorami zakres wymagań social media, embeddingów,
   inferencji i brakującego załącznika reguł M2.
6. Zamknąć walidację, błędy ML/heurystyk i renderu wykazane w wynikach audytu,
   powtórzyć ewaluację na niezależnych danych.
7. Zainstalować `pip-audit` w CI, dołączyć wykaz licencji i wersji obrazów/modelu,
   skrócić bundle przez code splitting.

Nie wdrożono żadnej z tych propozycji w aplikacji.

## 10. Stan po audycie

- `git diff --exit-code` potwierdził brak zmian śledzonych plików aplikacji.
- Dodane pliki: `audit_tests/` i ten raport. PDF użytkownika pozostawiono bez zmian.
- Przed zamknięciem: 25 materiałów testowych, 26 analiz, 586 przesłanek,
  15 alertów, 10 podmiotów; **0 materiałów bez analizy**, 0 aktywnych/czekających
  zadań. Dwa zadania `failed` to zamierzone SSRF i awaria analyzera.
- Zatrzymano wyłącznie audytowe serwisy HTTP, PostgreSQL i Memurai.
  Usługi nie pozostają dostępne po zakończeniu audytu.
- Zachowano bazę PostgreSQL w
  `C:\Users\jkacz\AppData\Local\Temp\opencode\investwatch-audit-node\pgdata-audit`
  oraz zapisano końcowy snapshot kolejki Memurai (`dump.rdb`) w katalogu
  `investwatch-audit-node`. Nie wykonywano `DROP`, `TRUNCATE`, `FLUSH`
  ani usuwania istniejących danych użytkownika.
- Wyniki: `audit_tests/results/summary.json`, pliki XML/JSON i PNG.
  Narzędzia audytowe/interpretery pozostały w katalogu tymczasowym;
  ich obecność nie naprawia czystej instalacji repozytorium.
