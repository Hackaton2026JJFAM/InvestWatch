// Doradcy sprawdzeni przez analityka w rejestrze KNF. Dopasowanie materiału: konto publikującego
// (autor / handle), domena strony albo numer licencji wykryty w treści. Dla dopasowanych materiałów
// przesłanki M3 o braku/niepotwierdzonych uprawnieniach są zastępowane informacją „zweryfikowany”.
import { one, q } from './db.js';
import { log } from './log.js';

const norm = (s) => (s ? String(s).toLowerCase().trim().replace(/^@+/, '') : null);
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };

/** Dane do formularza „oznacz jako sprawdzonego” – z materiału i ostatniej analizy. */
export function advisorCandidate(m, result) {
  const raw = m.raw ?? {};
  return {
    name: result?.m1?.publisher?.name ?? m.author ?? null,
    handle: norm(raw.social_handle ?? (m.platform !== 'web' ? m.author : null)),
    domain: m.platform === 'web' ? hostOf(m.final_url || m.url) : null,
    license_no: result?.m3?.license?.number ?? null,
  };
}

/** Wpis sprawdzonego doradcy pasujący do materiału (konto, domena lub nr licencji) albo null. */
export async function verifiedAdvisorFor(materialId) {
  const m = await one(
    `SELECT m.author, m.platform, m.url, m.final_url, m.raw->>'social_handle' AS social_handle,
            (SELECT result->'m3'->'license'->>'number' FROM analyses WHERE material_id = m.id ORDER BY created_at DESC LIMIT 1) AS license_no
       FROM materials m WHERE m.id = $1`, [materialId]);
  if (!m) return null;
  const handles = [norm(m.author), norm(m.social_handle)].filter(Boolean);
  const host = m.platform === 'web' ? hostOf(m.final_url || m.url) : null;
  return one(
    `SELECT * FROM verified_advisors
      WHERE (handle IS NOT NULL AND handle = ANY($1::text[]))
         OR (domain IS NOT NULL AND $2::text IS NOT NULL AND ($2 = domain OR $2 LIKE '%.' || domain))
         OR (license_no IS NOT NULL AND license_no = $3)
      ORDER BY verified_at DESC LIMIT 1`, [handles, host, m.license_no]);
}

/** Materiały, których dotyczy wpis (nowy lub usunięty) – do przeliczenia wyniku po weryfikacji. */
async function affected(v) {
  return (await q(
    `SELECT m.id FROM materials m
      LEFT JOIN LATERAL (SELECT result FROM analyses WHERE material_id = m.id ORDER BY created_at DESC LIMIT 1) a ON TRUE
     WHERE ($1::text IS NOT NULL AND (lower(regexp_replace(coalesce(m.author, ''), '^@+', '')) = $1
                                      OR lower(regexp_replace(coalesce(m.raw->>'social_handle', ''), '^@+', '')) = $1))
        OR ($2::text IS NOT NULL AND m.platform = 'web' AND (
              regexp_replace(lower(substring(coalesce(m.final_url, m.url) from '^[a-z]+://([^/:?#]+)')), '^www\\.', '') = $2
           OR regexp_replace(lower(substring(coalesce(m.final_url, m.url) from '^[a-z]+://([^/:?#]+)')), '^www\\.', '') LIKE '%.' || $2))
        OR ($3::text IS NOT NULL AND a.result->'m3'->'license'->>'number' = $3)`,
    [v.handle, v.domain, v.license_no])).map((x) => x.id);
}

/** Przelicza materiały dopasowane do wpisu (albo do wszystkich wpisów, gdy brak argumentu). */
export async function applyVerifiedAdvisors(storeReviewFor, entry = null) {
  const entries = entry ? [entry] : await q('SELECT * FROM verified_advisors');
  const ids = new Set();
  for (const v of entries) for (const id of await affected(v)) ids.add(id);
  for (const id of ids) await storeReviewFor(id);
  if (ids.size) log.info('verified advisors applied', { materials: ids.size });
  return ids.size;
}
