// Kolejka zadań (BullMQ/Redis): ponawianie z backoffem, równoległość konfigurowalna.
import { Queue, Worker } from 'bullmq';
import { config } from './config.js';
import { one } from './db.js';
import { log } from './log.js';
import { processScan } from './pipeline.js';
import { emit } from './realtime.js';

const connection = { ...config.redis, maxRetriesPerRequest: null };
export const scanQueue = new Queue('scan', {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 500, removeOnFail: 1000 },
});

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
  const worker = new Worker('scan', processScan, { connection, concurrency: config.concurrency });
  worker.on('failed', (job, err) => log.warn('scan job failed', { jobId: job?.data?.scanJobId, attempt: job?.attemptsMade, err: err.message }));
  worker.on('error', (err) => log.error('worker error', { err: err.message }));
  return worker;
}
