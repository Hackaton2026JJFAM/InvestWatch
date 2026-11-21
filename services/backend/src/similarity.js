// Prawie-duplikaty: odległość Hamminga między 64-bitowymi odciskami simhash (hex).
import { q } from './db.js';

export const NEAR_DUP_BITS = 3;   // ta sama treść z drobnymi zmianami
export const SIMILAR_BITS = 10;   // treść podobna (np. ta sama reklama z innym wstępem)

export function hamming(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

export async function findSimilar(simhash, { excludeId = null, maxBits = SIMILAR_BITS, limit = 10 } = {}) {
  if (!simhash) return [];
  const rows = await q('SELECT id, title, url, platform, author, simhash FROM materials WHERE simhash IS NOT NULL AND id IS DISTINCT FROM $1 ORDER BY id DESC LIMIT 5000', [excludeId]);
  return rows
    .map((r) => ({ id: r.id, title: r.title, url: r.url, platform: r.platform, author: r.author, distance: hamming(simhash, r.simhash) }))
    .filter((r) => r.distance <= maxBits)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}
