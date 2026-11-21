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
- [x] `docker compose up --build` na Windows (Docker 29.9, WSL2): wszystkie healthchecki zielone, Valkey + BullMQ, Chromium w kontenerze, seed 18 próbek, kalibracja 11/0/1/6, backend `npm test` 12/12 przez nginx, WebSocket i toasty, konsola bez błędów, wzbogacanie z kontenera; ~400 MB RAM całego stosu
- [x] Poprawka: nginx przekazuje `Host` z portem (`$http_host`) – bez tego kontrola Origin odrzucała WebSocket
- [ ] Test Compose na macOS (Apple Silicon) – obrazy mają wariant arm64, uruchomienia nie wykonano
- [x] Błędy audytu B01–B20 poprawione (B05 częściowo: rola administratora) – [stan po poprawkach](docs/AUDIT_REPORT.md#11-stan-po-poprawkach-21112026-po-audycie)
- [x] Ponowne testy audytowe: Node 8/8, HTTP+wizualne+scoring 63/63, backend+workflow+kontrolowane 59/59, Chromium 12/12 (0 zdarzeń konsoli), publiczne 5/5
- [x] Silne `ADMIN_PASSWORD` (24 znaki, losowe) ustawione w lokalnym `.env` – [ ] przekazać zespołowi bezpiecznym kanałem (nie commitować)
- [ ] (!) Na hackathonie: wczytać próbki od UKNF (pendrive) przez „Import wielu plików” (HTML, tekst, JSON, CSV z URL, **obrazy przez OCR**), oznaczyć je i przeliczyć kalibrację
- [x] Konsola bez ostrzeżeń WebSocket (jedno połączenie Socket.io na aplikację)
- [x] Import obrazów reklam (OCR: Tesseract pol+eng w kontenerze scrapera) – PNG/JPG/WebP do 10 MB; tekst z pozycją, wysokością liter i kontrastem, więc reguły 4–6 działają na obrazach; 2. przebieg OCR wyłapuje blady drobny druk; próbka demo nr 19
- [ ] OCR lokalnie na Windows (dev) – dziś tylko w Dockerze; lokalnie obraz kończy się czytelnym błędem 501 (transkrypcja Whisper działa lokalnie)
- [x] OCR grafik na stronach: największe banery/obrazy (img, canvas, tło CSS; do 6 na stronę) przechodzą OCR – tekst „wtopiony” w baner trafia do reguł z położeniem i rozmiarem liter w px renderu
- [x] Bezpośredni link do grafiki/zdjęcia (`.png/.jpg/.webp…` albo `Content-Type: image/*`) w „Analiza adresów URL” → OCR
- [x] Przycisk „Usuń” na karcie materiału (z potwierdzeniem; operacja administratora)

## Wideo / reels (Whisper + OCR klatek)
- [x] Scraper `app/video.py`: yt-dlp 2026.10.26 (bez logowania; opcjonalnie `SCRAPER_COOKIES_FILE`) → faster-whisper 1.2.1 (`WHISPER_MODEL=small`, CPU int8, wykrywanie języka, VAD) → klatki co ~T/24 s (PyAV) z pominięciem identycznych → OCR (Tesseract, 2 przebiegi) → te same reguły M1–M3
- [x] Platformy: TikTok, Instagram (reels/posty), YouTube (filmy, Shorts), Facebook (watch/reels/fb.watch), X/Twitter, Threads, LinkedIn, Vimeo, Twitch, Reddit, Dailymotion, Rumble, Kick, VK, Pinterest, Bilibili, Streamable, Telegram + bezpośrednie `.mp4/.webm/.mov`
- [x] Sprawdzone w Dockerze: YouTube (tytuł, autor, data, wyświetlenia, transkrypcja), TikTok (opis + metadane); Vimeo i część Instagrama/Facebooka wymagają logowania → czytelny błąd 422 „wgraj plik ręcznie”
- [x] Upload pliku wideo (do 250 MB): „Import wielu plików” lub `POST /api/scans/video` (surowa treść, metadane w query); nginx 260 MB tylko dla tej ścieżki
- [x] Reguły wideo: ostrzeżenie na ekranie krócej niż 3 s → reguła 5; ostrzeżenie tylko w mowie (brak napisu) → reguła 6 (ostrzeżenie); „dolna krawędź kadru” w regule 6; 7 = nie dotyczy, 8 = nieocenione
- [x] Karta materiału: transkrypcja z czasami, napisy z ekranu z czasem widoczności, plansza klatek z podświetleniami, metadane (wyświetlenia, obserwujący)
- [x] Próbka demo nr 20 (`tools/make_sample_video.ps1`: syntezator pl-PL + napisy; ostrzeżenie drobnym drukiem przez ~1,5 s) – wynik 98: reguły 4/5/6 i G1 naruszone
- [x] Docker: ffmpeg + Deno (yt-dlp/YouTube) w obrazie scrapera, model Whisper w wolumenie `whisper` (ładowany w tle przy starcie, `WHISPER_PRELOAD`)
- [ ] Mowa z wielu głosów / muzyka: ewentualnie `WHISPER_MODEL=medium` na mocniejszym sprzęcie (small ≈ 6 s na 11 s nagrania na CPU)
- [ ] Relacje (stories) i transmisje na żywo – pomijane (limit `VIDEO_MAX_SECONDS=900`, `!is_live`)
- [ ] Napisy wypalone w wideo w ruchu (scrolling) – OCR klatek co ~1,5 s może je pominąć

## Oszustwa, finfluencerzy i monitoring popularnych treści
- [x] Profil publikującego (`analyzer/app/profile.py`) dla stron, postów i wideo (Whisper + OCR): **podejrzenie oszustwa / płatna promocja / doradca / edukacja / informacja** + tagi (współpraca oznaczona, afiliacja bez oznaczenia, nierealistyczne obietnice)
- [x] Realizm obietnic zysku: „2% dziennie”, „trzydzieści procent miesięcznie” (liczebniki z transkrypcji), „x10 w rok”, „podwoisz” → skala roczna; ≥ 50%/rok = M1.9 naruszenie, 20–50% = ostrzeżenie; ostrzeżenia CFD („74% rachunków traci”), prowizje, podatki nie są liczone jako obietnice
- [x] Sygnały oszustwa (M1.10, PL+EN): presja czasu, kontakt na WhatsApp/Telegram, wpłata na prywatny portfel/BLIK, piramida, wizerunek znanych osób, „odzyskamy środki”, „zacznij od 250 zł”, bot AI „zarabia za Ciebie”, „bez wiedzy”, lista ostrzeżeń KNF/ESMA
- [x] M3.5: doradca z nierealistycznymi obietnicami
- [x] Monitoring wideo (strona „Monitoring wideo”): chmura popularnych tagów (z bazy + zestaw finansowy), wyszukiwanie kandydatów (YouTube: hashtag, fraza sortowana po wyświetleniach, kanał; TikTok: profil) z progiem wyświetleń – najpierw same metadane, transkrypcja i OCR tylko dla treści powyżej progu; „Monitoruj stale” = zapisane zapytania uruchamiane wg `WATCH_CRON`
- [x] Wyniki: filtry typ publikującego, rodzaj (wideo/obraz/strona), zasięg (≥ 1 tys. … ≥ 1 mln), tag, „tylko powyżej progu”; sortowanie po zasięgu i priorytecie (ryzyko × log zasięgu)
- [x] Skalowalność: osobny tor kolejki dla wideo (`VIDEO_WORKER_CONCURRENCY`), priorytet wg wyświetleń, pomijanie filmów przeanalizowanych w ostatnich 7 dniach przed pobraniem, indeksy (zasięg, tagi GIN, profil, URL); skalowanie poziome: `docker compose up -d --scale scraper=N`
- [ ] TikTok: tagi i wyszukiwarka wymagają zalogowania (API aplikacji) – dziś monitoring profili; Instagram/Facebook – plik cookies analityka (`SCRAPER_COOKIES_FILE`)
- [ ] Rejestr licencjonowanych doradców inwestycyjnych KNF – dziś licencja „zadeklarowana, do weryfikacji” (numer wyciągany z treści)

## Poprawki po testach zespołu (21.11.2026)
- [x] „render: none”: Playwright działa w Dockerze i dev (XTB: 3 viewporty, ~520 bloków); dodano: ponowne uruchomienie Chromium po awarii, drugą, lżejszą próbę renderu przy timeoucie, przyczynę na karcie materiału, baner „Ograniczona analiza” przy braku Chromium/OCR/Whispera, `playwright install chromium` w `restart.ps1`
- [x] Nakładki cookies (CMP, także rozpoznane po treści) i puste przezroczyste warstwy (np. HubSpot) ukrywane przed pomiarem – reguła 5 nie zgłasza już „przesłonięcia” na stronie XTB; przyklejony pasek z ostrzeżeniem u góry nie jest „stopką”
- [x] M1: oficjalna strona firmy (domena = nazwa firmy, np. xtb.com ↔ XTB S.A.; domeny z dopiskami się nie liczą) i strona własna usługodawcy nie są „podmiotem trzecim”; program partnerski na stronie firmy nie jest ukrytą reklamą. XTB: M1 86 → 0
- [x] Sankcje UE: aliasy będące przetłumaczoną formą prawną („otwarta” spółka akcyjna) nie dopasowują się do zwykłych słów
- [x] M3: zadeklarowana licencja doradcy / status agenta firmy inwestycyjnej → „do weryfikacji” (waga 10) zamiast „shadow advisory” 75; planowanie finansowe (budżet, cele, emerytura) bez rekomendacji instrumentów ≠ doradztwo inwestycyjne
- [x] Reguła 3: ostrzeżenie obecne, ale nie przy twierdzeniach o zyskach → „do weryfikacji” z cytatem i miejscem (ekspozycję ocenia reguła 6), nie „niespełnione”
- [x] Reguła 17: zaprzeczenia („KNF nie zatwierdza”) nie są aprobatą; uprawnienia KNF jako argument kompetencji → ostrzeżenie z tym cytatem (spójne uzasadnienie i dowód)
- [x] UI: poziom ryzyka w stałej skali 0–29/30–69/70–100 (89 = wysokie), próg alertów osobno („powyżej progu”); przyciski statusu jako akcje z zaznaczonym bieżącym statusem
- [x] Sprawdzone w przeglądarce: próg 45 → 80 – lista „tylko powyżej progu” 18 → 11 bez odświeżania; alert z drugiego klienta – toast i nowy wiersz na liście alertów na żywo; blog „Jak zainwestować 100 tysięcy” – M3 = 75 (art. 76)
- [x] Próbki 21–23 (licencjonowany doradca – brak alarmu, scam z botem AI, blog z płatnymi konsultacjami); kalibracja 22 próbek: TP 14, FP 0, FN 1, TN 7 (precyzja 1,00, pełność 0,93)

## Should
- [x] Adapter KRS (api-krs.ms.gov.pl, bez klucza; limitów nie publikuje – bufor 6 h, kolejka 1 podmiot/2 s): kapitał, adres, NIP/REGON, zarząd, prokurenci, wspólnicy → `persons`, `person_links`. **Dane osób zanonimizowane w publicznym API** – brak łączenia osób między spółkami
- [x] Adapter GLEIF (LEI) – wyszukiwanie po nazwie lub LEI, oznaczenie dokładnego dopasowania
- [x] Lista ostrzeżeń publicznych KNF (669 wpisów, domeny/KRS/NIP) – przesłanki M1.5 i M3.4
- [x] Rejestr MiCA ESMA: 409 CASP + 217 podmiotów niezgodnych – przesłanki M1.6 (bez licencji) i M1.7 (licencja CASP / brak w rejestrze)
- [x] KRS bez znajomości numeru: nazwa → GLEIF (urząd RA000484) → numer KRS → odpis; dopasowanie rekordu LEI z uwzględnieniem kraju z formy prawnej
- [x] Wszystkie dane z rejestrów: odpis KRS aktualny (6 działów) i pełny z historią, rekord LEI z relacjami (dominujący bezpośredni/najwyższy, zależne), drzewo danych z filtrem
- [x] Jedna wyszukiwarka „Wyszukiwarka (KRS, LEI)”: rozpoznaje numer KRS (10 cyfr), LEI (20 znaków) lub nazwę; zakładki podmioty/materiały/rejestr KNF/rejestry zewnętrzne; panel szczegółów z odpisem KRS i rekordem LEI; „Utwórz kartę podmiotu i monitoruj”
- [x] Ciemny motyw (Auto/Jasny/Ciemny, zapamiętany) i ujednolicone wykresy (paleta sprawdzona dla obu motywów, legendy, gradienty, ciągła oś 30 dni)
- [x] Rejestr KNF: skróty 3-literowe (np. XTB) dopasowywane jako nazwa własna wielkimi literami; krótkie nazwy jednowyrazowe tylko z wielkiej litery
- [ ] Ostrzeżenia zagranicznych organów nadzoru (strona KNF) i IOSCO I-SCAN jako kolejne listy
- [ ] Harmonogram odświeżania snapshotów list (dziś: `python -m tools.watchlists_import`)
- [ ] Graf powiązań osób – wymaga źródła z niezamaskowanymi danymi (np. dostęp instytucjonalny do KRS)
- [ ] Rozszerzenie zbioru treningowego klasyfikatora (`app/data/sentences.tsv`) albo fine-tune HerBERT
- [ ] Embeddingi (Ollama `nomic-embed-text`) do grupowania podobnych reklam

## Could
- [x] Zachowanie w kryzysach (GPW): archiwum notowań gpw.pl (akcje + WIG, bufor dni na dysku; stooq pominięty – blokada dla botów); okresy „Krach COVID-19” (II–VII 2020) i „Inwazja Rosji na Ukrainę” (II–VI 2022); metryki: maks. spadek od szczytu przed dnem WIG, spadek wobec WIG, dni do odrobienia strat, beta, zmienność, najgorsze sesje; wykres spółka vs WIG na karcie podmiotu. Sprawdzone: PKO BP −40,9% (WIG −36,0%), XTB −16,4% i odrobione w 12 dni
- [ ] Kryzysy: kursy bez korekty o dywidendy/splity; pierwsze pobranie okresu ~4 min (~230 żądań z odstępem) – potem natychmiast z bufora
- [x] Proof of Reserves (OKX): parser raportu (pokrycie per aktywo), zapis w `reserves_reports`, odczyt przy starcie i codziennie (`RESERVES_CRON`), alerty: pokrycie < 1:1, brak nowego raportu > 45 dni, nowy raport (informacja); strona „Rezerwy giełd (PoR)” z wykresem pokrycia i historią; alerty bez materiału na liście alertów. Sprawdzone: raport z 31.10.2026, min. pokrycie 100,02%
- [x] Wideo/reels: yt-dlp → faster-whisper → OCR klatek → te same reguły (sekcja „Wideo / reels”)
- [x] Lista sankcji UE (6303 wpisy, osoby i podmioty) – przesłanka M1.8 zawsze „wymaga weryfikacji”, nigdy naruszenie; panel na karcie podmiotu

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

## Bezpieczeństwo (po audycie)
- [ ] Pełne uwierzytelnianie i role analityków (dziś: tylko rola administratora dla konfiguracji)
- [ ] DNS rebinding w scraperze (przypięcie zweryfikowanego IP do połączenia) i izolacja Chromium bez `--no-sandbox`
- [ ] Polityka retencji danych, rejestr operacji analityków, SBOM z licencjami obrazów i modelu
- [ ] `pip-audit` w obrazach Python (dziś tylko w CI)
