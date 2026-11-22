// Załadowanie oznaczonych próbek (data/samples) przez pełny potok – przy pierwszym starcie
// lub na żądanie (POST /api/seed). Etykiety ground_truth zasilają panel kalibracji.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { one } from './db.js';
import { log } from './log.js';
import { enqueue } from './queue.js';
import { saveUpload } from './video.js';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov']);

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
  const only = config.seedSamples === 'all' ? null : new Set(config.seedSamples.split(',').map((x) => x.trim()).filter(Boolean));
  for (const [file, meta] of Object.entries(labels)) {
    if (file.startsWith('_') || (only && !only.has(file))) continue;
    const ext = path.extname(file).toLowerCase();
    if (IMAGE_EXT.has(ext)) {
      // grafika reklamy – OCR w scraperze (wymaga Tesseracta: obraz Docker; w dev bez niego zadanie zakończy się błędem 501)
      const b64 = (await fs.readFile(path.join(config.samplesDir, file))).toString('base64');
      await enqueue({ kind: 'image', image: `data:image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)};base64,${b64}`, url: meta.url ?? `upload://${file}`,
        title: meta.title, platform: meta.platform, groundTruth: meta.ground_truth , demo: true }, 'seed');
      queued++;
      continue;
    }
    if (VIDEO_EXT.has(ext)) {
      // reels – transkrypcja (Whisper) + OCR klatek w scraperze; kopia pliku, bo zadanie usuwa go po przetworzeniu
      const saved = await saveUpload(await fs.readFile(path.join(config.samplesDir, file)));
      await enqueue({ kind: 'video', file: saved, url: meta.url ?? `upload://${file}`, title: meta.title, platform: meta.platform,
        groundTruth: meta.ground_truth , demo: true }, 'seed');
      queued++;
      continue;
    }
    const raw = await fs.readFile(path.join(config.samplesDir, file), 'utf8');
    if (file.endsWith('.json')) {
      const d = JSON.parse(raw);
      await enqueue({ kind: 'text', text: d.text, url: d.url, title: d.title, author: d.author, platform: d.platform, groundTruth: meta.ground_truth , demo: true }, 'seed');
    } else {
      await enqueue({ kind: 'html', html: raw, url: meta.url ?? `https://sample.example/${file}`, groundTruth: meta.ground_truth , demo: true }, 'seed');
    }
    queued++;
  }
  log.info('samples queued', { queued });
  return { queued };
}
