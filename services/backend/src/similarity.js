// Prawie-duplikaty: odległość Hamminga między 64-bitowymi odciskami simhash (hex), liczona w PostgreSQL.
// Ten sam post na 5 portalach (albo z innym wstępem) ma odległość 0–3 bitów; podobne treści do 10.
import { q } from './db.js';

export const NEAR_DUP_BITS = 3;   // ta sama treść z drobnymi zmianami
export const SIMILAR_BITS = 10;   // treść podobna (np. ta sama reklama z innym wstępem)

export function hamming(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

const HEX64 = /^[0-9a-f]{16}$/i;
// bit_count(XOR) na bit(64) – cała baza, bez wczytywania materiałów do Node
const DISTANCE = "bit_count(('x' || m.simhash)::bit(64) # ('x' || $1)::bit(64))";

export async function findSimilar(simhash, { excludeId = null, maxBits = SIMILAR_BITS, limit = 10 } = {}) {
  if (!simhash || !HEX64.test(simhash)) return [];
  return q(
    `SELECT * FROM (SELECT m.id, m.title, m.url, m.platform, m.author, m.fetched_at, ${DISTANCE}::int AS distance
       FROM materials m WHERE m.simhash ~* '^[0-9a-f]{16}$' AND m.id IS DISTINCT FROM $2) s
     WHERE distance <= $3 ORDER BY distance, id DESC LIMIT $4`,
    [simhash, excludeId, maxBits, limit]);
}
