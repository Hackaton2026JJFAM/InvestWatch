// Wzbogacanie podmiotów: KRS (dane rejestrowe, osoby), GLEIF (LEI), listy ostrzeżeń KNF i rejestr MiCA ESMA.
// Wyniki trafiają do registry_records (historia), persons/person_links (status „wymaga weryfikacji”).
import { config } from './config.js';
import { one, q, tx } from './db.js';
import { log } from './log.js';
import { emit } from './realtime.js';
import { analyzer, UpstreamError } from './services.js';

const KRS_RX = /^[0-9]{10}$/;

// Numery KRS z materiałów powiązanych z podmiotem (wykryte przez analizator) – propozycje dla analityka.
export async function krsCandidates(entityId) {
  const rows = await q(
    `SELECT DISTINCT jsonb_array_elements_text(a.result->'doc'->'identifiers'->'krs') AS krs
       FROM material_entities me
       JOIN LATERAL (SELECT result FROM analyses WHERE material_id = me.material_id ORDER BY created_at DESC LIMIT 1) a ON TRUE
      WHERE me.entity_id = $1`, [entityId]);
  return rows.map((r) => r.krs);
}

async function record(t, entityId, registry, status, data, country = null) {
  await t.q('INSERT INTO registry_records (entity_id, registry, country, status, data) VALUES ($1, $2, $3, $4, $5)',
    [entityId, registry, country, status, data]);
}

export async function enrichEntity(entityId, { krs = null, lei = null } = {}) {
  const e = await one('SELECT * FROM entities WHERE id = $1', [entityId]);
  if (!e) return null;
  const candidates = await krsCandidates(entityId);
  const krsNumber = krs ?? e.krs ?? (candidates.length === 1 ? candidates[0] : null);
  const out = { krs: null, gleif: null, watchlists: null, errors: [] };

  if (krsNumber && KRS_RX.test(krsNumber)) {
    try {
      out.krs = await analyzer.enrichKrs(krsNumber);
    } catch (err) {
      out.errors.push(`KRS: ${err.message}`);
      if (err instanceof UpstreamError && err.status === 404) out.krs = { notFound: true, krs: krsNumber };
    }
  }
  if (e.kind === 'company' || lei) {
    try {
      const name = out.krs?.name ?? e.name;
      out.gleif = await analyzer.enrichGleif(lei ? { lei } : { name });
    } catch (err) {
      out.errors.push(`GLEIF: ${err.message}`);
    }
  }
  try {
    out.watchlists = await analyzer.watchCheck({ name: out.krs?.name ?? e.name, domain: e.domain ?? undefined, krs: krsNumber ?? undefined, nip: out.krs?.nip ?? e.nip ?? undefined });
  } catch (err) {
    out.errors.push(`Listy ostrzeżeń: ${err.message}`);
  }

  await tx(async (t) => {
    if (out.krs?.notFound) await record(t, entityId, 'krs', 'not_found', { krs: out.krs.krs });
    else if (out.krs) {
      await record(t, entityId, 'krs', 'found', out.krs, 'PL');
      await t.q('UPDATE entities SET krs = $2, nip = COALESCE($3, nip) WHERE id = $1', [entityId, out.krs.krs, out.krs.nip]);
      // osoby z KRS: zastępujemy poprzedni odczyt; dane w publicznym API są zanonimizowane
      await t.q("DELETE FROM persons WHERE source = 'krs' AND id IN (SELECT person_id FROM person_links WHERE entity_id = $1)", [entityId]);
      for (const p of [...out.krs.persons, ...out.krs.shareholders]) {
        const person = await t.one("INSERT INTO persons (full_name, source, masked) VALUES ($1, 'krs', $2) RETURNING id", [p.name ?? '(brak danych)', p.masked]);
        await t.q('INSERT INTO person_links (person_id, entity_id, role, source_url) VALUES ($1, $2, $3, $4)',
          [person.id, entityId, [p.function, p.role].filter(Boolean).join(' · '), out.krs.source_url]);
      }
    }
    if (out.gleif) {
      const exact = out.gleif.find((g) => g.name && g.name.toLowerCase() === (out.krs?.name ?? e.name).toLowerCase());
      await record(t, entityId, 'gleif', out.gleif.length ? 'found' : 'not_found', { records: out.gleif, exact: exact?.lei ?? null }, exact?.country ?? null);
      if (exact) await t.q('UPDATE entities SET lei = $2, country = COALESCE(country, $3) WHERE id = $1', [entityId, exact.lei, exact.country]);
    }
    if (out.watchlists) {
      const by = (l) => out.watchlists.hits.filter((h) => h.list === l);
      await record(t, entityId, 'knf_warnings', by('knf_warnings').length ? 'found' : 'not_found', { hits: by('knf_warnings'), meta: out.watchlists.meta.knf_warnings });
      await record(t, entityId, 'esma_mica', by('esma_ncasp').length || by('esma_casp').length ? 'found' : 'not_found',
        { casp: by('esma_casp'), ncasp: by('esma_ncasp'), meta: out.watchlists.meta.esma_mica });
    }
    await t.q('UPDATE entities SET enriched_at = now() WHERE id = $1', [entityId]);
  });
  emit('entity:enriched', { id: entityId });
  return { ...out, krsUsed: krsNumber, candidates };
}

// Automatyczne wzbogacanie nowych spółek w tle – kolejka szeregowa, 1 podmiot na 2 s (oszczędnie wobec API).
const pending = [];
let running = false;
export function scheduleEnrichment(entityId) {
  if (!config.enrichAuto || pending.includes(entityId)) return;
  pending.push(entityId);
  if (running) return;
  running = true;
  (async () => {
    while (pending.length) {
      const id = pending.shift();
      const e = await one('SELECT enriched_at FROM entities WHERE id = $1', [id]).catch(() => null);
      if (e && !e.enriched_at) {
        await enrichEntity(id).catch((err) => log.warn('auto enrichment failed', { entityId: id, err: err.message }));
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    running = false;
  })();
}
