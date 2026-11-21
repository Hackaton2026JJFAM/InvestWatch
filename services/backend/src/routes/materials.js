import { Router } from 'express';
import { z } from 'zod';
import { getThreshold, one, q, tx } from '../db.js';
import { emit } from '../realtime.js';
import { analyzer } from '../services.js';
import { findSimilar } from '../similarity.js';
import { parse, riskSql } from '../validate.js';

const r = Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const STATUSES = ['NEW', 'REVIEWED', 'ESCALATED', 'DISMISSED'];
const LATEST = 'JOIN LATERAL (SELECT * FROM analyses WHERE material_id = m.id ORDER BY created_at DESC LIMIT 1) a ON TRUE';

r.get('/materials', async (req, res) => {
  const f = parse(z.object({
    from: z.iso.date().optional(), to: z.iso.date().optional(),
    platform: z.string().max(30).optional(), module: z.enum(['m1', 'm2', 'm3']).optional(),
    risk: z.enum(['wysokie', 'średnie', 'niskie']).optional(), status: z.enum(STATUSES).optional(),
    q: z.string().max(200).optional(), domain: z.string().max(200).optional(),
    sort: z.enum(['score', 'fetched_at', 'title']).default('fetched_at'), dir: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1), size: z.coerce.number().int().min(1).max(200).default(50),
  }), req.query);
  const threshold = await getThreshold();
  const where = [];
  const params = [threshold];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
  if (f.from) add('m.fetched_at >= ?::date', f.from);
  if (f.to) add("m.fetched_at < ?::date + interval '1 day'", f.to);
  if (f.platform) add('m.platform = ?', f.platform);
  if (f.module) add('? = ANY(a.modules)', f.module);
  if (f.risk) add(`${riskSql()} = ?`, f.risk);
  if (f.status) add('m.status = ?', f.status);
  if (f.q) add("(m.title ILIKE '%' || ? || '%' OR m.url ILIKE '%' || ? || '%')", f.q);
  if (f.domain) add("m.url ILIKE '%' || ? || '%'", f.domain);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // $1 (próg) musi wystąpić w zapytaniu także wtedy, gdy nie filtrujemy po ryzyku
  const total = (await one(`SELECT count(*)::int AS n, max($1::numeric) AS threshold FROM materials m ${LATEST} ${w}`, params)).n;
  const sortCol = { score: 'a.score', fetched_at: 'm.fetched_at', title: 'm.title' }[f.sort];
  params.push(f.size, (f.page - 1) * f.size);
  const items = await q(
    `SELECT m.id, m.url, m.title, m.author, m.platform, m.status, m.fetched_at, m.ground_truth, m.near_duplicate_of,
            a.id AS analysis_id, a.score, a.modules, a.module_scores, ${riskSql()} AS risk
       FROM materials m ${LATEST} ${w}
      ORDER BY ${sortCol} ${f.dir} NULLS LAST, m.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({ total, page: f.page, size: f.size, threshold, items });
});

r.get('/materials/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const threshold = await getThreshold();
  const m = await one('SELECT * FROM materials WHERE id = $1', [id]);
  if (!m) return res.status(404).json({ error: 'Nie znaleziono materiału' });
  const analyses = await q('SELECT id, score, module_scores, modules, summary, summary_engine, analyzer_version, created_at FROM analyses WHERE material_id = $1 ORDER BY created_at DESC', [id]);
  const latest = analyses[0] ? await one('SELECT result FROM analyses WHERE id = $1', [analyses[0].id]) : null;
  const findings = analyses[0] ? await q('SELECT * FROM findings WHERE analysis_id = $1 ORDER BY id', [analyses[0].id]) : [];
  const entities = await q(
    `SELECT e.id, e.name, e.kind, e.registry_status, me.role FROM material_entities me JOIN entities e ON e.id = me.entity_id WHERE me.material_id = $1`, [id]);
  const alerts = await q('SELECT * FROM alerts WHERE material_id = $1 ORDER BY id DESC', [id]);
  const { layout = {}, content_text: _c, full_text: _f, ...meta } = m.raw ?? {};
  const viewports = Object.fromEntries(Object.entries(layout.viewports ?? {}).map(([k, v]) => [k, { width: v.width, height: v.height, page_height: v.page_height, screenshot_height: v.screenshot_height ?? null, blocks: v.blocks?.length ?? 0 }]));
  res.json({
    material: { ...m, raw: undefined, meta: { ...meta, links: undefined }, screenshot: layout.screenshot ?? null, layout_engine: layout.engine ?? 'none', viewports },
    analysis: analyses[0] ? { ...analyses[0], result: latest.result } : null,
    history: analyses, findings, entities, alerts, threshold,
    similar: await findSimilar(m.simhash, { excludeId: m.id }),
    risk: analyses[0] ? (analyses[0].score >= threshold ? 'wysokie' : analyses[0].score >= threshold * 0.6 ? 'średnie' : 'niskie') : null,
  });
});

r.patch('/materials/:id/status', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const { status } = parse(z.object({ status: z.enum(STATUSES) }), req.body);
  const row = await one('UPDATE materials SET status = $2 WHERE id = $1 RETURNING id, status', [id, status]);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono materiału' });
  if (status !== 'NEW') await q("UPDATE alerts SET status = $2, read = TRUE WHERE material_id = $1 AND status = 'NEW'", [id, status === 'DISMISSED' ? 'DISMISSED' : 'REVIEWED']);
  emit('material:status', row);
  res.json(row);
});

r.delete('/materials/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const row = await one('DELETE FROM materials WHERE id = $1 RETURNING id', [id]);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono materiału' });
  await q("DELETE FROM entities e WHERE NOT EXISTS (SELECT 1 FROM material_entities me WHERE me.entity_id = e.id) AND e.kind IN ('influencer', 'unknown')");
  emit('material:deleted', row);
  res.status(204).end();
});

r.patch('/materials/:id/label', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const { ground_truth } = parse(z.object({ ground_truth: z.boolean().nullable() }), req.body);
  const row = await one('UPDATE materials SET ground_truth = $2 WHERE id = $1 RETURNING id, ground_truth', [id, ground_truth]);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono materiału' });
  res.json(row);
});

// Ponowna analiza zapisanej treści (np. po aktualizacji reguł) – zachowuje historię analiz.
r.post('/materials/:id/reanalyze', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const m = await one('SELECT raw FROM materials WHERE id = $1', [id]);
  if (!m) return res.status(404).json({ error: 'Nie znaleziono materiału' });
  const { screenshot: _s, ...layout } = m.raw.layout ?? {};
  const result = await analyzer.analyze({ ...m.raw, layout });
  const a = await tx(async (t) => {
    const row = await t.one('INSERT INTO analyses (material_id, score, module_scores, modules, result, analyzer_version) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, score, created_at',
      [id, result.score, result.module_scores, result.modules, result, result.analyzer_version]);
    for (const f of result.findings) {
      await t.q('INSERT INTO findings (analysis_id, module, rule_id, status, severity, title, legal_basis, explanation, evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [row.id, f.module, f.rule_id, f.status, f.severity, f.title, f.legal_basis, f.explanation, JSON.stringify(f.evidence)]);
    }
    return row;
  });
  if (result.doc?.simhash) await q('UPDATE materials SET simhash = $2 WHERE id = $1', [id, result.doc.simhash]);
  const s = await analyzer.summary(result).catch(() => null);
  if (s) await q('UPDATE analyses SET summary = $2, summary_engine = $3 WHERE id = $1', [a.id, s.summary, s.engine]);
  res.json(a);
});

r.get('/analyses/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const a = await one('SELECT * FROM analyses WHERE id = $1', [id]);
  if (!a) return res.status(404).json({ error: 'Nie znaleziono analizy' });
  res.json({ ...a, findings: await q('SELECT * FROM findings WHERE analysis_id = $1 ORDER BY id', [id]) });
});

r.get('/summary/:materialId', async (req, res) => {
  const { materialId } = parse(z.object({ materialId: z.coerce.number().int().positive() }), req.params);
  const a = await one('SELECT id, result, summary, summary_engine FROM analyses WHERE material_id = $1 ORDER BY created_at DESC LIMIT 1', [materialId]);
  if (!a) return res.status(404).json({ error: 'Brak analizy' });
  if (a.summary && req.query.refresh !== '1') return res.json({ summary: a.summary, engine: a.summary_engine });
  const s = await analyzer.summary(a.result);
  await q('UPDATE analyses SET summary = $2, summary_engine = $3 WHERE id = $1', [a.id, s.summary, s.engine]);
  res.json(s);
});

export default r;
