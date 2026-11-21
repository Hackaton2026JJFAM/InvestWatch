// Proaktywny monitoring popularnych wideo: zapisane zapytania (hashtag / fraza / profil twórcy)
// uruchamiane według harmonogramu. Scraper zwraca same metadane (bez pobierania filmów), więc
// filtr zasięgu (min. wyświetleń) odcina treści niszowe ZANIM zużyjemy czas na Whisper i OCR.
// Do analizy trafiają tylko nowe filmy powyżej progu, od najpopularniejszych (priorytet kolejki).
import cron from 'node-cron';
import { config } from './config.js';
import { one, q } from './db.js';
import { log } from './log.js';
import { enqueue, priorityFor } from './queue.js';
import { emit } from './realtime.js';
import { scraper } from './services.js';

/** Kandydaci z platformy z oznaczeniem, czy już są w bazie / w kolejce. */
export async function discoverCandidates({ platform, kind, query, sort = 'views', limit = 20, minViews = 0, polish = true }) {
  const r = await scraper.discoverVideo({ platform, kind, query, sort, limit, polish });
  const urls = r.items.map((i) => i.url);
  const known = new Set((await q(
    `SELECT url FROM materials WHERE url = ANY($1) OR final_url = ANY($1)
     UNION SELECT url FROM scan_jobs WHERE url = ANY($1) AND status IN ('queued', 'running')`, [urls])).map((x) => x.url));
  // zasięg nieznany (posty znalezione przez wyszukiwarkę, platformy bez publicznych licznikach) nie odrzuca –
  // inaczej Instagram/X/Facebook nigdy nie przeszłyby progu; język: przy „tylko polskie” odrzucamy treści rozpoznane jako obce
  const items = r.items.map((i) => {
    const reachOk = i.views == null ? platform !== 'youtube' || !minViews : i.views >= minViews;
    const langOk = !polish || i.lang === 'pl' || (i.lang == null && platform !== 'youtube');
    return { ...i, known: known.has(i.url), reach_known: i.views != null, passes: !i.live && reachOk && langOk };
  });
  return { ...r, items };
}

export async function runWatch(w) {
  try {
    const r = await discoverCandidates({ platform: w.platform, kind: w.kind, query: w.query, sort: w.sort, limit: Math.min(50, w.max_per_run * 3),
      minViews: Number(w.min_views), polish: w.polish !== false });
    const picked = r.items.filter((i) => i.passes && !i.known).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, w.max_per_run);
    for (const i of picked) {
      await enqueue({ kind: 'url', url: i.url, watchId: w.id, title: i.title }, 'watch', { priority: priorityFor(i.views) });
    }
    await q('UPDATE watch_queries SET last_run_at = now(), last_found = $2, last_queued = $3, last_error = NULL WHERE id = $1', [w.id, r.items.length, picked.length]);
    log.info('watch run', { id: w.id, query: w.query, found: r.items.length, queued: picked.length });
    emit('watch:update', { id: w.id });
    return { found: r.items.length, queued: picked.length, items: r.items };
  } catch (err) {
    await q('UPDATE watch_queries SET last_run_at = now(), last_error = $2 WHERE id = $1', [w.id, err.message.slice(0, 300)]);
    emit('watch:update', { id: w.id });
    throw err;
  }
}

let running = false;
export async function runAllWatches() {
  if (running) return;
  running = true;
  try {
    for (const w of await q('SELECT * FROM watch_queries WHERE enabled ORDER BY last_run_at NULLS FIRST')) {
      await runWatch(w).catch((err) => log.warn('watch failed', { id: w.id, err: err.message }));
    }
  } finally { running = false; }
}

export function startWatchSchedule() {
  if (!cron.validate(config.watchCron)) return null;
  return cron.schedule(config.watchCron, () => runAllWatches(), { timezone: 'Europe/Warsaw' });
}

export const getWatch = (id) => one('SELECT * FROM watch_queries WHERE id = $1', [id]);
