// Załadowanie oznaczonych próbek (data/samples) przez pełny potok – przy pierwszym starcie
// lub na żądanie (POST /api/seed). Etykiety ground_truth zasilają panel kalibracji.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { one } from './db.js';
import { log } from './log.js';
import { enqueue } from './queue.js';

export async function seedSamples({ force = false } = {}) {
  if (!force) {
    const row = await one('SELECT count(*)::int AS n FROM materials');
    if (row.n > 0) return { queued: 0, skipped: 'baza zawiera już materiały' };
  }
  let labels;
  try {
    labels = JSON.parse(await fs.readFile(path.join(config.samplesDir, 'labels.json'), 'utf8'));
  } catch {
    log.warn('brak próbek do załadowania', { dir: config.samplesDir });
    return { queued: 0 };
  }
  let queued = 0;
  for (const [file, meta] of Object.entries(labels)) {
    if (file.startsWith('_')) continue;
    const raw = await fs.readFile(path.join(config.samplesDir, file), 'utf8');
    if (file.endsWith('.json')) {
      const d = JSON.parse(raw);
      await enqueue({ kind: 'text', text: d.text, url: d.url, title: d.title, author: d.author, platform: d.platform, groundTruth: meta.ground_truth }, 'seed');
    } else {
      await enqueue({ kind: 'html', html: raw, url: meta.url ?? `https://sample.example/${file}`, groundTruth: meta.ground_truth }, 'seed');
    }
    queued++;
  }
  log.info('samples queued', { queued });
  return { queued };
}
