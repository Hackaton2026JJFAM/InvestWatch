// Przetwarzanie zadania: scraper -> deduplikacja -> analyzer -> zapis -> alert -> WebSocket.
import { verifiedAdvisorFor } from './advisors.js';
import { excludedBy, foreignLang, getExcludes, getPolishOnly } from './exclude.js';
import { UnrecoverableError } from 'bullmq';
import { getThreshold, one, q, tx } from './db.js';
import { log } from './log.js';
import { analyzer, scraper, UpstreamError } from './services.js';
import { emit } from './realtime.js';
import { scheduleEnrichment } from './enrichment.js';
import { findSimilar, NEAR_DUP_BITS } from './similarity.js';
import { isVideoUrl, removeUpload } from './video.js';
import { saveReach } from './reach.js';

const VIDEO_REFRESH_DAYS = Number(process.env.VIDEO_REFRESH_DAYS ?? 7);

const normName = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/\s+/g, ' ').trim();

async function fetchMaterial(data) {
  if (data.kind === 'url') return scraper.url(data.url);
  if (data.kind === 'html') {
    const meta = Object.fromEntries(Object.entries({ title: data.title, author: data.author, platform: data.platform }).filter(([, v]) => v));
    return scraper.html(data.html, data.url, meta);
  }
  if (data.kind === 'video') {
    const meta = Object.fromEntries(Object.entries({ url: data.url, title: data.title, author: data.author, platform: data.platform }).filter(([, v]) => v));
    return scraper.videoFile(data.file, meta);
  }
  if (data.kind === 'image') {
    const meta = Object.fromEntries(Object.entries({ title: data.title, author: data.author, platform: data.platform }).filter(([, v]) => v));
    return scraper.image({ image: data.image, url: data.url, ...meta });
  }
  return scraper.text({ text: data.text, url: data.url, title: data.title, author: data.author, platform: data.platform });
}

async function upsertEntity(t, { name, kind, country = null, domain = null, registryStatus = 'unknown', registryRef = null }) {
  return t.one(
    `INSERT INTO entities (name, name_norm, kind, country, domain, registry_status, registry_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (name_norm, kind) DO UPDATE SET
       registry_status = CASE WHEN EXCLUDED.registry_status <> 'unknown' THEN EXCLUDED.registry_status ELSE entities.registry_status END,
       registry_ref = COALESCE(EXCLUDED.registry_ref, entities.registry_ref),
       domain = COALESCE(entities.domain, EXCLUDED.domain),
       country = COALESCE(entities.country, EXCLUDED.country)
     RETURNING id`,
    [name, normName(name), kind, country, domain, registryStatus, registryRef],
  );
}

const newEntities = new Set();

async function saveEntities(t, materialId, result) {
  const links = [];
  for (const f of result.m1?.firms ?? []) {
    const e = await upsertEntity(t, { name: f.name, kind: 'company', country: f.country, registryStatus: f.demo ? 'demo' : 'registered', registryRef: f });
    links.push([e.id, 'advertised_firm']);
    await t.q(`INSERT INTO registry_records (entity_id, registry, country, status, data) VALUES ($1, $2, $3, $4, $5)`,
      [e.id, f.demo ? 'demo' : 'knf', f.country, f.demo ? 'demo' : 'found', f]);
  }
  const pub = result.m1?.publisher;
  if (pub?.name && pub.type === 'podmiot_trzeci') {
    const kind = ['tiktok', 'instagram', 'youtube', 'facebook', 'x'].includes(pub.platform) ? 'influencer' : 'unknown';
    const e = await upsertEntity(t, { name: pub.name, kind });
    links.push([e.id, 'publisher']);
  }
  for (const ent of result.m3?.entities ?? []) {
    const found = Boolean(ent.registry_match);
    const regStatus = found ? (ent.registry_match.demo ? 'demo' : 'registered') : 'not_found';
    const e = await upsertEntity(t, { name: ent.name, kind: 'company', registryStatus: regStatus, registryRef: ent.registry_match });
    links.push([e.id, 'advisor']);
    await t.q(`INSERT INTO registry_records (entity_id, registry, status, data) VALUES ($1, 'knf', $2, $3)`,
      [e.id, found ? (ent.registry_match.demo ? 'demo' : 'found') : 'not_found', ent.registry_match]);
  }
  for (const [entityId] of links) newEntities.add(entityId);
  for (const [entityId, role] of links) {
    await t.q('INSERT INTO material_entities (material_id, entity_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [materialId, entityId, role]);
  }
}

export async function processScan(job) {
  const data = job.data;
  const jobId = data.scanJobId;
  await q("UPDATE scan_jobs SET status = 'running', attempts = attempts + 1 WHERE id = $1", [jobId]);
  emit('scan:update', { id: jobId, status: 'running' });

  // wideo już przeanalizowane niedawno – bez ponownego pobierania i transkrypcji (oszczędność przy monitoringu)
  if (data.kind === 'url' && isVideoUrl(data.url) && !data.force) {
    const known = await one(`SELECT id FROM materials WHERE (url = $1 OR final_url = $1) AND fetched_at > now() - make_interval(days => $2)
                              ORDER BY fetched_at DESC LIMIT 1`, [data.url, VIDEO_REFRESH_DAYS]);
    if (known) {
      await q("UPDATE scan_jobs SET status = 'duplicate', material_id = $2, finished_at = now() WHERE id = $1", [jobId, known.id]);
      emit('scan:update', { id: jobId, status: 'duplicate', materialId: known.id });
      return { duplicate: true, materialId: known.id };
    }
  }

  // monitoring / wyszukiwanie: wykluczone słowa (np. gry) – najpierw po tytule z wyszukiwania (bez pobierania),
  // potem po pełnym tytule, opisie i tagach pobranego materiału. Ręcznie zlecona analiza nie jest filtrowana.
  const auto = Boolean(data.watchId || data.discover);
  const excludes = auto ? await getExcludes() : [];
  const polishOnly = auto && await getPolishOnly();
  const skip = async (word, reason = `wykluczone słowo: ${word}`) => {
    await q("UPDATE scan_jobs SET status = 'excluded', error = $2, finished_at = now() WHERE id = $1", [jobId, reason]);
    emit('scan:update', { id: jobId, status: 'excluded' });
    log.info('scan excluded', { jobId, url: data.url, word });
    return { excluded: word };
  };
  if (auto && data.title) {
    const w = excludedBy({ title: data.title }, excludes);
    if (w) return skip(w);
  }

  let material;
  try {
    material = await fetchMaterial(data);
  } catch (err) {
    if (data.kind === 'video' && !(err instanceof UpstreamError && err.retryable)) await removeUpload(data.file);
    return fail(jobId, err, job);
  }
  if (data.kind === 'video') await removeUpload(data.file); // plik nie jest już potrzebny
  if (auto) {
    const meta = material.video_meta ?? material.layout?.video?.meta ?? {};
    const w = excludedBy({ title: material.title, author: material.author, description: material.description, tags: meta.tags ?? [] }, excludes);
    if (w) return skip(w);
    const l = polishOnly && foreignLang(material.lang);
    if (l) return skip(`język ${l}`, `nie po polsku (język: ${l}) – monitoring zbiera tylko polskie materiały`);
  }

  // duplikat = ten sam URL, ta sama treść i ten sam wygląd ostrzeżeń; zmiana samego CSS tworzy nową wersję
  const dup = await one('SELECT id FROM materials WHERE url = $1 AND content_hash = $2 AND layout_hash IS NOT DISTINCT FROM $3',
    [material.url, material.content_hash, material.layout_hash ?? null]);
  if (dup) {
    await q("UPDATE scan_jobs SET status = 'duplicate', material_id = $2, finished_at = now() WHERE id = $1", [jobId, dup.id]);
    emit('scan:update', { id: jobId, status: 'duplicate', materialId: dup.id });
    return { duplicate: true, materialId: dup.id };
  }

  const { screenshot, ...layoutNoShot } = material.layout ?? {};
  let result;
  try {
    result = await analyzer.analyze({ ...material, layout: layoutNoShot });
  } catch (err) {
    return fail(jobId, err, job);
  }

  // język ustalony dopiero przez analizator (strony bez atrybutu lang, krótkie opisy)
  const lang = polishOnly && foreignLang(result.doc?.lang);
  if (lang) return skip(`język ${lang}`, `nie po polsku (język: ${lang}) – monitoring zbiera tylko polskie materiały`);

  const threshold = await getThreshold();
  const simhash = result.doc?.simhash ?? null;
  const nearDup = (await findSimilar(simhash, { maxBits: NEAR_DUP_BITS, limit: 1 }))[0] ?? null;

  let saved;
  try {
    saved = await save();
  } catch (err) {
    return fail(jobId, err, job);
  }

  async function save() {
    return tx(async (t) => {
    const m = await t.one(
      `INSERT INTO materials (source_id, url, final_url, title, author, published_at, lang, platform, content_text, content_hash, raw, ground_truth, simhash, near_duplicate_of, layout_hash, demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id, fetched_at`,
      [data.sourceId ?? null, material.url, material.final_url, material.title, material.author,
        parseDate(material.published_at), material.lang, material.platform, material.content_text, material.content_hash,
        { ...material, layout: { ...layoutNoShot, screenshot } }, data.groundTruth ?? null, simhash, nearDup?.id ?? null, material.layout_hash ?? null, Boolean(data.demo)],
    );
    const a = await t.one(
      `INSERT INTO analyses (material_id, score, module_scores, modules, result, analyzer_version)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [m.id, result.score, result.module_scores, result.modules, result, result.analyzer_version],
    );
    for (const f of result.findings) {
      await t.q(
        `INSERT INTO findings (analysis_id, module, rule_id, status, severity, title, legal_basis, explanation, evidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [a.id, f.module, f.rule_id, f.status, f.severity, f.title, f.legal_basis, f.explanation, JSON.stringify(f.evidence)],
      );
    }
    await saveEntities(t, m.id, result);
    await saveReach(t, m.id, material, result, data.watchId ?? null);
    let alert = null;
    if (result.score >= threshold) {
      alert = await t.one(
        'INSERT INTO alerts (material_id, analysis_id, score, threshold) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
        [m.id, a.id, result.score, threshold],
      );
    }
    await t.q("UPDATE scan_jobs SET status = 'done', material_id = $2, error = NULL, finished_at = now() WHERE id = $1", [jobId, m.id]);
    return { materialId: m.id, analysisId: a.id, alert };
    });
  }

  // Podsumowanie poza transakcją – wolny LLM nie blokuje zapisu wyników.
  analyzer.summary(result)
    .then((s) => q('UPDATE analyses SET summary = $2, summary_engine = $3 WHERE id = $1', [saved.analysisId, s.summary, s.engine]))
    .catch((err) => log.warn('summary failed', { analysisId: saved.analysisId, err: err.message }));

  // doradca sprawdzony wcześniej przez analityka – od razu wynik po weryfikacji (bez „możliwego braku zezwolenia”)
  try {
    const { priorHistoryFor } = await import('./accounts.js');
    if (await verifiedAdvisorFor(saved.materialId) || (await priorHistoryFor(saved.materialId))?.repeat) {
      await (await import('./routes/materials.js')).storeReviewFor(saved.materialId);
    }
  } catch (err) { log.warn('verified advisor apply failed', { id: saved.materialId, err: err.message }); }

  const payload = { id: saved.materialId, title: material.title, url: material.url, score: result.score, modules: result.modules, platform: material.platform };
  for (const id of newEntities) scheduleEnrichment(id);
  newEntities.clear();
  emit('material:new', payload);
  emit('scan:update', { id: jobId, status: 'done', materialId: saved.materialId });
  if (saved.alert) emit('alert:new', { id: saved.alert.id, materialId: saved.materialId, score: result.score, title: material.title, url: material.url });
  log.info('material analysed', { materialId: saved.materialId, score: result.score, ms: result.elapsed_ms });
  return saved;
}

async function fail(jobId, err, job) {
  const final = !(err instanceof UpstreamError && err.retryable) || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
  await q('UPDATE scan_jobs SET status = $2, error = $3, finished_at = CASE WHEN $2 = \'failed\' THEN now() END WHERE id = $1',
    [jobId, final ? 'failed' : 'queued', err.message.slice(0, 500)]);
  emit('scan:update', { id: jobId, status: final ? 'failed' : 'retrying', error: err.message });
  if (final) throw new UnrecoverableError(err.message);
  throw err;
}

function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
