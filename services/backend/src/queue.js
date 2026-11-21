// Kolejki zadań (BullMQ/Redis): ponawianie z backoffem, równoległość konfigurowalna.
// Dwa tory: „scan” (strony, HTML, tekst, obrazy – szybkie) i „video” (pobranie + Whisper + OCR klatek –
// minuty na materiał). Osobna równoległość sprawia, że kolejka filmów nie blokuje skanów stron;
// wideo z większym zasięgiem dostaje wyższy priorytet. Skalowanie: więcej replik backendu (workerów)
// i scrapera – `docker compose up -d --scale scraper=3` – BullMQ rozdziela zadania między workery.
// REDIS_URL=memory: prosta kolejka w pamięci o tym samym zachowaniu (dev bez Redisa).
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import Redis from 'ioredis';
import { config } from './config.js';
import { one } from './db.js';
import { log } from './log.js';
import { processScan } from './pipeline.js';
import { emit } from './realtime.js';
import { isVideoUrl } from './video.js';

const JOB_OPTS = { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 500, removeOnFail: 1000 };
const LANES = { scan: () => config.concurrency, video: () => config.videoConcurrency };

function memoryQueue(concurrency) {
  const pending = [];
  let active = 0;
  const counts = { completed: 0, failed: 0 };
  const pump = () => {
    pending.sort((a, b) => (a.opts.priority ?? 1e9) - (b.opts.priority ?? 1e9));
    while (active < concurrency && pending.length) {
      const job = pending.shift();
      active++;
      processScan(job)
        .then(() => counts.completed++)
        .catch((err) => {
          job.attemptsMade++;
          if (!(err instanceof UnrecoverableError) && job.attemptsMade < JOB_OPTS.attempts) {
            setTimeout(() => { pending.push(job); pump(); }, JOB_OPTS.backoff.delay * 2 ** (job.attemptsMade - 1));
          } else {
            counts.failed++;
            log.warn('scan job failed', { jobId: job.data.scanJobId, err: err.message });
          }
        })
        .finally(() => { active--; pump(); });
    }
  };
  return {
    add: async (_name, data, opts = {}) => { pending.push({ data, attemptsMade: 0, opts: { ...JOB_OPTS, ...opts } }); setImmediate(pump); },
    getJobCounts: async () => ({ ...counts, waiting: pending.length, active }),
    close: async () => {},
  };
}

const connection = config.redis ? { ...config.redis, maxRetriesPerRequest: null } : null;
export const queues = {};
export let scanQueue = null; // zgodność wsteczna
let queueReady = false;

// Ten sam błąd Redisa logowany najwyżej raz na 30 s – bez zalewania dysku logami.
const lastLogged = new Map();
function logThrottled(msg, err) {
  const key = `${msg}:${err.message}`;
  const now = Date.now();
  if (now - (lastLogged.get(key) ?? 0) < 30000) return;
  lastLogged.set(key, now);
  log.error(msg, { err: err.message });
}

// Fail-fast: brak połączenia z Redisem przy starcie kończy proces czytelnym błędem.
export async function initQueue() {
  if (!connection) {
    for (const [lane, conc] of Object.entries(LANES)) queues[lane] = memoryQueue(conc());
  } else {
    const probe = new Redis({ ...config.redis, lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 1, retryStrategy: () => null });
    probe.on('error', () => {});
    try {
      await probe.connect();
      await probe.ping();
    } catch (err) {
      throw new Error(`Redis niedostępny (${config.redis.host}:${config.redis.port}): ${err.message}`);
    } finally {
      probe.disconnect();
    }
    for (const lane of Object.keys(LANES)) {
      queues[lane] = new Queue(lane, { connection, defaultJobOptions: JOB_OPTS });
      queues[lane].on('error', (err) => logThrottled('queue error', err));
    }
  }
  scanQueue = queues.scan;
  queueReady = true;
}

export async function queueHealth() {
  if (!queues.scan || !queueReady) return { ok: false };
  try {
    const lanes = {};
    for (const [lane, qu] of Object.entries(queues)) lanes[lane] = await qu.getJobCounts('waiting', 'active', 'failed', 'completed');
    return { ok: true, mode: connection ? 'redis' : 'memory', ...lanes.scan, lanes };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const laneOf = (data) => (data.kind === 'video' || (data.kind === 'url' && isVideoUrl(data.url)) ? 'video' : 'scan');

// Priorytet BullMQ: mniejsza liczba = wcześniej. Zasięg (wyświetlenia) skraca kolejkę logarytmicznie.
export const priorityFor = (views) => (views ? Math.max(1, 2_000_000 - Math.round(Math.log10(views + 1) * 200_000)) : 1_500_000);

export async function enqueue(data, trigger = 'manual', { priority } = {}) {
  const row = await one(
    'INSERT INTO scan_jobs (url, source_id, trigger) VALUES ($1, $2, $3) RETURNING id, status, created_at',
    [data.url ?? null, data.sourceId ?? null, trigger],
  );
  const lane = laneOf(data);
  await queues[lane].add(lane, { ...data, scanJobId: row.id }, priority ? { priority } : {});
  emit('scan:update', { id: row.id, status: 'queued', url: data.url });
  return { ...row, lane };
}

export function startWorker() {
  if (!connection) {
    log.info('kolejki w pamięci (REDIS_URL=memory) – tylko do pracy lokalnej', { scan: config.concurrency, video: config.videoConcurrency });
    return null;
  }
  return Object.entries(LANES).map(([lane, conc]) => {
    const worker = new Worker(lane, processScan, { connection, concurrency: conc(), lockDuration: lane === 'video' ? 120000 : 30000 });
    worker.on('failed', (job, err) => log.warn('scan job failed', { lane, jobId: job?.data?.scanJobId, attempt: job?.attemptsMade, err: err.message }));
    worker.on('error', (err) => logThrottled('worker error', err));
    return worker;
  });
}
