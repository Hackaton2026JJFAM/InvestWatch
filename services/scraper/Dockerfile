# Obraz z Chromium i zależnościami systemowymi Playwright
FROM mcr.microsoft.com/playwright/python:v1.65.2-noble
# OCR obrazów reklam: Tesseract z językiem polskim i angielskim
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-pol tesseract-ocr-eng \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
RUN useradd -m scraper
USER scraper
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
