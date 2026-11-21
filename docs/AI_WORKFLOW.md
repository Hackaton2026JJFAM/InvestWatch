# Proces wytwarzania z asystentami AI

Zespół korzysta z asystentów kodu (Claude Code) według stałych zasad. Asystent przygotowuje propozycję, a człowiek ją weryfikuje i odpowiada za merge.

## Zasady

1. **Specyfikacja przed kodem.** Wymagania UKNF (treść zadania, załączniki 1–3, tabela 18 reguł) są źródłem prawdy. Każda reguła ma `rule_id` i podstawę prawną z załącznika.
2. **Małe, sprawdzalne kroki.** Jeden PR to jeden moduł lub jedna funkcja. Asystent dopisuje test, który pokazuje działanie (`services/analyzer/tests`).
3. **Ewaluacja na danych oznaczonych.** Zmiana reguł lub wag wymaga uruchomienia `tools/evaluate.py`. Precision, recall i listę FP/FN wklejamy do opisu PR. Nie stroimy reguł pod pojedynczą próbkę. Poprawiamy tylko błędy, które dotyczą klasy przypadków (przykład: „bez ryzyka” liczone jako ostrzeżenie).
4. **Bezpieczeństwo.** Asystent nie dodaje zależności bez przypięcia wersji. Każdy PR przechodzi `pip-audit` i `npm audit`. Sekrety nie trafiają do repozytorium ani do promptów.
5. **Żadnych płatnych API.** Modele działają lokalnie (scikit-learn, Ollama).
6. **Język wyników.** System i model nie formułują wniosków prawnych. Generator podsumowań odrzuca odpowiedzi LLM bez cytowań `[rule_id]` lub z wnioskiem prawnym i wraca do szablonu.
7. **Przegląd.** Kod od asystenta przechodzi review człowieka, a w razie potrzeby `/code-review`.

## Konwencje

- Python: FastAPI, typy, funkcje reguł zwracają `Finding`. Node: ESM, Express 5, walidacja `zod` na każdym wejściu.
- Commity: `feat|fix|docs|test|chore(moduł): opis`.
- Interfejs po polsku, komunikaty błędów zrozumiałe dla analityka.
