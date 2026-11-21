// Klienci HTTP do serwisów Python (scraper, analyzer). Timeout + czytelne błędy.
import { config } from './config.js';

export class UpstreamError extends Error {
  constructor(service, status, detail) {
    super(`${service}: ${detail || `HTTP ${status}`}`);
    this.status = status;
    this.retryable = status >= 500 || status === 0;
  }
}

async function call(base, service, path, { method = 'POST', body, timeoutMs = 90000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(base + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new UpstreamError(service, res.status, typeof data.detail === 'string' ? data.detail : undefined);
    return data;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError(service, 0, err.name === 'AbortError' ? 'przekroczono czas odpowiedzi' : 'serwis niedostępny');
  } finally {
    clearTimeout(timer);
  }
}

export const scraper = {
  url: (url) => call(config.scraperUrl, 'scraper', '/scrape', { body: { url, render: true } }),
  html: (html, url, meta = {}) => call(config.scraperUrl, 'scraper', '/scrape/html', { body: { html, url, ...meta } }),
  text: (payload) => call(config.scraperUrl, 'scraper', '/scrape/text', { body: payload }),
  discover: (url, limit = 10) => call(config.scraperUrl, 'scraper', '/discover', { body: { url, limit } }),
  health: () => call(config.scraperUrl, 'scraper', '/health', { method: 'GET', timeoutMs: 3000 }),
};

export const analyzer = {
  analyze: (material) => call(config.analyzerUrl, 'analyzer', '/analyze', { body: material }),
  summary: (result) => call(config.analyzerUrl, 'analyzer', '/summary', { body: { result }, timeoutMs: 120000 }),
  rules: () => call(config.analyzerUrl, 'analyzer', '/rules', { method: 'GET' }),
  registrySearch: (q) => call(config.analyzerUrl, 'analyzer', `/registry/search?q=${encodeURIComponent(q)}`, { method: 'GET' }),
  registryCheck: (name) => call(config.analyzerUrl, 'analyzer', `/registry/check?name=${encodeURIComponent(name)}`, { method: 'GET' }),
  health: () => call(config.analyzerUrl, 'analyzer', '/health', { method: 'GET', timeoutMs: 3000 }),
};
