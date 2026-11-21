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

// Nazwa bez formy prawnej i znaków diakrytycznych – do porównania nazw z KRS/GLEIF i z materiałów.
export function coreName(name = '') {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
    .replace(/\b(spolka akcyjna|spolka z ograniczona odpowiedzialnoscia|spolka komandytowa|s\.?\s?a\.?|sp\.?\s?z\s?o\.?\s?o\.?|sp\.?\s?k\.?|ltd\.?|limited|gmbh|ag|plc|llc|inc\.?)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const PL_FORM = /(^|\s)(s\.\s?a\.?|sp\.\s?z\s?o\.\s?o\.?|sp\.\s?k\.?|spółka|spolka)(\s|$)/i;
export const isPolishForm = (name = '') => PL_FORM.test(name.toLowerCase());
const FOREIGN_FORM = /(^|\s)(ltd\.?|limited|gmbh|ag|plc|llc|inc\.?|b\.v\.|n\.v\.|s\.r\.o\.|a\.s\.|se|sarl|s\.à r\.l\.|oyj|ab|kft)(\s|$)/i;
export const isForeignForm = (name = '') => FOREIGN_FORM.test(name.toLowerCase());

// Rekord GLEIF odpowiadający podmiotowi: podany LEI albo zgodna nazwa (bez formy prawnej);
// przy kilku zgodnych preferowany kraj wynikający z formy prawnej (S.A./sp. z o.o. -> PL).
export function pickGleif(records, name, lei, country = null) {
  if (!records?.length) return null;
  if (lei) return records.find((g) => g.lei === lei) ?? null;
  const target = coreName(name);
  const same = records.filter((g) => coreName(g.name) === target || g.other_names?.some((n) => coreName(n) === target));
  const wantPl = country ? country === 'PL' : isPolishForm(name);
  const preferred = same.find((g) => (g.country === 'PL') === wantPl);
  // forma prawna jednoznacznie wskazuje kraj – nie przypisujemy rekordu z innego kraju (np. polski LEI dla „XTB Ltd”)
  const formKnown = Boolean(country) || isPolishForm(name) || isForeignForm(name);
  return preferred ?? (formKnown ? null : same[0] ?? null);
}

// Wyszukiwanie w GLEIF: dla polskich podmiotów po nazwie bez formy prawnej z filtrem PL, potem po pełnej nazwie.
async function searchGleif(e, lei) {
  if (lei) return analyzer.enrichGleif({ lei });
  const queries = [];
  if (isPolishForm(e.name) || e.country === 'PL') queries.push({ name: coreName(e.name) || e.name, country: 'PL' });
  queries.push({ name: e.name });
  if (coreName(e.name) && coreName(e.name) !== e.name.toLowerCase()) queries.push({ name: coreName(e.name) });
  const seen = new Map();
  for (const qy of queries) {
    for (const g of await analyzer.enrichGleif(qy)) if (!seen.has(g.lei)) seen.set(g.lei, g);
    if (pickGleif([...seen.values()], e.name, null, e.country)) break;
  }
  return [...seen.values()];
}

export async function enrichEntity(entityId, { krs = null, lei = null } = {}) {
  const e = await one('SELECT * FROM entities WHERE id = $1', [entityId]);
  if (!e) return null;
  const candidates = await krsCandidates(entityId);
  let krsNumber = krs ?? e.krs ?? (candidates.length === 1 ? candidates[0] : null);
  let krsSource = krs ? 'podany' : e.krs ? 'zapisany' : krsNumber ? 'z materiału' : null;
  const out = { krs: null, gleif: null, gleifDetail: null, watchlists: null, errors: [] };

  // 1. GLEIF: kod LEI, a dla polskich spółek także numer KRS (urząd rejestrowy RA000484)
  if (e.kind === 'company' || lei || e.lei) {
    try {
      out.gleif = await searchGleif(e, lei || e.lei);
    } catch (err) {
      out.errors.push(`GLEIF: ${err.message}`);
    }
  }
  const exact = pickGleif(out.gleif ?? [], e.name, lei || e.lei, e.country);
  if (!krsNumber && exact?.krs) {
    krsNumber = exact.krs;
    krsSource = 'z GLEIF (LEI)';
  }
  if (exact) {
    try {
      out.gleifDetail = await analyzer.gleifDetail(exact.lei);
    } catch (err) {
      out.errors.push(`GLEIF – relacje: ${err.message}`);
    }
  }

  // 2. KRS: odpis aktualny (wszystkie działy)
  if (krsNumber && KRS_RX.test(krsNumber)) {
    try {
      out.krs = await analyzer.enrichKrs(krsNumber);
    } catch (err) {
      out.errors.push(`KRS: ${err.message}`);
      if (err instanceof UpstreamError && err.status === 404) out.krs = { notFound: true, krs: krsNumber };
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
      await record(t, entityId, 'gleif', out.gleif.length ? 'found' : 'not_found',
        { records: out.gleif, exact: exact?.lei ?? null, detail: out.gleifDetail, krs_source: krsSource }, exact?.country ?? null);
      if (exact) await t.q('UPDATE entities SET lei = $2, country = COALESCE(country, $3) WHERE id = $1', [entityId, exact.lei, exact.country]);
    }
    if (out.watchlists) {
      const by = (l) => out.watchlists.hits.filter((h) => h.list === l);
      await record(t, entityId, 'knf_warnings', by('knf_warnings').length ? 'found' : 'not_found', { hits: by('knf_warnings'), meta: out.watchlists.meta.knf_warnings });
      await record(t, entityId, 'esma_mica', by('esma_ncasp').length || by('esma_casp').length ? 'found' : 'not_found',
        { casp: by('esma_casp'), ncasp: by('esma_ncasp'), meta: out.watchlists.meta.esma_mica });
      await record(t, entityId, 'eu_sanctions', by('eu_sanctions').length ? 'found' : 'not_found',
        { hits: by('eu_sanctions'), meta: out.watchlists.meta.eu_sanctions, verification: 'wymaga weryfikacji' });
    }
    await t.q('UPDATE entities SET enriched_at = now() WHERE id = $1', [entityId]);
  });
  emit('entity:enriched', { id: entityId });
  return { ...out, krsUsed: krsNumber, krsSource, candidates };
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
