// Klienci HTTP do serwisów Python (scraper, analyzer). Timeout + czytelne błędy.
import { config } from './config.js';
import { isVideoUrl, longPost } from './video.js';

export class UpstreamError extends Error {
  constructor(service, status, detail) {
    super(`${service}: ${detail || `HTTP ${status}`}`);
    this.status = status;
    // 501 = funkcja niedostępna w tym wdrożeniu (np. OCR bez Tesseracta) – ponawianie nic nie da
    this.retryable = (status >= 500 && status !== 501) || status === 0;
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

async function callLong(path, opts) {
  try {
    const { status, data } = await longPost(config.scraperUrl, path, opts);
    if (status >= 400) throw new UpstreamError('scraper', status, typeof data.detail === 'string' ? data.detail : undefined);
    return data;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError('scraper', 0, err.name === 'AbortError' ? 'przekroczono czas odpowiedzi (wideo)' : 'serwis niedostępny');
  }
}

export const scraper = {
  // adresy wideo (TikTok, Reels, YouTube, …): pobranie + Whisper + OCR klatek trwa minuty
  url: (url) => (isVideoUrl(url)
    ? callLong('/scrape/video', { json: { url } })
    : call(config.scraperUrl, 'scraper', '/scrape', { body: { url, render: true } })),
  videoFile: (file, meta = {}) => callLong(`/scrape/video/file?${new URLSearchParams(Object.entries(meta).filter(([, v]) => v))}`, { file }),
  html: (html, url, meta = {}) => call(config.scraperUrl, 'scraper', '/scrape/html', { body: { html, url, ...meta } }),
  text: (payload) => call(config.scraperUrl, 'scraper', '/scrape/text', { body: payload }),
  image: (payload) => call(config.scraperUrl, 'scraper', '/scrape/image', { body: payload, timeoutMs: 120000 }),
  discover: (url, limit = 10) => call(config.scraperUrl, 'scraper', '/discover', { body: { url, limit } }),
  health: () => call(config.scraperUrl, 'scraper', '/health', { method: 'GET', timeoutMs: 3000 }),
};

export const analyzer = {
  analyze: (material) => call(config.analyzerUrl, 'analyzer', '/analyze', { body: material }),
  summary: (result) => call(config.analyzerUrl, 'analyzer', '/summary', { body: { result }, timeoutMs: 120000 }),
  rules: () => call(config.analyzerUrl, 'analyzer', '/rules', { method: 'GET' }),
  registrySearch: (q) => call(config.analyzerUrl, 'analyzer', `/registry/search?q=${encodeURIComponent(q)}`, { method: 'GET' }),
  enrichKrs: (krs, full = false) => call(config.analyzerUrl, 'analyzer', `/enrich/krs/${encodeURIComponent(krs)}${full ? '?full=true' : ''}`, { method: 'GET', timeoutMs: 45000 }),
  enrichGleif: ({ name, lei, country }) => call(config.analyzerUrl, 'analyzer', `/enrich/gleif?${new URLSearchParams(Object.entries(lei ? { lei } : { name, country }).filter(([, v]) => v))}`, { method: 'GET', timeoutMs: 30000 }),
  gleifDetail: (lei) => call(config.analyzerUrl, 'analyzer', `/enrich/gleif/${encodeURIComponent(lei)}`, { method: 'GET', timeoutMs: 45000 }),
  watchCheck: (params) => call(config.analyzerUrl, 'analyzer', `/watchlists/check?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`, { method: 'GET' }),
  watchMeta: () => call(config.analyzerUrl, 'analyzer', '/watchlists/meta', { method: 'GET' }),
  okxReserves: (force = false) => call(config.analyzerUrl, 'analyzer', `/reserves/okx${force ? '?force=true' : ''}`, { method: 'GET', timeoutMs: 45000 }),
  crises: () => call(config.analyzerUrl, 'analyzer', '/markets/crises', { method: 'GET' }),
  gpwInstruments: () => call(config.analyzerUrl, 'analyzer', '/markets/gpw/instruments', { method: 'GET', timeoutMs: 60000 }),
  // pierwsze pobranie okresu z archiwum GPW to kilkaset żądań (~4 min) – długi limit czasu
  crisisReport: async (body) => {
    try {
      const { status, data } = await longPost(config.analyzerUrl, '/markets/gpw/crisis', { json: body, timeoutMs: 15 * 60 * 1000 });
      if (status >= 400) throw new UpstreamError('analyzer', status, typeof data.detail === 'string' ? data.detail : undefined);
      return data;
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      throw new UpstreamError('analyzer', 0, err.name === 'AbortError' ? 'przekroczono czas odpowiedzi' : 'serwis niedostępny');
    }
  },
  registryCheck: (name) => call(config.analyzerUrl, 'analyzer', `/registry/check?name=${encodeURIComponent(name)}`, { method: 'GET' }),
  health: () => call(config.analyzerUrl, 'analyzer', '/health', { method: 'GET', timeoutMs: 3000 }),
};
