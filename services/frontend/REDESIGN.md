# Interfejs analityczny

## Zakres

- `src/enterprise.css`: wspólna warstwa prezentacji, ciemna paleta finansowa,
  osobne kolory stanów, tabele, nawigacja i układy responsywne.
- `src/theme.jsx`: ciemny motyw dla nowych użytkowników; zapisane preferencje
  oraz motywy jasny i systemowy pozostają dostępne.
- Dashboard: kolejka analityka i bezpośrednie przejścia do wyników i alertów.
- Results: podstawowe i szczegółowe filtry, pięć kolumn, rozwijany profil
  i moduły, wyszukiwanie odzwierciedlane w URL.
- Material: interpretacja wyniku, rozwijane cytaty źródłowe (bez ograniczenia
  do trzech), domyślnie przesłanki wymagające uwagi, dodatkowe operacje
  oddzielone od decyzji analityka.
- Entities: wyszukiwanie, filtr rejestru i sortowanie pobranej listy.
- Entity: osobne sekcje przeglądu, materiałów, rejestrów i danych rynkowych;
  pełne odpowiedzi rejestrów pod rozwijanym nagłówkiem.
- Alerts: czytelne nieprzeczytane wiersze, filtr statusu i próg przy wyniku.

Routing, klient API, metody mutacji, analiza i kontrakty backendu nie były
zmieniane. Dopasowania podmiotów są opatrzone zastrzeżeniem, że nie
potwierdzają współpracy.

## Weryfikacja

- `npm run build`: poprawny build produkcyjny.
- `git diff --check`: bez błędów białych znaków.
- Testy Playwright na produkcyjnym podglądzie w Edge, z kontrolowanymi
  odpowiedziami API: sześć głównych tras przy 1440 i 390 px.
- Sprawdzone: renderowanie, brak przewijania całej strony w poziomie,
  filtry szczegółowe, szczegóły wierszy, cytaty przesłanek, pusty wynik
  wyszukiwania podmiotów, przełączanie sekcji profilu, brak wyjątków JS.

Testy przeglądarkowe używały narzędzi z katalogu tymczasowego, bez dodawania
zależności aplikacji. Nie zastępują testów integracyjnych z działającym
backendem ani sprawdzenia rzeczywistych mutacji i WebSocket.

`PROJECT_CONTEXT.md` nie występował w repozytorium podczas realizacji;
kontekst odczytano z `README.md` i kodu aplikacji.

## Korekta czytelności list (bez zmiany układu)

`src/readability.css` stanowi wspólną warstwę czytelności tabel, list,
kontrolek i etykiet. Zachowuje powierzchnie i akcent przycisków. Rozjaśnia
tekst list, wzmacnia separatory, hover/focus/selected i usuwa przygaszanie
nieaktywnych rekordów. Monitor i Scan pokazują jawne statusy wstrzymania.

Zmierzony kontrast w ciemnym motywie (względna luminancja sRGB, WCAG):

| Para | Kontrast |
| --- | ---: |
| Tekst główny / powierzchnia listy | 14,53:1 |
| Tekst główny / hover | 11,05:1 |
| Tekst drugorzędny / hover | 8,16:1 |
| Metadane / hover | 6,67:1 |
| Separator / hover (najniższy kontrast granicy) | 3,21:1 |
| Link i focus / hover | 7,19:1 |
| Tekst przycisku / turkusowe tło | 6,16:1 |
| Badge ryzyka wysokiego / jego tło | 8,58:1 |
| Badge ostrzeżenia / jego tło | 9,36:1 |
| Badge poprawności / jego tło | 8,62:1 |
| Badge neutralny / jego tło | 8,75:1 |

`npm run test:contrast` weryfikuje produkcyjne tokeny obu motywów:
tekst na powierzchniach bazowych i hover, wyniki, badge'e, przyciski,
granice oraz wskaźniki focus/selected. Test nie oznacza pełnego audytu
zgodności całej aplikacji z WCAG.

Ponowny test przeglądarkowy objął osiem tras (także Scan i Monitor),
w szerokościach 1440, 768 i 390 px, z kontrolowanymi odpowiedziami API.
Sprawdzono obliczone style widocznego tekstu (minimum 4,5:1), focus
klawiatury, hover wierszy, rozwijanie szczegółów i brak poziomego
przepełnienia dokumentu. Poprawiono również przepełnienie tooltipów
na tablecie oraz pola wyszukiwania monitoringu na telefonie.

## Kluczowe informacje + szczegóły na żądanie

Wspólny `RecordDetails` w `src/components/ui.jsx` wykorzystuje natywne
`details/summary`, domyślnie zwinięte i obsługiwane klawiaturą.
Rozwinięcie nie pobiera dodatkowych danych i nie uruchamia mutacji.
Każdy rekord rozwija się niezależnie; dane mają normalny, czytelny
rozmiar pisma zamiast drobnych podpisów w podstawowym widoku.

Wzorzec obejmuje:
- Results: tytuł, zasięg, ryzyko/wynik i status na pierwszym planie;
  autor, URL, data, tagi, obserwujący, profil, moduły i podobieństwo w szczegółach.
- Entities i Alerts: główne nazwy, wyniki i statusy pozostają widoczne;
  rodzaj podmiotu, próg alertu, daty i opisy w rozwinięciu.
- Scan i BulkImport: materiał, stan zadania/importu i najważniejsze akcje
  pozostają widoczne; próby, wyzwalacze, daty, etykiety i treść błędów
  mają rozwinięcia. Sam fakt błędu pozostaje widoczny.
- Monitor: tytuł/zapytanie, zasięg, status i akcje; metadane i parametry
  harmonogramu w szczegółach.
- Dashboard, wyszukiwarka, materiały podmiotu i historia analiz:
  daty, identyfikatory i metadane przeniesione z list do rozwinięć.
- Material: nazwa przesłanki i wynik na pierwszym planie; uzasadnienie,
  podstawa prawna i wszystkie cytaty w szczegółach. Sygnały oferty
  i powiązane podmioty korzystają z tego samego wzorca.
- Registry i Reserves: kluczowe dane tożsamości/statusu/pokrycia widoczne;
  adresy, reprezentacja, osoby, rejestracja LEI, ilości rezerw i dane
  techniczne pod nagłówkami rozwijanymi.

Zastrzeżenia dotyczące automatycznych dopasowań i ograniczeń analizy
nie zostały schowane. Routing, sortowanie i akcje API pozostają zachowane.

### Testy rozwinięć

`npm run test:disclosures` uruchamia test przeglądarkowy na produkcyjnym
podglądzie (`npm run preview -- --port 4173`). Wymaga opcjonalnie dostępnego
Playwright oraz Edge (domyślnie). Nie dodano zależności do aplikacji.
Można wskazać moduł Playwright zmienną `PLAYWRIGHT_PATH`, przeglądarkę
zmienną `BROWSER_CHANNEL`, a adres podglądu zmienną `TEST_URL`.

Test obejmuje 13 scenariuszy przy szerokościach 1440, 768 i 390 px:
stan zwinięty, niezależne otwieranie, klawiaturę, focus, ponowne zamykanie,
czytelność rozwiniętego tekstu i brak przepełnienia dokumentu.
Scenariusze używają kontrolowanych odpowiedzi API, nie działającego backendu.
