const env = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback === undefined) throw new Error(`Brak zmiennej środowiskowej ${name}`);
    return fallback;
  }
  return v;
};

const redis = new URL(env('REDIS_URL', 'redis://localhost:6379'));

export const config = {
  port: Number(env('PORT', '4000')),
  databaseUrl: env('DATABASE_URL', 'postgres://investwatch:investwatch@localhost:5432/investwatch'),
  redis: { host: redis.hostname, port: Number(redis.port || 6379) },
  scraperUrl: env('SCRAPER_URL', 'http://localhost:8001'),
  analyzerUrl: env('ANALYZER_URL', 'http://localhost:8002'),
  scanCron: env('SCAN_CRON', '0 */6 * * *'),
  defaultThreshold: Number(env('DEFAULT_THRESHOLD', '45')),
  seedDemo: env('SEED_DEMO', 'true') === 'true',
  samplesDir: env('SAMPLES_DIR', '/app/samples'),
  concurrency: Number(env('WORKER_CONCURRENCY', '2')),
};
