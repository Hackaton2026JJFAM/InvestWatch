// Monitoring popularnych treści: tagi, wyszukiwanie kandydatów, zapisane zapytania.
import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import { one, q } from '../db.js';
import { enqueue, priorityFor } from '../queue.js';
import { normTag, PRESET_TAGS } from '../reach.js';
import { parse } from '../validate.js';
import { discoverCandidates, getWatch, runWatch } from '../watch.js';

const r = Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const searchSchema = z.object({
  platform: z.enum(['youtube', 'tiktok']),
  kind: z.enum(['search', 'hashtag', 'profile']),
  query: z.string().trim().min(1).max(200),
  sort: z.enum(['relevance', 'views', 'date']).default('views'),
}).refine((b) => !(b.platform === 'tiktok' && b.kind !== 'profile'), 'TikTok: dostępny monitoring profili (tagi wymagają zalogowania)');

// Popularne tagi: z bazy (liczba materiałów, suma wyświetleń, średnie ryzyko) + zestaw startowy tagów finansowych
r.get('/tags/popular', async (req, res) => {
  const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
  const rows = await q(
    `SELECT t AS tag, count(*)::int AS materials, coalesce(sum(m.views), 0)::bigint AS views,
            round(avg(a.score))::int AS avg_score, count(*) FILTER (WHERE m.profile_type = 'podejrzenie_oszustwa')::int AS scams
       FROM materials m CROSS JOIN LATERAL unnest(m.tags) t
       JOIN LATERAL (SELECT score FROM analyses WHERE material_id = m.id ORDER BY created_at DESC LIMIT 1) a ON TRUE
      WHERE m.fetched_at > now() - make_interval(days => $1)
      GROUP BY t ORDER BY count(*) DESC, sum(m.views) DESC NULLS LAST LIMIT 40`, [days]);
  res.json({ days, tags: rows, presets: PRESET_TAGS });
});

// Podgląd kandydatów (bez kolejkowania) – analityk zaznacza, co analizować
r.post('/discover/video', async (req, res) => {
  const b = parse(searchSchema.and(z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), min_views: z.coerce.number().int().min(0).default(0) })), req.body);
  res.json(await discoverCandidates({ ...b, query: b.kind === 'hashtag' ? normTag(b.query) : b.query, minViews: b.min_views }));
});

// Kolejkowanie wybranych kandydatów z priorytetem wg wyświetleń
r.post('/discover/video/enqueue', async (req, res) => {
  const b = parse(z.object({ items: z.array(z.object({ url: z.url({ protocol: /^https?$/ }).max(2048), views: z.number().int().nullable().optional(), title: z.string().max(500).nullable().optional() })).min(1).max(50) }), req.body);
  const jobs = [];
  for (const i of b.items) jobs.push(await enqueue({ kind: 'url', url: i.url, title: i.title ?? undefined }, 'discover', { priority: priorityFor(i.views) }));
  res.status(202).json({ jobs });
});

r.get('/watch', async (_req, res) => {
  res.json(await q(
    `SELECT w.*, count(m.id)::int AS materials, count(m.id) FILTER (WHERE m.profile_type = 'podejrzenie_oszustwa')::int AS scams,
            coalesce(max(m.views), 0)::bigint AS top_views
       FROM watch_queries w LEFT JOIN materials m ON m.watch_id = w.id GROUP BY w.id ORDER BY w.created_at DESC`));
});

r.post('/watch', requireAdmin, async (req, res) => {
  const b = parse(searchSchema.and(z.object({
    min_views: z.coerce.number().int().min(0).max(1e10).default(10000),
    max_per_run: z.coerce.number().int().min(1).max(30).default(10),
  })), req.body);
  const query = b.kind === 'hashtag' ? normTag(b.query) : b.query;
  const row = await one(
    `INSERT INTO watch_queries (platform, kind, query, sort, min_views, max_per_run) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (platform, kind, query) DO UPDATE SET sort = EXCLUDED.sort, min_views = EXCLUDED.min_views, max_per_run = EXCLUDED.max_per_run, enabled = TRUE
     RETURNING *`, [b.platform, b.kind, query, b.sort, b.min_views, b.max_per_run]);
  res.status(201).json(row);
});

r.patch('/watch/:id', requireAdmin, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const b = parse(z.object({ enabled: z.boolean().optional(), min_views: z.coerce.number().int().min(0).optional(), max_per_run: z.coerce.number().int().min(1).max(30).optional() }), req.body);
  const row = await one(
    `UPDATE watch_queries SET enabled = COALESCE($2, enabled), min_views = COALESCE($3, min_views), max_per_run = COALESCE($4, max_per_run)
      WHERE id = $1 RETURNING *`, [id, b.enabled ?? null, b.min_views ?? null, b.max_per_run ?? null]);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono zapytania' });
  res.json(row);
});

r.delete('/watch/:id', requireAdmin, async (req, res) => {
  const { id } = parse(idParam, req.params);
  await q('DELETE FROM watch_queries WHERE id = $1', [id]);
  res.status(204).end();
});

r.post('/watch/:id/run', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const w = await getWatch(id);
  if (!w) return res.status(404).json({ error: 'Nie znaleziono zapytania' });
  try {
    const out = await runWatch(w);
    res.json({ found: out.found, queued: out.queued });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default r;
