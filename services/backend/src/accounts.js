// Historia konta: wszystkie materiały tego samego publikującego (kanał / profil na platformie, domena
// strony). Wcześniejsze zachowanie konta – treści wysokiego ryzyka, podejrzenia oszustwa – oznacza
// kolejne jego materiały („konto z historią naruszeń”). Statystyki liczone z WYNIKU KLASYFIKATORA
// (nie po weryfikacji), żeby oznaczenie nie napędzało samo siebie.
import { one, q } from './db.js';
import { log } from './log.js';

export const HISTORY_HIGH = 70;          // „wysokie ryzyko” w historii konta
export const REPEAT_MIN_HIGH = 2;        // tyle wcześniejszych materiałów wysokiego ryzyka…
export const REPEAT_MIN_SCAMS = 1;       // …albo tyle wcześniejszych podejrzeń oszustwa = konto z historią naruszeń

const norm = (s) => (s ? String(s).toLowerCase().trim().replace(/^@+/, '').replace(/\s+/g, ' ') : null);
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };

/** Klucz konta: platforma + profil (handle/kanał, a gdy brak – autor) albo domena dla stron WWW. */
export function accountKeyOf(m) {
  const platform = m.platform || 'web';
  if (platform === 'web') {
    const host = hostOf(m.final_url || m.url);
    return host && !host.endsWith('.example') ? `web:${host}` : null;
  }
  // z adresu profilu: tiktok.com/@nazwa, instagram.com/nazwa, youtube.com/@kanał, x.com/nazwa
  const fromUrl = (() => {
    const u = m.url || '';
    const at = u.match(/(?:tiktok|youtube)\.com\/@([^/?#]+)/i);
    if (at) return at[1];
    const x = u.match(/(?:x|twitter)\.com\/([^/?#]+)\/status/i);
    if (x) return x[1];
    const ig = u.match(/instagram\.com\/([^/?#]+)\/(?:p|reel)\//i);
    return ig ? ig[1] : null;
  })();
  const handle = norm(m.social_handle ?? m.raw?.social_handle) || norm(fromUrl) || norm(m.author);
  return handle ? `${platform}:${handle}` : null;
}

/** Statystyki konta (bez wskazanego materiału; opcjonalnie tylko materiały pobrane wcześniej). */
export async function accountHistory(key, { excludeId = null, before = null, limit = 12 } = {}) {
  if (!key) return null;
  const rows = await q(
    `SELECT m.id, m.title, m.url, m.platform, m.fetched_at, m.published_at, m.views, m.status, a.score::float AS score,
            a.result->'profile'->>'primary' AS profile, m.reviewed_score
       FROM materials m
       JOIN LATERAL (SELECT score, result FROM analyses WHERE material_id = m.id ORDER BY created_at DESC LIMIT 1) a ON TRUE
      WHERE m.account_key = $1 AND NOT m.demo AND m.id IS DISTINCT FROM $2 AND ($3::timestamptz IS NULL OR m.fetched_at < $3)
      ORDER BY m.fetched_at DESC`, [key, excludeId, before]);
  const high = rows.filter((r) => r.score >= HISTORY_HIGH);
  const scams = rows.filter((r) => r.profile === 'podejrzenie_oszustwa');
  return {
    key, materials: rows.length, high: high.length, scams: scams.length,
    dismissed: rows.filter((r) => r.status === 'DISMISSED').length,
    avg_score: rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : null,
    max_score: rows.length ? Math.round(Math.max(...rows.map((r) => r.score))) : null,
    first_seen: rows.at(-1)?.fetched_at ?? null, last_seen: rows[0]?.fetched_at ?? null,
    repeat: high.length >= REPEAT_MIN_HIGH || scams.length >= REPEAT_MIN_SCAMS,
    items: rows.slice(0, limit),
  };
}

/** Historia dla materiału: wcześniejsze materiały tego samego konta (pobrane przed nim). */
export async function priorHistoryFor(materialId) {
  const m = await one('SELECT id, account_key, fetched_at, demo FROM materials WHERE id = $1', [materialId]);
  if (!m?.account_key || m.demo) return null;
  return accountHistory(m.account_key, { excludeId: m.id, before: m.fetched_at });
}

/** Uzupełnienie klucza konta dla materiałów sprzed tej funkcji. */
export async function backfillAccountKeys() {
  const rows = await q("SELECT id, platform, url, final_url, author, raw->>'social_handle' AS social_handle FROM materials WHERE account_key IS NULL");
  let n = 0;
  for (const m of rows) {
    const key = accountKeyOf(m);
    if (key) { await q('UPDATE materials SET account_key = $2 WHERE id = $1', [m.id, key]); n++; }
  }
  if (n) log.info('account keys backfilled', { n });
  return n;
}
