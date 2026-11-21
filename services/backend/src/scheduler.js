// Harmonogram (cron): cykliczne skanowanie aktywnych źródeł. Dla źródeł typu "web"
// dodatkowo wyszukiwanie podstron z materiałami inwestycyjnymi (discover).
import cron from 'node-cron';
import { config } from './config.js';
import { q } from './db.js';
import { log } from './log.js';
import { enqueue } from './queue.js';
import { scraper } from './services.js';

export async function runSources({ discover = true } = {}) {
  const sources = await q("SELECT id, url, kind FROM sources WHERE enabled AND kind <> 'sample'");
  let queued = 0;
  for (const s of sources) {
    await enqueue({ kind: 'url', url: s.url, sourceId: s.id }, 'schedule');
    queued++;
    if (discover && s.kind === 'web') {
      try {
        const { candidates } = await scraper.discover(s.url, 5);
        for (const url of candidates) {
          await enqueue({ kind: 'url', url, sourceId: s.id }, 'schedule');
          queued++;
        }
      } catch (err) {
        log.warn('discover failed', { sourceId: s.id, err: err.message });
      }
    }
    await q('UPDATE sources SET last_run_at = now() WHERE id = $1', [s.id]);
  }
  log.info('scheduled scan', { sources: sources.length, queued });
  return { sources: sources.length, queued };
}

export function startScheduler() {
  if (!cron.validate(config.scanCron)) {
    log.warn('niepoprawne SCAN_CRON – harmonogram wyłączony', { cron: config.scanCron });
    return null;
  }
  log.info('scheduler started', { cron: config.scanCron });
  return cron.schedule(config.scanCron, () => runSources().catch((err) => log.error('scheduler error', { err: err.message })), {
    timezone: 'Europe/Warsaw',
  });
}
