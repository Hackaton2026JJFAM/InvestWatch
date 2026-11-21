import express, { Router } from 'express';
import { saveUpload, VIDEO_MAX_BYTES } from '../video.js';
import { z } from 'zod';
import { one, q } from '../db.js';
import { enqueue } from '../queue.js';
import { runSources } from '../scheduler.js';
import { seedSamples } from '../seed.js';
import { requireAdmin } from '../auth.js';
import { parse } from '../validate.js';

const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);
const r = Router();

r.post('/scans', async (req, res) => {
  const body = parse(z.union([z.object({ url: httpUrl }), z.object({ urls: z.array(httpUrl).min(1).max(50) })]), req.body);
  const urls = body.urls ?? [body.url];
  const jobs = [];
  for (const url of urls) jobs.push(await enqueue({ kind: 'url', url }, 'manual'));
  res.status(202).json(urls.length === 1 ? jobs[0] : { jobs });
});

// Ręczne dodanie materiału (HTML lub tekst) – np. próbki dostarczone przez organizatorów.
r.post('/scans/upload', async (req, res) => {
  const body = parse(z.object({
    html: z.string().max(5_000_000).optional(),
    text: z.string().max(500_000).optional(),
    // obraz reklamy (PNG/JPEG/WebP) jako data URL lub base64, do 10 MB – analiza przez OCR
    image: z.string().max(14_500_000).regex(/^(data:image\/(png|jpeg|jpg|webp|gif|bmp|tiff);base64,)?[A-Za-z0-9+/=\s]+$/, 'Obraz: data URL lub base64').optional(),
    url: z.string().max(2048).optional(),
    title: z.string().max(500).optional(),
    author: z.string().max(200).optional(),
    platform: z.enum(['web', 'facebook', 'instagram', 'tiktok', 'youtube', 'x', 'linkedin', 'telegram']).optional(),
    ground_truth: z.boolean().optional(),
  }).refine((b) => b.html || b.text || b.image, 'Podaj html, text albo image'), req.body);
  const url = body.url || `upload://${Date.now()}`;
  const job = body.image
    ? await enqueue({ kind: 'image', image: body.image, url, title: body.title, author: body.author, platform: body.platform, groundTruth: body.ground_truth }, 'upload')
    : body.html
    ? await enqueue({ kind: 'html', html: body.html, url, title: body.title, author: body.author, platform: body.platform, groundTruth: body.ground_truth }, 'upload')
    : await enqueue({ kind: 'text', text: body.text, url, title: body.title, author: body.author, platform: body.platform, groundTruth: body.ground_truth }, 'upload');
  res.status(202).json(job);
});

// Plik wideo/reels (mp4, webm, mov…) jako surowa treść żądania; metadane w parametrach zapytania.
// Dla materiałów, których platforma nie udostępnia bez logowania – analityk wgrywa nagranie.
const VIDEO_TYPES = /^(video\/(mp4|webm|quicktime|x-matroska|x-msvideo|mpeg|3gpp|ogg)|application\/octet-stream)$/;
r.post('/scans/video', express.raw({ type: (req) => VIDEO_TYPES.test(req.headers['content-type'] ?? ''), limit: VIDEO_MAX_BYTES }), async (req, res) => {
  const meta = parse(z.object({
    url: z.string().max(2048).optional(),
    title: z.string().max(500).optional(),
    author: z.string().max(200).optional(),
    platform: z.enum(['web', 'facebook', 'instagram', 'tiktok', 'youtube', 'x', 'linkedin', 'telegram', 'threads', 'vimeo', 'twitch', 'reddit']).optional(),
    ground_truth: z.enum(['true', 'false']).optional(),
  }), req.query);
  if (!Buffer.isBuffer(req.body) || req.body.length < 1000) {
    return res.status(415).json({ error: 'Wyślij plik wideo (Content-Type: video/mp4, video/webm, video/quicktime…)' });
  }
  const file = await saveUpload(req.body);
  const job = await enqueue({ kind: 'video', file, url: meta.url || `upload://video-${Date.now()}`, title: meta.title, author: meta.author,
    platform: meta.platform, groundTruth: meta.ground_truth === undefined ? undefined : meta.ground_truth === 'true' }, 'upload');
  res.status(202).json(job);
});

r.get('/scans', async (_req, res) => {
  res.json(await q('SELECT * FROM scan_jobs ORDER BY id DESC LIMIT 100'));
});

r.get('/scans/:id', async (req, res) => {
  const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
  const job = await one('SELECT * FROM scan_jobs WHERE id = $1', [id]);
  if (!job) return res.status(404).json({ error: 'Nie znaleziono zadania' });
  res.json(job);
});

r.get('/sources', async (_req, res) => res.json(await q('SELECT * FROM sources ORDER BY id DESC')));

r.post('/sources', requireAdmin, async (req, res) => {
  const b = parse(z.object({ url: httpUrl, label: z.string().max(200).optional(), kind: z.enum(['web', 'social']).default('web') }), req.body);
  const row = await one(
    'INSERT INTO sources (url, label, kind) VALUES ($1, $2, $3) ON CONFLICT (url) DO UPDATE SET enabled = TRUE RETURNING *',
    [b.url, b.label ?? null, b.kind],
  );
  res.status(201).json(row);
});

r.patch('/sources/:id', requireAdmin, async (req, res) => {
  const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
  const b = parse(z.object({ enabled: z.boolean() }), req.body);
  const row = await one('UPDATE sources SET enabled = $2 WHERE id = $1 RETURNING *', [id, b.enabled]);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono źródła' });
  res.json(row);
});

r.delete('/sources/:id', requireAdmin, async (req, res) => {
  const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
  await q('DELETE FROM sources WHERE id = $1', [id]);
  res.status(204).end();
});

r.post('/sources/run', requireAdmin, async (_req, res) => res.status(202).json(await runSources()));
r.post('/seed', requireAdmin, async (_req, res) => res.status(202).json(await seedSamples({ force: true })));

export default r;
