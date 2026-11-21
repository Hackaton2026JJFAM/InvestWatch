const env = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback === undefined) throw new Error(`Brak zmiennej środowiskowej ${name}`);
    return fallback;
  }
  return v;
};

// Pełne opcje połączenia z REDIS_URL: użytkownik, hasło, numer bazy, TLS (rediss://).
// REDIS_URL=memory -> kolejka w pamięci procesu (tylko lokalny dev bez Redisa).
export function parseRedisUrl(value) {
  if (value === 'memory') return null;
  const u = new URL(value);
  if (!['redis:', 'rediss:'].includes(u.protocol)) throw new Error('REDIS_URL musi zaczynać się od redis:// lub rediss://');
  const opts = { host: u.hostname, port: Number(u.port || 6379) };
  if (u.username) opts.username = decodeURIComponent(u.username);
  if (u.password) opts.password = decodeURIComponent(u.password);
  const db = u.pathname.replace('/', '');
  if (db) opts.db = Number(db);
  if (u.protocol === 'rediss:') opts.tls = {};
  return opts;
}

const csv = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  port: Number(env('PORT', '4000')),
  databaseUrl: env('DATABASE_URL', 'postgres://investwatch:investwatch@localhost:5432/investwatch'),
  redis: parseRedisUrl(env('REDIS_URL', 'redis://localhost:6379')),
  scraperUrl: env('SCRAPER_URL', 'http://localhost:8001'),
  analyzerUrl: env('ANALYZER_URL', 'http://localhost:8002'),
  scanCron: env('SCAN_CRON', '0 */6 * * *'),
  defaultThreshold: Number(env('DEFAULT_THRESHOLD', '45')),
  seedDemo: env('SEED_DEMO', 'true') === 'true',
  samplesDir: env('SAMPLES_DIR', '/app/samples'),
  concurrency: Number(env('WORKER_CONCURRENCY', '2')),
  // wideo (Whisper na CPU) – osobny tor kolejki; zwiększać razem z liczbą replik scrapera
  videoConcurrency: Number(env('VIDEO_WORKER_CONCURRENCY', '1')),
  // proaktywne wyszukiwanie popularnych wideo po tagach/frazach
  watchCron: env('WATCH_CRON', '15 */3 * * *'),
  // stała aktualizacja hashtagów wg popularności (ranking + automatyczny monitoring czołówki)
  tagsCron: env('TAGS_CRON', '5 * * * *'),
  tagAutoWatch: Number(env('TAG_AUTO_WATCH', '8')),
  tagAutoMinViews: Number(env('TAG_AUTO_MIN_VIEWS', '5000')),
  // Dozwolone Origin dla WebSocket poza tym samym hostem (np. https://investwatch.local)
  allowedOrigins: csv(env('ALLOWED_ORIGINS', '')),
  // Hasło administratora (próg, źródła, próbki, usuwanie). Puste = operacje administracyjne wyłączone.
  adminPassword: env('ADMIN_PASSWORD', ''),
  // Ciasteczko sesji tylko przez HTTPS (ustaw true za reverse proxy z TLS)
  secureCookies: env('SECURE_COOKIES', 'false') === 'true',
  // Automatyczne wzbogacanie nowych spółek (KRS/GLEIF/listy ostrzeżeń) – wymaga dostępu do internetu
  enrichAuto: env('ENRICH_AUTO', 'true') === 'true',
  // Proof of Reserves (OKX): odczyt raportu codziennie rano
  reservesCron: env('RESERVES_CRON', '30 6 * * *'),
};
