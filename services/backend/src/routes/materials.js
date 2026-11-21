import { Router } from 'express';
import { saveReach } from '../reach.js';
import { isKnownKey, KEY_RX, summaryPoints, withoutRejected } from '../review.js';
import { z } from 'zod';
import { getThreshold, one, q, tx } from '../db.js';
import { emit } from '../realtime.js';
import { analyzer } from '../services.js';
import { findSimilar } from '../similarity.js';
import { requireAdmin } from '../auth.js';
import { parse, riskLevel, aboveSql, riskSql } from '../validate.js';

const r = Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const STATUSES = ['NEW', 'IN_REVIEW', 'REVIEWED', 'ESCALATED', 'DISMISSED'];
const PROFILES = ['podejrzenie_oszustwa', 'płatna_promocja', 'autoreklama', 'doradca_finansowy', 'edukacja', 'informacja'];
const LATEST = 'JOIN LATERAL (SELECT * FROM analyses WHERE material_id = m.id ORDER BY created_at DESC LIMIT 1) a ON TRUE';
const rejectedOf = async (materialId) => (await q('SELECT rule_id FROM finding_reviews WHERE material_id = $1 AND decision = \'rejected\'', [materialId])).map((x) => x.rule_id);

// wynik i profil po weryfikacji analityka (ręcznie ustawiony profil ma pierwszeństwo)
async function storeReview(db, id, result, rejected) {
  const reviewed = rejected.length ? withoutRejected(result, rejected) : null;
  const p = (reviewed ?? result).profile;
  await db.q('UPDATE materials SET reviewed_score = $2, profile_type = COALESCE(profile_manual, $3), scam_score = $4 WHERE id = $1',
    [id, reviewed ? reviewed.score : null, p?.primary ?? null, p?.scam_score ?? null]);
  return reviewed;
}

r.get('/materials', async (req, res) => {
  const f = parse(z.object({
    from: z.iso.date().optional(), to: z.iso.date().optional(),
    platform: z.string().max(30).optional(), module: z.enum(['m1', 'm2', 'm3']).optional(),
    risk: z.enum(['wysokie', 'średnie', 'niskie']).optional(), status: z.enum(STATUSES).optional(),
    q: z.string().max(200).optional(), domain: z.string().max(200).optional(),
    // zasięg / popularność i profil publikującego
    above: z.enum(['1', 'true']).optional(), min_views: z.coerce.number().int().min(0).optional(),
    min_followers: z.coerce.number().int().min(0).optional(), tag: z.string().max(60).optional(),
    profile: z.enum(PROFILES).optional(),
    media: z.enum(['video', 'image', 'web']).optional(), watch: z.coerce.number().int().positive().optional(),
    lang: z.enum(['pl', 'other']).optional(),
    sort: z.enum(['score', 'fetched_at', 'title', 'views', 'priority']).default('fetched_at'), dir: z.enum(['asc', 'desc']).default('desc'),
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
  if (f.above) where.push('a.score >= $1');
  if (f.min_views != null) add('m.views >= ?', f.min_views);
  if (f.min_followers != null) add('m.followers >= ?', f.min_followers);
  if (f.tag) add('? = ANY(m.tags)', f.tag.toLowerCase().replace(/^#+/, ''));
  if (f.profile) add('m.profile_type = ?', f.profile);
  if (f.watch) add('m.watch_id = ?', f.watch);
  if (f.lang === 'pl') where.push("m.lang = 'pl'");
  if (f.lang === 'other') where.push("coalesce(m.lang, '') <> 'pl'");
  if (f.media === 'video') where.push("m.raw->'layout' ? 'video'");
  if (f.media === 'image') where.push("m.raw->'layout'->>'engine' = 'ocr'");
  if (f.media === 'web') where.push("NOT (m.raw->'layout' ? 'video') AND coalesce(m.raw->'layout'->>'engine', '') <> 'ocr'");
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // $1 (próg) musi wystąpić w zapytaniu także wtedy, gdy nie filtrujemy po ryzyku
  const total = (await one(`SELECT count(*)::int AS n, max($1::numeric) AS threshold FROM materials m ${LATEST} ${w}`, params)).n;
  // priorytet = ryzyko × log(zasięg): wysoki wynik u popularnego twórcy na górze listy
  const sortCol = { score: 'a.score', fetched_at: 'm.fetched_at', title: 'm.title', views: 'm.views',
    priority: 'a.score * (1 + log(greatest(coalesce(m.views, 0), 1)))' }[f.sort];
  params.push(f.size, (f.page - 1) * f.size);
  const items = await q(
    `SELECT m.id, m.url, m.title, m.author, m.platform, m.status, m.fetched_at, m.ground_truth, m.near_duplicate_of,
            m.views, m.followers, m.tags, m.profile_type, m.scam_score, (m.raw->'layout' ? 'video') AS is_video,
            a.id AS analysis_id, a.score, a.modules, a.module_scores, ${riskSql()} AS risk, ${aboveSql()} AS above_threshold
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
  const { layout = {}, content_text: _c, full_text: _f, transcript: _t, ...meta } = m.raw ?? {};
  // wideo: transkrypcja z czasami i napisy z klatek z czasem widoczności na ekranie
  const video = layout.video ? {
    duration: layout.video.duration, frames_sampled: layout.video.frames_sampled, frames_with_text: layout.video.frames_with_text,
    frame_times: layout.video.frame_times ?? [], meta: layout.video.meta ?? null,
    transcript: layout.video.transcript ? { language: layout.video.transcript.language, model: layout.video.transcript.model,
      segments: layout.video.transcript.segments ?? [], no_audio: layout.video.transcript.no_audio ?? false } : null,
    captions: (layout.viewports?.desktop?.blocks ?? []).filter((b) => b.video_t != null)
      .map((b) => ({ text: b.text, t: b.video_t, seen_s: b.seen_s, font_size: b.font_size, contrast: b.contrast })),
  } : null;
  const viewports = Object.fromEntries(Object.entries(layout.viewports ?? {}).map(([k, v]) => [k, { width: v.width, height: v.height, page_height: v.page_height, screenshot_height: v.screenshot_height ?? null, blocks: v.blocks?.length ?? 0 }]));
  res.json({
    material: { ...m, raw: undefined, meta: { ...meta, links: undefined }, screenshot: layout.screenshot ?? null, layout_engine: layout.engine ?? 'none', layout_reason: layout.reason ?? null,
      consent_hidden: layout.consent_hidden ?? 0, viewports,
      video, image_ocr: layout.image_ocr ?? null },
    analysis: analyses[0] ? { ...analyses[0], result: latest.result } : null,
    history: analyses, findings, entities, alerts, threshold, rejected: await rejectedOf(id),
    similar: await findSimilar(m.simhash, { excludeId: m.id }),
    risk: analyses[0] ? riskLevel(analyses[0].score) : null,
    above_threshold: analyses[0] ? analyses[0].score >= threshold : null,
  });
});

r.patch('/materials/:id/status', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const { status } = parse(z.object({ status: z.enum(STATUSES) }), req.body);
  const row = await one('UPDATE materials SET status = $2 WHERE id = $1 RETURNING id, status', [id, status]);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono materiału' });
  if (status === 'IN_REVIEW') {
    // w trakcie weryfikacji: alert przeczytany, ale nadal otwarty
    const changed = await q("UPDATE alerts SET read = TRUE WHERE material_id = $1 AND status = 'NEW' AND NOT read RETURNING id", [id]);
    if (changed.length) emit('alert:update', { materialId: id, alerts: changed.map((x) => x.id) });
  } else if (status !== 'NEW') {
    const changed = await q("UPDATE alerts SET status = $2, read = TRUE WHERE material_id = $1 AND status = 'NEW' RETURNING id", [id, status === 'DISMISSED' ? 'DISMISSED' : 'REVIEWED']);
    if (changed.length) emit('alert:update', { materialId: id, alerts: changed.map((a) => a.id) });
  }
  emit('material:status', row);
  res.json(row);
});

r.delete('/materials/:id', requireAdmin, async (req, res) => {
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
    await saveReach(t, id, m.raw, result);
    return row;
  });
  if (result.doc?.simhash) await q('UPDATE materials SET simhash = $2 WHERE id = $1', [id, result.doc.simhash]);
  // odrzucenia analityka obowiązują także po ponownej analizie
  const reviewed = await storeReview({ q }, id, result, await rejectedOf(id));
  const s = await analyzer.summary(reviewed ?? result).catch(() => null);
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
  const a = await one('SELECT id, score, result, summary, summary_engine FROM analyses WHERE material_id = $1 ORDER BY created_at DESC LIMIT 1', [materialId]);
  if (!a) return res.status(404).json({ error: 'Brak analizy' });
  const rejected = await rejectedOf(materialId);
  const reviewed = rejected.length ? withoutRejected(a.result, rejected) : null;
  let s = { summary: a.summary, engine: a.summary_engine };
  if (!a.summary || req.query.refresh === '1') {
    s = await analyzer.summary(reviewed ?? a.result);
    await q('UPDATE analyses SET summary = $2, summary_engine = $3 WHERE id = $1', [a.id, s.summary, s.engine]);
  }
  res.json({ ...s, points: summaryPoints(a.result, rejected), score: Number(a.score), reviewed_score: reviewed ? reviewed.score : null });
});

// Odrzucenie wybranych punktów podsumowania (pełny zestaw odrzuconych reguł; pusta lista = przywrócenie wszystkich)
r.put('/materials/:id/review', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const b = parse(z.object({ rejected: z.array(z.string().regex(KEY_RX)).max(120), note: z.string().max(500).optional() }), req.body);
  const a = await one('SELECT id, score, result FROM analyses WHERE material_id = $1 ORDER BY created_at DESC LIMIT 1', [id]);
  if (!a) return res.status(404).json({ error: 'Brak analizy' });
  // klucz „reguła” = cała przesłanka, „reguła:element” = pojedynczy sygnał/fragment
  const rejected = [...new Set(b.rejected)].filter((k) => isKnownKey(a.result, k));
  const reviewed = rejected.length ? withoutRejected(a.result, rejected) : null;
  const s = await analyzer.summary(reviewed ?? a.result).catch(() => null);
  await tx(async (t) => {
    await t.q('DELETE FROM finding_reviews WHERE material_id = $1 AND NOT (rule_id = ANY($2))', [id, rejected]);
    for (const rule of rejected) {
      await t.q(`INSERT INTO finding_reviews (material_id, rule_id, note) VALUES ($1, $2, $3)
                 ON CONFLICT (material_id, rule_id) DO UPDATE SET note = COALESCE(EXCLUDED.note, finding_reviews.note)`, [id, rule, b.note ?? null]);
    }
    await storeReview(t, id, a.result, rejected);
    if (s) await t.q('UPDATE analyses SET summary = $2, summary_engine = $3 WHERE id = $1', [a.id, s.summary, s.engine]);
  });
  emit('material:status', { id });
  res.json({ rejected, reviewed_score: reviewed ? reviewed.score : null, score: Number(a.score), summary: s?.summary ?? null,
    points: summaryPoints(a.result, rejected), profile: reviewed?.profile?.primary ?? a.result.profile?.primary ?? null });
});

// Ręczne oznaczenie profilu treści (np. „autoreklama”); null = powrót do klasyfikacji automatycznej
r.put('/materials/:id/profile', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const { profile } = parse(z.object({ profile: z.enum(PROFILES).nullable() }), req.body);
  const a = await one('SELECT result FROM analyses WHERE material_id = $1 ORDER BY created_at DESC LIMIT 1', [id]);
  const row = await one('UPDATE materials SET profile_manual = $2 WHERE id = $1 RETURNING id', [id, profile]);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono materiału' });
  if (a) await storeReview({ q }, id, a.result, await rejectedOf(id));
  else await q('UPDATE materials SET profile_type = COALESCE(profile_manual, profile_type) WHERE id = $1', [id]);
  const m = await one('SELECT id, profile_type, profile_manual FROM materials WHERE id = $1', [id]);
  emit('material:status', { id });
  res.json(m);
});

export default r;
