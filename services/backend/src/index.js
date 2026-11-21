import http from 'node:http';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { migrate, pool, waitForDb } from './db.js';
import { log } from './log.js';
import { scanQueue, startWorker } from './queue.js';
import { attach } from './realtime.js';
import insights from './routes/insights.js';
import materials from './routes/materials.js';
import scans from './routes/scans.js';
import { startScheduler } from './scheduler.js';
import { seedSamples } from './seed.js';
import { analyzer, scraper } from './services.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '6mb' }));

app.get('/api/health', async (_req, res) => {
  const [db, scr, ana] = await Promise.allSettled([pool.query('SELECT 1'), scraper.health(), analyzer.health()]);
  res.json({
    ok: db.status === 'fulfilled',
    db: db.status === 'fulfilled',
    scraper: scr.status === 'fulfilled' ? scr.value : null,
    analyzer: ana.status === 'fulfilled' ? ana.value : null,
    queue: await scanQueue.getJobCounts('waiting', 'active', 'failed', 'completed').catch(() => null),
  });
});

app.use('/api', scans, materials, insights);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Nie znaleziono' }));

// Express 5 przekazuje tu także błędy z funkcji async.
app.use((err, _req, res, _next) => {
  const status = err.status && err.status < 600 ? err.status : 502;
  if (status >= 500) log.error('request failed', { err: err.message });
  res.status(status).json({ error: err.message, details: err.details });
});

const server = http.createServer(app);
attach(server);

await waitForDb();
await migrate();
startWorker();
startScheduler();
server.listen(config.port, () => log.info('backend listening', { port: config.port }));
if (config.seedDemo) seedSamples().catch((err) => log.warn('seed failed', { err: err.message }));

const shutdown = async () => {
  server.close();
  await scanQueue.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
