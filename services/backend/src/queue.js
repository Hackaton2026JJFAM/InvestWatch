// Kolejka zadań (BullMQ/Redis): ponawianie z backoffem, równoległość konfigurowalna.
// REDIS_URL=memory: prosta kolejka w pamięci o tym samym zachowaniu (dev bez Redisa).
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import Redis from 'ioredis';
import { config } from './config.js';
import { one } from './db.js';
import { log } from './log.js';
import { processScan } from './pipeline.js';
import { emit } from './realtime.js';

const JOB_OPTS = { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 500, removeOnFail: 1000 };

function memoryQueue() {
  const pending = [];
  let active = 0;
  const counts = { waiting: 0, active: 0, failed: 0, completed: 0 };
  const pump = () => {
    while (active < config.concurrency && pending.length) {
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
    add: async (_name, data) => { pending.push({ data, attemptsMade: 0, opts: JOB_OPTS }); setImmediate(pump); },
    getJobCounts: async () => ({ ...counts, waiting: pending.length, active }),
    close: async () => {},
  };
}

const connection = config.redis ? { ...config.redis, maxRetriesPerRequest: null } : null;
export let scanQueue = null;
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
    scanQueue = memoryQueue();
    queueReady = true;
    return;
  }
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
  scanQueue = new Queue('scan', { connection, defaultJobOptions: JOB_OPTS });
  scanQueue.on('error', (err) => logThrottled('queue error', err));
  queueReady = true;
}

export async function queueHealth() {
  if (!scanQueue || !queueReady) return { ok: false };
  try {
    return { ok: true, mode: connection ? 'redis' : 'memory', ...(await scanQueue.getJobCounts('waiting', 'active', 'failed', 'completed')) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function enqueue(data, trigger = 'manual') {
  const row = await one(
    'INSERT INTO scan_jobs (url, source_id, trigger) VALUES ($1, $2, $3) RETURNING id, status, created_at',
    [data.url ?? null, data.sourceId ?? null, trigger],
  );
  await scanQueue.add('scan', { ...data, scanJobId: row.id });
  emit('scan:update', { id: row.id, status: 'queued', url: data.url });
  return row;
}

export function startWorker() {
  if (!connection) {
    log.info('kolejka w pamięci (REDIS_URL=memory) – tylko do pracy lokalnej');
    return null;
  }
  const worker = new Worker('scan', processScan, { connection, concurrency: config.concurrency });
  worker.on('failed', (job, err) => log.warn('scan job failed', { jobId: job?.data?.scanJobId, attempt: job?.attemptsMade, err: err.message }));
  worker.on('error', (err) => logThrottled('worker error', err));
  return worker;
}
