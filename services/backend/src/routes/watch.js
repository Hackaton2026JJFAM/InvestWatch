// Monitoring popularnych treści: tagi, wyszukiwanie kandydatów, zapisane zapytania.
import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import { one, q } from '../db.js';
import { enqueue, priorityFor } from '../queue.js';
import { normTag, PL_SCAM_PHRASES, PRESET_TAGS, WATCH_PRESETS } from '../reach.js';
import { parse } from '../validate.js';
import { discoverCandidates, getWatch, runWatch } from '../watch.js';
import { refreshTags, trendingTags } from '../tags.js';

const r = Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const PLATFORMS = ['all', 'youtube', 'tiktok', 'instagram', 'x', 'facebook'];
// profil twórcy natywnie: YouTube (kanał) i TikTok; hashtag/fraza – wszystkie platformy
const KIND_OK = (p, k) => k !== 'profile' || ['all', 'youtube', 'tiktok'].includes(p);
const searchSchema = z.object({
  platform: z.enum(PLATFORMS).default('all'),
  kind: z.enum(['search', 'hashtag', 'profile']),
  query: z.string().trim().min(1).max(200),
  sort: z.enum(['relevance', 'views', 'date']).default('views'),
  polish: z.boolean().default(true),
}).refine((b) => KIND_OK(b.platform, b.kind), 'Monitoring profilu: YouTube (kanał) i TikTok; na Instagramie, X i Facebooku – hashtag lub fraza');

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
  const trending = await trendingTags(30);
  res.json({ days, tags: rows, trending, presets: PRESET_TAGS, phrases: PL_SCAM_PHRASES,
    packs: Object.fromEntries(Object.entries(WATCH_PRESETS).map(([k, v]) => [k, { label: v.label, kind: v.kind, count: v.items.length }])) });
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

// ręczne przeliczenie rankingu i synchronizacja automatycznego monitoringu tagów
r.post('/tags/refresh', async (_req, res) => res.json(await refreshTags()));

r.get('/watch', async (_req, res) => {
  res.json(await q(
    `SELECT w.*, ts.popularity, ts.recent, ts.previous, count(m.id)::int AS materials, count(m.id) FILTER (WHERE m.profile_type = 'podejrzenie_oszustwa')::int AS scams,
            coalesce(max(m.views), 0)::bigint AS top_views
       FROM watch_queries w LEFT JOIN materials m ON m.watch_id = w.id
       LEFT JOIN tag_stats ts ON w.kind = 'hashtag' AND ts.tag = w.query
      GROUP BY w.id, ts.popularity, ts.recent, ts.previous ORDER BY w.auto DESC, ts.popularity DESC NULLS LAST, w.created_at DESC`));
});

r.post('/watch', requireAdmin, async (req, res) => {
  const b = parse(searchSchema.and(z.object({
    min_views: z.coerce.number().int().min(0).max(1e10).default(10000),
    max_per_run: z.coerce.number().int().min(1).max(30).default(10),
  })), req.body);
  const query = b.kind === 'hashtag' ? normTag(b.query) : b.query;
  const row = await one(
    `INSERT INTO watch_queries (platform, kind, query, sort, min_views, max_per_run, polish) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (platform, kind, query) DO UPDATE SET sort = EXCLUDED.sort, min_views = EXCLUDED.min_views, max_per_run = EXCLUDED.max_per_run,
       polish = EXCLUDED.polish, enabled = TRUE
     RETURNING *`, [b.platform, b.kind, query, b.sort, b.min_views, b.max_per_run, b.polish]);
  res.status(201).json(row);
});

// Pakiet zapytań jednym kliknięciem: np. wszystkie frazy-przynęty PL na wybranych platformach
r.post('/watch/preset', requireAdmin, async (req, res) => {
  const b = parse(z.object({
    preset: z.enum(Object.keys(WATCH_PRESETS)),
    platforms: z.array(z.enum(PLATFORMS)).min(1).max(6).default(['all']),
    min_views: z.coerce.number().int().min(0).default(0),
    max_per_run: z.coerce.number().int().min(1).max(30).default(5),
  }), req.body);
  const p = WATCH_PRESETS[b.preset];
  let created = 0;
  for (const platform of b.platforms) {
    for (const item of p.items) {
      const query = p.kind === 'hashtag' ? normTag(item) : item;
      const row = await one(
        `INSERT INTO watch_queries (platform, kind, query, sort, min_views, max_per_run, polish) VALUES ($1, $2, $3, 'views', $4, $5, TRUE)
         ON CONFLICT (platform, kind, query) DO NOTHING RETURNING id`, [platform, p.kind, query, b.min_views, b.max_per_run]);
      if (row) created++;
    }
  }
  res.status(201).json({ created, preset: b.preset });
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
