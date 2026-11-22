// Prawie-duplikaty: odległość Hamminga między 64-bitowymi odciskami simhash (hex), liczona w PostgreSQL,
// potwierdzana podobieństwem treści (pg_trgm). Ten sam post na 5 portalach, z innym wstępem albo z jednym
// zmienionym słowem, to duplikat. Krótki tekst z jednym innym słowem ma simhash różny o ~10 bitów,
// dlatego sam próg bitów nie wystarcza – kandydatów (≤ CANDIDATE_BITS) sprawdzamy jeszcze po treści.
import { one, q } from './db.js';

export const NEAR_DUP_BITS = 3;      // ta sama treść z drobnymi zmianami (pewne bez porównania tekstu)
export const SIMILAR_BITS = 10;      // treść podobna (np. ta sama reklama z innym wstępem)
export const CANDIDATE_BITS = 20;    // kandydaci do porównania treści
export const NEAR_DUP_TEXT = 0.85;   // podobieństwo trigramów treści uznawane za duplikat

export function hamming(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

const HEX64 = /^[0-9a-f]{16}$/i;
const DISTANCE = "bit_count(('x' || m.simhash)::bit(64) # ('x' || $1)::bit(64))";
const MAX_TEXT = 20000;

/**
 * Podobne materiały. `text` (treść badanego materiału) włącza porównanie treści: wynik ma `text_sim` (0–1)
 * i `near` = duplikat (≤ NEAR_DUP_BITS bitów albo treść podobna ≥ NEAR_DUP_TEXT).
 */
export async function findSimilar(simhash, { excludeId = null, maxBits = SIMILAR_BITS, limit = 10, text = null, beforeId = null } = {}) {
  if (!simhash || !HEX64.test(simhash)) return [];
  const rows = await q(
    `SELECT s.*, CASE WHEN $5::text IS NULL THEN NULL
                      ELSE round(similarity(left(s.content_text, ${MAX_TEXT}), left($5::text, ${MAX_TEXT}))::numeric, 2)::float END AS text_sim
       FROM (SELECT m.id, m.title, m.url, m.platform, m.author, m.fetched_at, m.content_text, m.near_duplicate_of, ${DISTANCE}::int AS distance
               FROM materials m WHERE m.simhash ~* '^[0-9a-f]{16}$' AND m.id IS DISTINCT FROM $2 AND ($6::int IS NULL OR m.id < $6)) s
      WHERE s.distance <= $3
      ORDER BY s.distance, s.id DESC LIMIT $4`,
    [simhash, excludeId, Math.max(maxBits, text ? CANDIDATE_BITS : 0), Math.max(limit, 50), text, beforeId]);
  return rows
    .map(({ content_text: _c, ...r }) => ({ ...r, near: r.distance <= NEAR_DUP_BITS || (r.text_sim ?? 0) >= NEAR_DUP_TEXT }))
    .filter((r) => r.distance <= maxBits || r.near)
    .sort((a, b) => Number(b.near) - Number(a.near) || a.distance - b.distance)
    .slice(0, limit);
}

/**
 * Oryginał, którego kopią jest nowy materiał (do `near_duplicate_of`), albo null. Wskazuje zawsze pierwszy materiał
 * z grupy (kopia kopii -> oryginał), więc lista i alerty pokazują jedną pozycję na treść.
 */
export async function findNearDuplicate(simhash, text, { excludeId = null, beforeId = null } = {}) {
  const hit = (await findSimilar(simhash, { excludeId, beforeId, maxBits: NEAR_DUP_BITS, limit: 10, text })).find((r) => r.near);
  return hit ? { ...hit, id: hit.near_duplicate_of ?? hit.id } : null;
}

/** Dopisuje miejsce publikacji duplikatu do oryginału (bez powtórzeń adresu). */
export async function addLocation(materialId, loc) {
  const entry = { url: loc.url, platform: loc.platform ?? null, author: loc.author ?? null, title: loc.title ?? null,
    published_at: loc.published_at ?? null, seen_at: loc.seen_at ?? new Date().toISOString() };
  await q(`UPDATE materials SET locations = locations || $2::jsonb
            WHERE id = $1 AND url IS DISTINCT FROM $3
              AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(locations) l WHERE l->>'url' = $3)`,
    [materialId, JSON.stringify([entry]), entry.url]);
}

/**
 * Usuwanie duplikatów: każdy materiał porównany z wcześniejszymi; kopia jest usuwana (z analizami, przesłankami
 * i alertami), a jej adres trafia do listy lokalizacji oryginału. Zadania skanowania wskazują potem oryginał.
 */
export async function removeDuplicates() {
  const rows = await q('SELECT id, simhash, content_text, near_duplicate_of FROM materials WHERE simhash IS NOT NULL ORDER BY id');
  const gone = new Set();
  let n = 0;
  for (const m of rows) {
    if (gone.has(m.id)) continue;
    let origId = m.near_duplicate_of;
    if (!origId || gone.has(origId)) origId = (await findNearDuplicate(m.simhash, m.content_text, { beforeId: m.id }))?.id ?? null;
    if (!origId || origId === m.id || gone.has(origId)) continue;
    const c = await one('SELECT url, platform, author, title, published_at, fetched_at, locations FROM materials WHERE id = $1', [m.id]);
    await addLocation(origId, { ...c, seen_at: c.fetched_at });
    for (const l of c.locations ?? []) await addLocation(origId, l);
    await q("UPDATE scan_jobs SET material_id = $2, status = 'duplicate', error = $3 WHERE material_id = $1",
      [m.id, origId, `duplikat materiału #${origId} – usunięty, adres dopisany do lokalizacji oryginału`]);
    await q('UPDATE materials SET near_duplicate_of = NULL WHERE near_duplicate_of = $1', [m.id]);
    await q('DELETE FROM materials WHERE id = $1', [m.id]);
    gone.add(m.id);
    n++;
  }
  if (n) await q("DELETE FROM entities e WHERE NOT EXISTS (SELECT 1 FROM material_entities me WHERE me.entity_id = e.id) AND e.kind IN ('influencer', 'unknown')");
  return n;
}
