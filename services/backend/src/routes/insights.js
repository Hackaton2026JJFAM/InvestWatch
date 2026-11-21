// Dashboard, alerty, kalibracja, ustawienia, wyszukiwarka, podmioty.
import { Router } from 'express';
import { z } from 'zod';
import { getThreshold, one, q } from '../db.js';
import { emit } from '../realtime.js';
import { analyzer } from '../services.js';
import { requireAdmin } from '../auth.js';
import { parse, riskSql } from '../validate.js';

const r = Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const LATEST = 'JOIN LATERAL (SELECT * FROM analyses WHERE material_id = m.id ORDER BY created_at DESC LIMIT 1) a ON TRUE';

r.get('/dashboard/stats', async (_req, res) => {
  const t = await getThreshold();
  const totals = await one(
    `SELECT count(*)::int AS materials,
            count(*) FILTER (WHERE a.score >= $1)::int AS high,
            count(*) FILTER (WHERE a.score >= $1 * 0.6 AND a.score < $1)::int AS medium,
            count(*) FILTER (WHERE m.status = 'NEW' AND a.score >= $1 * 0.6)::int AS to_verify
       FROM materials m ${LATEST}`, [t]);
  const alerts = await one("SELECT count(*) FILTER (WHERE NOT read)::int AS unread, count(*) FILTER (WHERE status = 'NEW')::int AS new FROM alerts");
  const trend = await q(
    `SELECT to_char(date_trunc('day', m.fetched_at), 'YYYY-MM-DD') AS day, count(*)::int AS total,
            count(*) FILTER (WHERE a.score >= $1)::int AS high
       FROM materials m ${LATEST} WHERE m.fetched_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1`, [t]);
  const byModule = await q(
    `SELECT mod AS module, count(*)::int AS n, count(*) FILTER (WHERE a.score >= $1)::int AS high
       FROM materials m ${LATEST}, unnest(a.modules) AS mod GROUP BY mod ORDER BY mod`, [t]);
  const byRule = await q(
    `SELECT f.rule_id, f.title, count(*)::int AS n FROM materials m ${LATEST} JOIN findings f ON f.analysis_id = a.id
      WHERE f.status = 'fail' GROUP BY f.rule_id, f.title ORDER BY n DESC LIMIT 12`);
  const byPlatform = await q(`SELECT coalesce(platform, 'web') AS platform, count(*)::int AS n FROM materials GROUP BY 1 ORDER BY n DESC`);
  const recent = await q(
    `SELECT m.id, m.title, m.url, m.platform, m.status, m.fetched_at, a.score, a.modules, ${riskSql()} AS risk
       FROM materials m ${LATEST} ORDER BY m.fetched_at DESC LIMIT 10`, [t]);
  res.json({ threshold: t, totals: { ...totals, ...alerts }, trend, byModule, byRule, byPlatform, recent });
});

r.get('/alerts', async (req, res) => {
  const f = parse(z.object({ status: z.enum(['NEW', 'REVIEWED', 'DISMISSED']).optional() }), req.query);
  res.json(await q(
    `SELECT al.*, m.title, m.url, m.platform FROM alerts al JOIN materials m ON m.id = al.material_id
      ${f.status ? 'WHERE al.status = $1' : ''} ORDER BY al.created_at DESC LIMIT 200`, f.status ? [f.status] : []));
});

r.patch('/alerts/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const b = parse(z.object({ status: z.enum(['NEW', 'REVIEWED', 'DISMISSED']).optional(), read: z.boolean().optional() }), req.body);
  const row = await one('UPDATE alerts SET status = COALESCE($2, status), read = COALESCE($3, read) WHERE id = $1 RETURNING *', [id, b.status ?? null, b.read ?? null]);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono alertu' });
  emit('alert:update', row);
  res.json(row);
});

r.post('/alerts/read-all', async (_req, res) => {
  await q('UPDATE alerts SET read = TRUE WHERE NOT read');
  emit('alert:update', { all: true });
  res.status(204).end();
});

r.get('/settings', async (_req, res) => {
  const rows = await q('SELECT key, value, updated_at FROM settings');
  res.json(Object.fromEntries(rows.map((x) => [x.key, x.value])));
});

r.patch('/settings', requireAdmin, async (req, res) => {
  const b = parse(z.object({ threshold: z.number().int().min(0).max(100) }), req.body);
  await q("INSERT INTO settings (key, value, updated_at) VALUES ('threshold', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    [JSON.stringify(b.threshold)]);
  emit('settings:update', { threshold: b.threshold });
  res.json({ threshold: b.threshold });
});

// Panel kalibracji: wynik klasyfikatora jest stały, próg zmienia tylko decyzję.
r.get('/calibration', async (req, res) => {
  const current = await getThreshold();
  const { threshold } = parse(z.object({ threshold: z.coerce.number().min(0).max(100).optional() }), req.query);
  const t = threshold ?? current;
  const items = await q(`SELECT m.id, m.title, m.ground_truth, a.score FROM materials m ${LATEST} ORDER BY a.score DESC`);
  const labeled = items.filter((i) => i.ground_truth !== null);
  const confusion = (th) => {
    const c = { tp: 0, fp: 0, fn: 0, tn: 0 };
    for (const i of labeled) {
      const pred = i.score >= th;
      if (pred && i.ground_truth) c.tp++; else if (pred) c.fp++; else if (i.ground_truth) c.fn++; else c.tn++;
    }
    const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : null;
    const recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : null;
    const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : null;
    return { ...c, precision, recall, f1, flagged: items.filter((i) => i.score >= th).length };
  };
  const curve = Array.from({ length: 21 }, (_, k) => ({ threshold: k * 5, ...confusion(k * 5) }));
  res.json({ threshold: t, current, total: items.length, labeled: labeled.length, at: confusion(t), curve, items });
});

r.get('/search', async (req, res) => {
  const { q: term, type } = parse(z.object({ q: z.string().trim().min(2).max(200), type: z.enum(['all', 'entities', 'materials', 'registry']).default('all') }), req.query);
  const out = {};
  if (type === 'all' || type === 'entities') {
    out.entities = await q(
      `SELECT id, name, kind, registry_status, similarity(name_norm, lower(unaccent($1))) AS sim FROM entities
        WHERE name_norm % lower(unaccent($1)) OR name_norm ILIKE '%' || lower(unaccent($1)) || '%' ORDER BY sim DESC LIMIT 20`, [term]);
  }
  if (type === 'all' || type === 'materials') {
    out.materials = await q(
      `SELECT m.id, m.title, m.url, m.author, m.platform, a.score,
              substring(m.content_text from greatest(position(lower($1) in lower(m.content_text)) - 60, 1) for 200) AS snippet
         FROM materials m ${LATEST}
        WHERE m.title ILIKE '%' || $1 || '%' OR m.url ILIKE '%' || $1 || '%' OR m.author ILIKE '%' || $1 || '%' OR m.content_text ILIKE '%' || $1 || '%'
        ORDER BY a.score DESC LIMIT 30`, [term]);
  }
  if (type === 'all' || type === 'registry') {
    out.registry = await analyzer.registrySearch(term).catch(() => []);
  }
  res.json(out);
});

r.get('/entities', async (_req, res) => {
  res.json(await q(
    `SELECT e.id, e.name, e.kind, e.registry_status, e.country, count(me.material_id)::int AS materials,
            max(a.score) AS max_score
       FROM entities e LEFT JOIN material_entities me ON me.entity_id = e.id
       LEFT JOIN LATERAL (SELECT score FROM analyses WHERE material_id = me.material_id ORDER BY created_at DESC LIMIT 1) a ON TRUE
      GROUP BY e.id ORDER BY max_score DESC NULLS LAST LIMIT 300`));
});

r.get('/entities/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const t = await getThreshold();
  const e = await one('SELECT * FROM entities WHERE id = $1', [id]);
  if (!e) return res.status(404).json({ error: 'Nie znaleziono podmiotu' });
  const registry = await q('SELECT DISTINCT ON (registry) * FROM registry_records WHERE entity_id = $1 ORDER BY registry, checked_at DESC', [id]);
  const materials = await q(
    `SELECT m.id, m.title, m.url, m.platform, m.fetched_at, me.role, a.score, ${riskSql()} AS risk
       FROM material_entities me JOIN materials m ON m.id = me.material_id ${LATEST}
      WHERE me.entity_id = $2 ORDER BY m.fetched_at DESC`, [t, id]);
  const persons = await q(
    'SELECT p.id, p.full_name, pl.role, pl.source_url, pl.verification FROM person_links pl JOIN persons p ON p.id = pl.person_id WHERE pl.entity_id = $1', [id]);
  const timeline = await q(
    `SELECT to_char(date_trunc('month', m.fetched_at), 'YYYY-MM') AS month, count(*)::int AS n
       FROM material_entities me JOIN materials m ON m.id = me.material_id WHERE me.entity_id = $1 GROUP BY 1 ORDER BY 1`, [id]);
  res.json({ entity: e, registry, materials, persons, timeline });
});

r.get('/entities/:id/crisis', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const periods = await q('SELECT * FROM crisis_periods ORDER BY start_date');
  const rows = await q('SELECT * FROM company_crisis_behavior WHERE entity_id = $1', [id]);
  res.json(periods.map((p) => ({ period: p, behavior: rows.find((r) => r.crisis_id === p.id) ?? null, status: rows.some((r) => r.crisis_id === p.id) ? 'ok' : 'brak danych' })));
});

r.get('/entities/:id/reserves', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const rows = await q('SELECT * FROM reserves_reports WHERE entity_id = $1 ORDER BY report_date DESC', [id]);
  res.json({ status: rows.length ? 'ok' : 'brak danych', note: 'Dane o rezerwach to deklaracja podmiotu, nie audyt.', reports: rows });
});

r.get('/rules', async (_req, res) => res.json(await analyzer.rules()));

export default r;
