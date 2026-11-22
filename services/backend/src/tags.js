// Stała aktualizacja hashtagów na podstawie popularności: ranking tagów z materiałów (zasięg, liczba,
// ryzyko, trend tydzień do tygodnia) przeliczany według harmonogramu; najpopularniejsze tagi związane
// z treściami finansowymi automatycznie trafiają do monitoringu (wszystkie platformy), a te, które
// wypadły z czołówki, są automatycznie wstrzymywane. Zapytania dodane ręcznie nie są ruszane.
import cron from 'node-cron';
import { config } from './config.js';
import { q, tx } from './db.js';
import { log } from './log.js';
import { emit } from './realtime.js';
import { PRESET_TAGS } from './reach.js';
import { excludedBy, getExcludes } from './exclude.js';

// tagi zbyt ogólne, by monitorować je automatycznie (dużo treści spoza finansów)
const GENERIC = new Set(['fyp', 'foryou', 'foryoupage', 'viral', 'dc', 'xyzbca', 'polska', 'poland', 'shorts', 'short', 'reels', 'tiktok',
  'instagram', 'youtube', 'trend', 'trending', 'funny', 'love', 'pl', 'dlaciebie', 'fy', 'explore', 'news',
  // oznaczenia współpracy – nie są tematem, monitorowanie ściągałoby wszystkie reklamy
  'reklama', 'ad', 'ads', 'sponsored', 'sponsor', 'sponsorowane', 'wspolpraca', 'współpraca', 'partner', 'partnership', 'paidpartnership']);

export async function refreshTagStats({ days = 30 } = {}) {
  // materiały z wykluczonymi słowami (np. gry) nie zasilają rankingu – inaczej automatyczny monitoring
  // „uczyłby się” tagów z gier (gtav, dlc, bunkier…) i wciągał kolejne takie treści
  const words = await getExcludes();
  const rows = await q(`SELECT id, title, author, tags, raw->>'description' AS description FROM materials
                         WHERE fetched_at > now() - make_interval(days => $1) AND lang = 'pl'`, [days]);
  const allowed = rows.filter((m) => !excludedBy(m, words)).map((m) => m.id);
  // popularność = log zasięgu + liczba materiałów, wzmocniona ryzykiem; trend = ostatnie 7 dni vs poprzednie 7
  // pełne przeliczenie w jednej transakcji – tagi, które wypadły z okna, znikają z rankingu
  await tx(async (t) => {
  await t.q('DELETE FROM tag_stats');
  await t.q(
    `INSERT INTO tag_stats (tag, materials, views, avg_score, scams, recent, previous, popularity, updated_at)
     SELECT t, count(*)::int, coalesce(sum(m.views), 0)::bigint, round(avg(a.score))::int,
            count(*) FILTER (WHERE m.profile_type = 'podejrzenie_oszustwa')::int,
            count(*) FILTER (WHERE m.fetched_at > now() - interval '7 days')::int,
            count(*) FILTER (WHERE m.fetched_at <= now() - interval '7 days' AND m.fetched_at > now() - interval '14 days')::int,
            round(((sum(log(greatest(coalesce(m.views, 0), 1) + 10)) + count(*)) * (1 + avg(a.score) / 100.0))::numeric, 2),
            now()
       FROM materials m CROSS JOIN LATERAL unnest(m.tags) t
       JOIN LATERAL (SELECT score FROM analyses WHERE material_id = m.id ORDER BY created_at DESC LIMIT 1) a ON TRUE
      WHERE m.fetched_at > now() - make_interval(days => $1) AND m.lang = 'pl'   -- monitoring nastawiony na treści polskie
        AND m.id = ANY($2::int[])
      GROUP BY t
     ON CONFLICT (tag) DO UPDATE SET materials = EXCLUDED.materials, views = EXCLUDED.views, avg_score = EXCLUDED.avg_score,
       scams = EXCLUDED.scams, recent = EXCLUDED.recent, previous = EXCLUDED.previous, popularity = EXCLUDED.popularity, updated_at = now()`,
    [days, allowed]);
  });
}

/** Ranking: tagi związane z treściami finansowymi (średni wynik ≥ 20 albo podejrzenia oszustwa). */
export async function trendingTags(limit = 40) {
  return q(
    `SELECT tag, materials, views, avg_score, scams, recent, previous, popularity,
            CASE WHEN previous = 0 THEN (CASE WHEN recent > 0 THEN 'nowy' ELSE 'stały' END)
                 WHEN recent > previous THEN 'rośnie' WHEN recent < previous THEN 'maleje' ELSE 'stały' END AS trend
       FROM tag_stats WHERE (avg_score >= 20 OR scams > 0) AND length(tag) BETWEEN 3 AND 40 AND NOT (tag = ANY($2))
      ORDER BY popularity DESC, views DESC LIMIT $1`, [limit, [...GENERIC]]);
}

export async function syncAutoWatches() {
  const k = config.tagAutoWatch;
  if (!k) return { added: 0, paused: 0 };
  const words = await getExcludes();
  let top = (await trendingTags(k * 3)).map((t) => t.tag).filter((t) => !GENERIC.has(t) && !excludedBy({ title: t }, words)).slice(0, k);
  // zimny start (pusta baza): polskie tagi finansowe jako punkt wyjścia – zastępowane danymi, gdy się pojawią
  if (top.length < k) top = [...new Set([...top, ...PRESET_TAGS.filter((t) => !GENERIC.has(t) && !excludedBy({ title: t }, words))])].slice(0, k);
  const added = await q(
    `INSERT INTO watch_queries (platform, kind, query, sort, min_views, max_per_run, polish, auto)
     SELECT 'all', 'hashtag', t, 'views', $2, 5, TRUE, TRUE FROM unnest($1::text[]) t
     ON CONFLICT (platform, kind, query) DO UPDATE SET enabled = TRUE WHERE watch_queries.auto
     RETURNING id`, [top, config.tagAutoMinViews]);
  const paused = await q(
    `UPDATE watch_queries SET enabled = FALSE WHERE auto AND enabled AND kind = 'hashtag' AND NOT (query = ANY($1)) RETURNING id`, [top]);
  if (added.length || paused.length) emit('watch:update', {});
  log.info('tag auto-watch sync', { top, added: added.length, paused: paused.length });
  return { top, added: added.length, paused: paused.length };
}

export async function refreshTags() {
  await refreshTagStats();
  return syncAutoWatches();
}

export function startTagSchedule() {
  // pierwsze przeliczenie krótko po starcie, potem według TAGS_CRON
  setTimeout(() => refreshTags().catch((err) => log.warn('tag refresh failed', { err: err.message })), 15000);
  if (!cron.validate(config.tagsCron)) return null;
  return cron.schedule(config.tagsCron, () => refreshTags().catch((err) => log.warn('tag refresh failed', { err: err.message })),
    { timezone: 'Europe/Warsaw' });
}
