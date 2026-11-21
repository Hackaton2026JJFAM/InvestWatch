import http from 'node:http';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { migrate, pool, waitForDb } from './db.js';
import { log } from './log.js';
import { initQueue, queueHealth, scanQueue, startWorker } from './queue.js';
import { authRouter } from './auth.js';
import { attach } from './realtime.js';
import insights from './routes/insights.js';
import materials from './routes/materials.js';
import scans from './routes/scans.js';
import { startScheduler } from './scheduler.js';
import { seedSamples } from './seed.js';
import { analyzer, scraper, UpstreamError } from './services.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '16mb' })); // obrazy reklam do 10 MB (base64)

// Liveness: proces odpowiada.
app.get('/api/live', (_req, res) => res.json({ ok: true }));

// Readiness: wszystkie usługi krytyczne; 503, gdy którakolwiek nie działa.
app.get('/api/health', async (_req, res) => {
  const [db, scr, ana, queue] = await Promise.allSettled([pool.query('SELECT 1'), scraper.health(), analyzer.health(), queueHealth()]);
  const body = {
    db: db.status === 'fulfilled',
    scraper: scr.status === 'fulfilled' ? scr.value : null,
    analyzer: ana.status === 'fulfilled' ? ana.value : null,
    queue: queue.status === 'fulfilled' ? queue.value : { ok: false },
  };
  body.ok = Boolean(body.db && body.scraper?.ok && body.analyzer?.ok && body.queue?.ok);
  body.render = Boolean(body.scraper?.playwright);
  res.status(body.ok ? 200 : 503).json(body);
});

app.use('/api', authRouter, scans, materials, insights);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Nie znaleziono' }));

// Express 5 przekazuje tu także błędy z funkcji async.
app.use((err, _req, res, _next) => {
  let status = err.status ?? err.statusCode;
  if (err instanceof UpstreamError) status = err.status >= 400 && err.status < 500 ? err.status : 502;
  if (!status || status < 400 || status > 599) status = 500;
  if (status >= 500) log.error('request failed', { err: err.message });
  res.status(status).json({ error: status === 500 ? 'Błąd wewnętrzny serwera' : err.message, details: err.details });
});

const server = http.createServer(app);
attach(server);

try {
  await waitForDb();
  await migrate();
  await initQueue();
} catch (err) {
  log.error('start przerwany', { err: err.message });
  process.exit(1);
}
startWorker();
startScheduler();
server.listen(config.port, () => log.info('backend listening', { port: config.port }));
if (config.seedDemo) seedSamples().catch((err) => log.warn('seed failed', { err: err.message }));

const shutdown = async () => {
  server.close();
  await scanQueue?.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
