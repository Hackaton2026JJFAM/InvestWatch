# Środowisko JS (Deno) wymagane przez yt-dlp do pobierania z YouTube
FROM denoland/deno:bin-2.5.6 AS deno

# Obraz z Chromium i zależnościami systemowymi Playwright
FROM mcr.microsoft.com/playwright/python:v1.65.2-noble
# OCR obrazów reklam: Tesseract z językiem polskim i angielskim; ffmpeg do łączenia ścieżek wideo (yt-dlp)
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-pol tesseract-ocr-eng ffmpeg \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deno /deno /usr/local/bin/deno
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
# model Whisper pobierany przy pierwszym użyciu do wolumenu /models/whisper
RUN useradd -m scraper && mkdir -p /models/whisper && chown scraper /models/whisper
USER scraper
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
