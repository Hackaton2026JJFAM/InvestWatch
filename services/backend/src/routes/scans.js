import { Router } from 'express';
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
    url: z.string().max(2048).optional(),
    title: z.string().max(500).optional(),
    author: z.string().max(200).optional(),
    platform: z.enum(['web', 'facebook', 'instagram', 'tiktok', 'youtube', 'x', 'linkedin', 'telegram']).optional(),
    ground_truth: z.boolean().optional(),
  }).refine((b) => b.html || b.text, 'Podaj html albo text'), req.body);
  const url = body.url || `upload://${Date.now()}`;
  const job = body.html
    ? await enqueue({ kind: 'html', html: body.html, url, title: body.title, author: body.author, platform: body.platform, groundTruth: body.ground_truth }, 'upload')
    : await enqueue({ kind: 'text', text: body.text, url, title: body.title, author: body.author, platform: body.platform, groundTruth: body.ground_truth }, 'upload');
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
