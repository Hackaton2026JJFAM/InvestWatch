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
- [x] Hashtag (#) i fraza na **YouTube, TikToku, Instagramie, X i Facebooku**: YouTube natywnie (region PL: `hl=pl&gl=PL`), pozostałe przez publiczny indeks wyszukiwarki (DuckDuckGo HTML, region PL, `"#tag" site:platforma`) – strony tagów platform wymagają logowania; zasięg i autor dociągane z metadanych posta (yt-dlp) i oEmbed (X, TikTok); profile twórców: YouTube i TikTok
- [x] Polskie treści: rozpoznawanie języka kandydatów i materiałów, przełącznik „tylko polskie” w monitoringu (domyślnie), filtr „Język” w wynikach
- [x] Frazy-przynęty oszustów PL („darmowa kasa”, „szybki zarobek”, „zarabiaj 1000 zł dziennie”, „gwarantowany zysk”, „bot inwestycyjny zarabia”, „zacznij od 250 zł”, …) – klikalne wyszukiwanie i pakiety „Monitoruj stale” jednym kliknięciem na wybranych platformach; polskie hashtagi finansowe (#darmowakasa, #pasywnydochod, #szybkizarobek, #kryptopolska, …)
- [x] Posty bez wideo (np. wpis na X) analizowane jako tekst (oEmbed) zamiast błędu „No video”
- [ ] Wyszukiwarka ogranicza częste zapytania (odpowiedź 202) – zapytania co ≥ 6 s, bufor 30 min, przy ograniczeniu czytelny komunikat i ponowienie w kolejnym przebiegu; przy dużej liczbie zapytań w monitoringu rozważyć oficjalne API wyszukiwania (np. Brave Search API, klucz) lub plik cookies analityka
- [ ] Instagram: zasięg (wyświetlenia) bez logowania niedostępny – tylko polubienia/opis; Facebook: metadane ograniczone
- [ ] Rejestr licencjonowanych doradców inwestycyjnych KNF – dziś licencja „zadeklarowana, do weryfikacji” (numer wyciągany z treści)

## Historia konta (22.11.2026)
- [x] Klucz konta publikującego (platforma + profil/kanał z adresu lub metadanych, dla stron – domena), uzupełniony dla istniejących materiałów
- [x] Konto z historią naruszeń (≥ 2 wcześniejsze materiały z wynikiem klasyfikatora ≥ 70 albo ≥ 1 podejrzenie oszustwa): nowy materiał dostaje punkt M1.11 „Konto z historią naruszeń” (do sprawdzenia, waga 20–50 wg liczby naruszeń) i tag profilu; statystyki z wyniku klasyfikatora (oznaczenie nie napędza samo siebie); analityk może M1.11 odznaczyć
- [x] UI: plakietka „⚠ konto z historią naruszeń” w nagłówku materiału, panel „Historia konta” (inne materiały, wysokie ryzyko, podejrzenia oszustwa, średni wynik), w wynikach „+N tego konta” i filtr „tylko konta z historią naruszeń”
- [x] Konsola: 404 dla usuniętego materiału – czytelny komunikat; blokada czcionki „Architects Daughter” przez CSP pochodzi z rozszerzenia przeglądarki (nie z aplikacji) – CSP działa poprawnie

## Wykluczenia i sprawdzeni doradcy (22.11.2026)
- [x] Filtr wykluczeń w wyszukiwaniu kandydatów: stała lista słów (domyślnie gry: gta, gta5, roblox, fortnite, minecraft…; edycja w Monitoringu) + dodatkowe słowa dla pojedynczego wyszukiwania; dopasowanie w tytule/opisie/autorze/tagach, także początek słowa (gta5 → gta5rp); wykluczone nie trafiają do analizy ani do stałego monitoringu, w wynikach ukryte z licznikiem i opcją „pokaż”
- [x] Wykluczenia także po pobraniu: zadania z monitoringu/wyszukiwania sprawdzane po tytule z wyszukiwania (przed pobraniem) i po pełnym tytule, opisie i tagach pobranego materiału – status „wykluczone”, bez analizy i alertu; sprzątanie już pobranych (`/api/materials-excluded`, przycisk w panelu wykluczeń); usunięte 8 materiałów z gier (GTA Online, Fortnite, Roblox, Minecraft) wciągniętych przez frazę „darmowa kasa”
- [x] Ranking hashtagów bez gier: materiały i tagi z wykluczonymi słowami nie zasilają rankingu ani automatycznego monitoringu (wcześniej materiały z GTA wypromowały tagi gtav, dlc, bunkier… i monitoring wciągał kolejne gry); „Sprawdź teraz” uruchamia przebieg w tle (wcześniej 504 po 60 s proxy)
- [x] Sprawdzeni doradcy: analityk oznacza publikującego (konto, domena lub nr licencji) jako sprawdzonego w rejestrze KNF → przesłanki o braku/niepotwierdzonych uprawnieniach (M3.1–M3.3) nie liczą się, także dla przyszłych materiałów; M3.4 (lista ostrzeżeń) i M3.5 (nierealne obietnice) nadal się liczą; cofnięcie przelicza materiały ponownie

## Stabilność scrapera (22.11.2026)
- [x] „Scraper nie odpowiada” przy transkrypcji: health scrapera z czasem 10 s (`SCRAPER_HEALTH_TIMEOUT_MS`), przekroczony czas przy wcześniej działającym scraperze = stan „zajęty” (informacja, nie błąd); healthcheck kontenera backendu na `/api/live`; zmierzone pod obciążeniem (transkrypcja 25-min filmu): health ≤ 40 ms, zawsze „up”
- [x] Whisper ograniczony do połowy rdzeni (`WHISPER_THREADS`), druga próba po polsku tylko dla klipów ≤ 90 s; wyłącznik `VIDEO_TRANSCRIBE=false`
- [x] Blokady platform: wyszukiwanie zwraca 200 z informacją o blokadzie zamiast 502 (ostrzeżenie w logu, nie błąd); film zablokowany przez platformę (403 / blokada IP / region) – czytelny komunikat „wgraj plik”, bez ponawiania; YouTube: brak strony hashtagu → wyszukiwanie „#tag”
- [ ] `--workers` w uvicorn świadomie pominięte: każdy proces ładuje własny model Whisper i Chromium, limit „1 wideo naraz” i odstępy zapytań do wyszukiwarki działałyby osobno w każdym procesie; przy potrzebie skalowania – osobny kontener do wideo

## Wideo i monitoring – poprawki (22.11.2026)
- [x] Dłuższe filmy (np. YouTube > 15 min) nie są już odrzucane („Pobieranie pominięte”): pobierany i analizowany jest pierwszy fragment (`VIDEO_MAX_SECONDS`), w materiale widać pełną długość i analizowany zakres; przy błędzie przycinania ffmpeg automatyczna druga próba z prostszym formatem
- [x] Whisper: odfiltrowane „halucynacje” na muzyce/ciszy (np. „Thanks for having me.”), segmenty bez mowy; przy niepewnym wykryciu języka druga próba po polsku
- [x] Monitoring: jedno pole wyszukiwania rozpoznające #hashtag / frazę / @profil / link do filmu (link = od razu do analizy), kroki 1-2-3, podpowiedzi (popularne hashtagi / frazy oszustów) pod polem, wyniki zaraz pod spodem, „Monitoruj stale” przy zapytaniu i wynikach, zgrupowane komunikaty o niedostępnych platformach
- [x] TikTok: dodane `curl_cffi` (yt-dlp[curl-cffi]) – yt-dlp podszywa się pod przeglądarkę, bez tego TikTok odpowiadał błędem; posty ograniczone regionalnie/świeże („IP address is blocked from accessing this post”) nadal niedostępne – wtedy wgranie pliku
- [ ] TikTok/Instagram/X/Facebook w wyszukiwaniu idą przez publiczną wyszukiwarkę (DuckDuckGo), która przy częstych zapytaniach czasowo blokuje (202) – nie obchodzimy; rozważyć oficjalne API platform

## Poprawki po testach zespołu (22.11.2026)
- [x] Wynik po weryfikacji analityka zastępuje wynik automatu wszędzie (nagłówek, lista, pulpit, filtry ryzyka/progu); wynik automatu przekreślony obok; kalibracja nadal na surowym wyniku klasyfikatora
- [x] „Zostaje 75/100” – to nie błąd liczenia: wynik ogólny = najwyższy wynik obszaru (M2 83, M3 75). Tryb edycji pokazuje teraz podgląd wyniku na żywo i rozbicie na obszary (który obszar trzyma wynik), punkty pogrupowane wg obszaru
- [x] Ręczne dodawanie problemów (obszar, waga, fragment, moment w filmie, komentarz) – liczą się do wyniku i podsumowania, usuwane ikoną kosza
- [x] Data publikacji: w nagłówku materiału, kolumna i sortowanie w wynikach; scraper – data z ID posta X/TikToka, `<time datetime>`, więcej metatagów, metadane posta
- [x] „Mock data”: scraper działa (prawdziwe filmy YT i post X przeanalizowane); dane demo to próbki kalibracyjne (`SEED_DEMO`) – oznaczone jako „próbka”, domyślnie ukryte w pulpicie, wynikach i alertach (przełącznik „pokaż próbki demo”), zostają w kalibracji; `DELETE /api/demo` (admin) usuwa je całkiem
- [x] Alerty: „Weryfikuję” (W trakcie weryfikacji) i „↺ Porzuć” – powrót do stanu początkowego (nowy, nieprzeczytany); status alertu i materiału zsynchronizowany w obie strony
- [x] Usunięte dane testowe: zostały 3 próbki do testów (Złota Przystań – oszustwo, ETF – oznaczona współpraca, TikTok krypto); seed przy pustej bazie wczytuje tylko je (`SEED_SAMPLES`, `all` = pełen zestaw do kalibracji); próbki widoczne domyślnie z oznaczeniem „próbka”
- [x] Prostszy język: „problem / do sprawdzenia / w porządku”, „Ocena ryzyka”, „Wykryte problemy”, „Co sprawdzamy / Dlaczego / Przepis”

## Weryfikacja analityka – iteracja 2
- [x] Odrzucanie pojedynczych elementów punktu (sygnał oszustwa, fragment transkrypcji/tekstu), nie tylko całych punktów: M1.10 przeliczany od razu z pozostałych sygnałów (ten sam wzór i progi co analizator), odrzucenie wszystkich fragmentów = odrzucenie punktu, odrzucenie M1.9 usuwa też sygnał „nierealne zyski”; profil i wynik sygnałów po weryfikacji zapisywane w materiale
- [x] Oznaczenie „Autoreklama (własna reklama)”: automatycznie, gdy firma reklamuje samą siebie albo usługodawca – własne usługi; ręczna zmiana typu treści w profilu (ma pierwszeństwo przed klasyfikacją, także po ponownej analizie)
- [x] Status materiału „W trakcie weryfikacji” (alert oznaczany jako przeczytany, ale pozostaje otwarty)

## Monitoring – iteracja 3
- [x] „Wyszukaj kandydatów” bez wyboru platformy: jedno zapytanie przeszukuje YouTube, TikTok, Instagram, X i Facebook naraz (kolumna „Platforma”, błędy pojedynczych platform pokazywane osobno); „Monitoruj stale” zapisuje zapytanie dla wszystkich platform
- [x] Stała aktualizacja hashtagów wg popularności (`TAGS_CRON`, domyślnie co godzinę): ranking z polskich materiałów (zasięg × liczba × średnie ryzyko, trend 7 dni vs poprzednie 7), czołówka (`TAG_AUTO_WATCH`=8) automatycznie monitorowana na wszystkich platformach, tagi, które wypadły z czołówki – automatycznie wstrzymywane; tagi ogólne i oznaczenia współpracy (#reklama, #współpraca, #fyp…) wykluczone; stała lista tagów usunięta z UI (tylko zimny start przy pustej bazie)
- [x] Podsumowanie: ikona edycji (ołówek) → tryb weryfikacji z przełącznikami „uwzględnij” przy punktach; odrzucone punkty nie liczą się do „wyniku po weryfikacji” (ten sam wzór co analizator) ani do podsumowania, są oznaczone w tabelach przesłanek i obowiązują po ponownej analizie; wynik klasyfikatora zostaje w historii
- [x] Uzupełnienie języka i hashtagów dla materiałów sprzed rankingu (migracja)

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
