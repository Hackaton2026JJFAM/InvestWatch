# TrustLens – automatyczny nadzór nad reklamą inwestycyjną w internecie i mediach społecznościowych

*Zadanie konkursowe UKNF #InvestWatch, HackNation 2026. Nazwa robocza w kodzie i repozytorium: InvestWatch.*

## W skrócie

TrustLens samodzielnie wyszukuje w internecie i w mediach społecznościowych reklamy oraz oferty dotyczące instrumentów i usług finansowych na polskim rynku. Każdy materiał – stronę WWW, post, grafikę albo krótkie wideo – sprowadza do jednej postaci i ocenia w trzech modułach analitycznych:

- **M1 – finfluencerzy i podmioty trzecie,**
- **M2 – zgodność i informacja o ryzyku,**
- **M3 – usługi nieautoryzowane (shadow advisory).**

Analityk dostaje wynik 0–100, poziom ryzyka i listę przesłanek. Każda przesłanka ma identyfikator reguły, uzasadnienie i cytowany fragment z miejscem wystąpienia. Materiały powyżej progu stają się alertami w czasie rzeczywistym. Próg ustawia nadzorca w panelu kalibracji, widząc od razu, jak zmienia on liczbę wyników fałszywie dodatnich i fałszywie ujemnych.

System działa w całości lokalnie (on-premise), na otwartym oprogramowaniu i bez płatnych API. Cały stos uruchamia jedno polecenie `docker compose up`.

## Problem

Reklama inwestycyjna przeniosła się tam, gdzie ręczny nadzór nie nadąża:

- **Finfluencerzy** polecają brokerów z kodem rabatowym lub linkiem w bio, często bez oznaczenia współpracy, w krótkim wideo, które się ogląda, a nie czyta.
- **Informacja o ryzyku** bywa formalnie obecna, ale ukryta: drobna, szara czcionka w stopce, zwinięta sekcja albo plansza widoczna przez sekundę na końcu filmu.
- **Doradztwo bez zezwolenia** przybiera postać „wealth management”, „family office” czy „konsultacji 1:1” z indywidualnym doborem portfela.

Skala treści rośnie szybciej niż zespół analityków. Potrzebne jest narzędzie, które samo znajduje materiały, ocenia je według stałych kryteriów i uzasadnia wynik tak, żeby analityk mógł go szybko zweryfikować.

## Rozwiązanie

### Centralny silnik zbierania danych

- **Źródła:** strony WWW oraz TikTok, Instagram, Facebook, YouTube (także Shorts), X, Threads, LinkedIn i inne platformy wideo. Materiały wymagające logowania można wgrać ręcznie.
- **Formaty wejściowe:** adres URL, kod HTML, tekst, obraz reklamy (PNG/JPG/WebP) i plik wideo do 250 MB.
- **Strony WWW:** przeglądarka Chromium (Playwright) renderuje stronę w trzech widokach – komputer, tablet, telefon. Dla każdego bloku tekstu zapisuje rozmiar czcionki, kontrast, pozycję, widoczność, przesłonięcie i to, czy tekst jest w stopce lub zwiniętej sekcji.
- **Grafiki:** OCR (Tesseract) odczytuje tekst razem z wysokością liter i kontrastem, więc te same reguły wizualne działają na banerach i obrazach.
- **Wideo:** yt-dlp pobiera publiczny materiał, faster-whisper przepisuje mowę, a OCR czyta napisy z klatek. System mierzy, przez ile sekund widać ostrzeżenie i czy padło ono tylko w ścieżce dźwiękowej.
- **Monitoring:** ranking popularnych polskich hashtagów i fraz-przynęt („darmowa kasa”, „gwarantowany zysk”) przeliczany co godzinę. Najpopularniejsze tagi są monitorowane automatycznie, a zapisane zapytania i źródła uruchamia harmonogram (cron). Monitoring zbiera tylko treści po polsku, pomija materiały z wykluczonymi słowami (np. gry) i może mieć próg zasięgu.
- **Bezpieczne pobieranie:** kolejka zadań z ponawianiem i priorytetem według zasięgu, rotacja User-Agent i proxy, blokada SSRF na każdym przekierowaniu i żądaniu przeglądarki.
- **Wstępne przetwarzanie:** usuwanie tagów HTML i normalizacja tekstu.
- **Usuwanie duplikatów:** odcisk simhash z odległością Hamminga, potwierdzany podobieństwem treści. Ta sama treść opublikowana w kilku miejscach jest jednym materiałem z listą lokalizacji, a nie kilkoma alertami.

### Moduł 1 – finfluencerzy i podmioty trzecie

Wyszukuje reklamy firm inwestycyjnych i ich instrumentów publikowane przez podmioty trzecie i osoby prywatne, także polskojęzyczne reklamy firm zagranicznych działających w Polsce transgranicznie. Dla każdego materiału zestawia cztery rzeczy:

| Firma inwestycyjna | Podmiot reklamujący | Treść reklamy | Lokalizacja |
|---|---|---|---|
| dopasowanie do rejestru firm inwestycyjnych KNF (752 podmioty), dane z KRS i kod LEI z GLEIF | profil, platforma, zasięg (wyświetlenia, obserwujący), historia konta | cytat, kody polecające i linki partnerskie, oznaczenie współpracy (#reklama, #ad) | dokładny adres URL, data publikacji, inne miejsca publikacji tej samej treści |

Moduł rozpoznaje m.in.:

- reklamę firmy przez podmiot trzeci;
- brak oznaczenia współpracy;
- kody afiliacyjne;
- brokera spoza rejestru KNF w reklamie polskojęzycznej;
- podmiot z listy ostrzeżeń publicznych KNF;
- nierealistyczne obietnice zysku, przeliczane na stopę roczną: „2% dziennie” to ok. 730% rocznie;
- sygnały oszustwa: presja czasu, kontakt przez WhatsApp lub Telegram, „bot AI”, „zacznij od 250 zł”, wizerunek znanych osób.

Konto, które wcześniej publikowało ryzykowne treści, dostaje dodatkową przesłankę i wyższy priorytet weryfikacji. Oficjalny materiał samej firmy i strona własna usługodawcy nie są traktowane jak reklama podmiotu trzeciego.

Aktualizację okresową zapewniają harmonogram skanowania źródeł, zapisane zapytania monitoringu i ponowna analiza materiałów.

### Moduł 2 – zgodność i informacja o ryzyku

Ocenia materiały marketingowe firm inwestycyjnych według 18 wymogów z załącznika do zadania oraz dodatkowej reguły o obietnicach zysku bez ryzyka.

- **Reguły treści:**
  - identyfikacja firmy i oznaczenie reklamy;
  - informacja o ryzyku przy każdej obietnicy zysku i jej zrozumiałość;
  - spójność językowa i porównania produktów;
  - wyniki historyczne (okres, waluta, koszty, dominacja, ostrzeżenie);
  - prognozy i informacja podatkowa;
  - sugerowanie aprobaty organu nadzoru.
- **Reguły wizualne**, mierzone, a nie czytane:
  - rozmiar czcionki ostrzeżenia wobec dominującej;
  - kontrast w skali WCAG;
  - ukrycie, przesłonięcie i umieszczenie w stopce;
  - dostępność bez dodatkowego kliknięcia;
  - responsywność na trzech urządzeniach.
  
  W wideo ostrzeżenie widoczne krócej niż 3 sekundy jest naruszeniem, a ostrzeżenie tylko wypowiedziane, bez napisu, jest oznaczane do sprawdzenia.
- **Proporcjonalność:** statystyczny klasyfikator zdań (TF-IDF + regresja logistyczna) rozróżnia zdania o zysku, ryzyku, doradztwie i edukacji. Pozwala to sprawdzić, czy przekazowi o zyskach towarzyszy dostateczna informacja o ryzyku.
- **Bez fałszywych alarmów:** reguły reklamy inwestycyjnej nie są stosowane do treści spoza rynku finansowego (np. „darmowa kasa” w grze). Artykuł edukacyjny bez wezwań do działania nie jest traktowany jak materiał marketingowy.

Materiał niespełniający kryteriów jest flagowany automatycznie: wynik powyżej progu tworzy alert.

### Moduł 3 – usługi nieautoryzowane (shadow advisory)

Wyszukuje opisy usług typu wealth management, investment consulting, family office i innych podmiotów doradczych. Wykrywa frazy wskazujące na faktyczne świadczenie indywidualnego doradztwa inwestycyjnego: rekomendacje „pod Ciebie”, konsultacje i sesje 1:1, dobór portfela, ofertę płatnej usługi.

Treść jest klasyfikowana jako edukacja, ogólna usługa doradcza, planowanie finansowe albo indywidualne doradztwo. Podmiot jest sprawdzany w rejestrze firm inwestycyjnych KNF, na liście ostrzeżeń publicznych, w KRS i w GLEIF.

Wynik to raport z danymi podmiotu, treścią oferty (cytowane zdania) i adresem URL potencjalnego naruszenia. Doradcę zweryfikowanego przez analityka można dodać do listy sprawdzonych – jego kolejne materiały nie są wtedy oznaczane jako doradztwo bez zezwolenia.

### Weryfikacja przez analityka

- **Ocena:** wynik 0–100 z poziomem ryzyka w stałej skali (0–30 niskie, 31–70 średnie, 71–100 wysokie). Obok niego osobny wskaźnik sygnałów oszustwa. Mocne sygnały oszustwa zawsze podnoszą ocenę.
- **Podsumowanie** w języku naturalnym. Generuje je lokalny model językowy (Ollama, np. Gemma) albo szablon. Model musi cytować identyfikatory reguł i nie formułuje wniosków prawnych.
- **Korekta:** analityk może odrzucić błędny punkt albo pojedynczy fragment i dodać problem ręcznie. Wynik przelicza się od razu i obowiązuje także po ponownej analizie.
- **Statusy:** materiały i alerty mają statusy (Nowy, W trakcie weryfikacji, Zweryfikowany, Eskalowany, Odrzucony). Nowe alerty wysokiego ryzyka przychodzą na żywo przez WebSocket.
- **Dashboard:** filtrowanie po dacie, źródle, poziomie ryzyka, module, zasięgu, tagu i typie publikującego. Wykresy trendów i rozkładu naruszeń, sortowanie według priorytetu (ryzyko × zasięg).

### Panel kalibracji

Suwak progu pokazuje na żywo:

- liczbę alertów,
- precyzję i pełność,
- macierz pomyłek,
- krzywą wpływu progu,
- rozkład wyników względem etykiet testowych.

Na oznaczonych danych testowych, przy progu 45:

| Precyzja | Pełność | TP | FP | FN | TN |
|---|---|---|---|---|---|
| 100% | 93% | 14 | 0 | 1 | 7 |

## Architektura i technologie

Lekkie, niezależne usługi połączone kolejką i jednym kontraktem danych (wspólny schemat wyniku dla modułów 1–3):

| Usługa | Technologia | Rola |
|---|---|---|
| frontend | React 19, Vite, Recharts, Socket.io, nginx | dashboard, alerty na żywo, panel kalibracji |
| backend | Node 22, Express 5, BullMQ, node-cron, zod | API, kolejka zadań, harmonogram, WebSocket, zapis wyników |
| scraper | Python, FastAPI, Playwright, Tesseract, yt-dlp, faster-whisper | pobieranie, render, OCR, transkrypcja, ekstrakcja do JSON |
| analyzer | Python, FastAPI, scikit-learn, RapidFuzz | moduły 1–3, klasyfikator zdań, embeddingi, scoring, rejestry |
| postgres | PostgreSQL 16 (pg_trgm, unaccent) | metadane, treści, analizy, przesłanki, alerty, podmioty |
| redis | Valkey 8 | kolejka zadań |
| ollama (opcjonalnie) | lokalny model językowy | podsumowania |

Najważniejsze cechy architektury:

- **Skalowanie:** scraper i analyzer są bezstanowe, więc można je powielać. Kolejka ma osobne tory dla stron i wideo.
- **Rozbudowa:**
  - nowa reguła to funkcja zwracająca przesłankę z wagą;
  - wynik modułu łączy przesłanki funkcją noisy-OR, więc dodanie reguły nie zmienia skali;
  - źródła danych o podmiotach (KRS, GLEIF, listy) są niezależnymi adapterami z buforem.
- **Reprezentacja wektorowa:** wektory TF-IDF (n-gramy znakowe i słowne) oraz embeddingi dokumentu (TruncatedSVD, 64 wymiary).
- **Szczegóły:** opis przepływu zadania, kontraktu danych i scoringu jest w [ARCHITECTURE.md](ARCHITECTURE.md).

## Bezpieczeństwo i wdrożenie u nadzorcy

- Wyłącznie otwarte biblioteki i modele działające lokalnie – żadnych płatnych ani zewnętrznych API do analizy.
- Wersje zależności przypięte. CI uruchamia testy, `pip-audit` i `npm audit`, a obrazy Node przerywają build przy podatnościach wysokiego ryzyka.
- Sekrety wyłącznie w pliku `.env` poza repozytorium. Walidacja każdego wejścia API (zod), ochrona SSRF w scraperze. Operacje administracyjne (próg, źródła, usuwanie) wymagają hasła.
- Dashboard domyślnie dostępny tylko z lokalnego komputera.

## Proces wytwarzania z asystentami AI

Kod powstawał z asystentem Claude Code według opisanego standardu ([AI_WORKFLOW.md](AI_WORKFLOW.md)):

1. **Specyfikacja przed kodem.** Wymagania z treści zadania i załącznika to źródło prawdy, a każda reguła ma identyfikator.
2. **Małe, sprawdzalne kroki.** Każda zmiana ma test.
3. **Ewaluacja na danych oznaczonych.** Precyzja i pełność są sprawdzane po każdej zmianie reguł, bez strojenia pod pojedynczą próbkę.
4. **Bezpieczeństwo zależności.**
5. **Przegląd człowieka** przed scaleniem.

Wynik:

- 70 testów reguł analizatora i 18 testów jednostkowych backendu;
- niezależny zestaw audytowy (161 przypadków, raport w [AUDIT_REPORT.md](AUDIT_REPORT.md));
- konwencja commitów `feat`/`fix`/`docs`/`test`.

## Ograniczenia

- Wynik jest sygnałem do weryfikacji, a nie stwierdzeniem naruszenia. Decyzję podejmuje analityk.
- Rejestr KNF to snapshot publicznych list. Brak podmiotu w rejestrze nie oznacza nielegalnej działalności.
- Publiczne API KRS anonimizuje dane osób w organach spółek, więc osób nie łączymy między spółkami.
- Treści z platform społecznościowych są pobierane z publicznych danych albo importowane ręcznie – system nie obchodzi zabezpieczeń platform. Niektóre platformy ograniczają dostęp bez logowania (np. zasięg na Instagramie).
- OCR może przeoczyć bardzo krótkie plansze w wideo (próbkowanie co ok. 1,5 s) i mocno stylizowane napisy.

## Dalszy rozwój

- Klasyfikator na modelu językowym dla polszczyzny (np. HerBERT) zamiast TF-IDF.
- Embeddingi z modelu językowego do grupowania podobnych reklam i kampanii.
- Pełne role i uwierzytelnianie analityków, rejestr operacji, polityka retencji danych.
- Integracja z rejestrem licencjonowanych doradców inwestycyjnych.
