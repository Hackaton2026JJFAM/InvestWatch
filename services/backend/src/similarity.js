// Prawie-duplikaty: odległość Hamminga między 64-bitowymi odciskami simhash (hex), liczona w PostgreSQL,
// potwierdzana podobieństwem treści (pg_trgm). Ten sam post na 5 portalach, z innym wstępem albo z jednym
// zmienionym słowem, to duplikat. Krótki tekst z jednym innym słowem ma simhash różny o ~10 bitów,
// dlatego sam próg bitów nie wystarcza – kandydatów (≤ CANDIDATE_BITS) sprawdzamy jeszcze po treści.
import { q } from './db.js';

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
export async function findSimilar(simhash, { excludeId = null, maxBits = SIMILAR_BITS, limit = 10, text = null } = {}) {
  if (!simhash || !HEX64.test(simhash)) return [];
  const rows = await q(
    `SELECT s.*, CASE WHEN $5::text IS NULL THEN NULL
                      ELSE round(similarity(left(s.content_text, ${MAX_TEXT}), left($5::text, ${MAX_TEXT}))::numeric, 2)::float END AS text_sim
       FROM (SELECT m.id, m.title, m.url, m.platform, m.author, m.fetched_at, m.content_text, ${DISTANCE}::int AS distance
               FROM materials m WHERE m.simhash ~* '^[0-9a-f]{16}$' AND m.id IS DISTINCT FROM $2) s
      WHERE s.distance <= $3
      ORDER BY s.distance, s.id DESC LIMIT $4`,
    [simhash, excludeId, Math.max(maxBits, text ? CANDIDATE_BITS : 0), Math.max(limit, 50), text]);
  return rows
    .map(({ content_text: _c, ...r }) => ({ ...r, near: r.distance <= NEAR_DUP_BITS || (r.text_sim ?? 0) >= NEAR_DUP_TEXT }))
    .filter((r) => r.distance <= maxBits || r.near)
    .sort((a, b) => Number(b.near) - Number(a.near) || a.distance - b.distance)
    .slice(0, limit);
}

/** Najbliższy duplikat nowego materiału (do `near_duplicate_of`) albo null. */
export async function findNearDuplicate(simhash, text, excludeId = null) {
  return (await findSimilar(simhash, { excludeId, maxBits: NEAR_DUP_BITS, limit: 1, text })).find((r) => r.near) ?? null;
}
