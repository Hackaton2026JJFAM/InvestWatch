# Instalacja TrustLens (InvestWatch)

## 1. Wymagania

- **Git** i **Docker Desktop** (Windows/macOS) albo Docker Engine z Compose (Linux)
- **Bez Ollamy:** 2 rdzenie CPU, 4 GB RAM, 5 GB miejsca na dysku
- **Z Ollamą:** 4 rdzenie CPU, 10 GB RAM, 10 GB miejsca na dysku (GPU opcjonalnie)

## 2. Pobranie kodu

```bash
git clone https://github.com/Hackaton2026JJFAM/InvestWatch.git
cd InvestWatch
```

## 3. Konfiguracja

```bash
cp .env.example .env
```

Na Windows w PowerShell: `Copy-Item .env.example .env`.

W `.env` ustaw `POSTGRES_PASSWORD` i `ADMIN_PASSWORD`. Plik `.env` nie trafia do repozytorium.

## 4a. Uruchomienie bez Ollamy

```bash
docker compose up -d --build
```

Pierwsze uruchomienie trwa kilka minut, bo budują się obrazy, a scraper pobiera model Whisper.

Dashboard: http://localhost:8080. Podsumowania powstają wtedy z szablonu.

## 4b. Uruchomienie z Ollamą (podsumowania z lokalnego modelu)

1. W `.env` ustaw:
   ```
   OLLAMA_URL=http://ollama:11434
   OLLAMA_MODEL=gemma3:4b
   ```
2. Uruchom stos z profilem `llm`:
   ```bash
   docker compose --profile llm up -d --build
   ```
3. Pobierz model (jednorazowo, ok. 3,3 GB):
   ```bash
   docker compose exec ollama ollama pull gemma3:4b
   ```
4. Uruchom ponownie analizator, żeby wczytał ustawienia:
   ```bash
   docker compose up -d analyzer
   ```

W panelu „Podsumowanie” na karcie materiału pojawi się wtedy „silnik: ollama:gemma3:4b”.

## 5. Sprawdzenie

```bash
docker compose ps
```

Wszystkie usługi powinny mieć status `healthy` albo `running`. Przy pierwszym starcie ładują się 3 próbki testowe. Pełen zestaw 23 próbek do kalibracji włącza ustawienie `SEED_SAMPLES=all` w `.env`.

## 6. Aktualizacja i zatrzymanie

```bash
git pull
docker compose up -d --build                     # z Ollamą: docker compose --profile llm up -d --build
docker compose down                              # zatrzymanie (dane zostają)
docker compose down -v                           # zatrzymanie i usunięcie danych (baza, modele)
```
