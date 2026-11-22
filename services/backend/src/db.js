import pg from 'pg';
import { config } from './config.js';
import { log } from './log.js';

// NUMERIC jako liczba (wyniki 0-100 mieszczą się w double)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// DATE jako tekst 'YYYY-MM-DD' – bez przesunięcia o strefę czasową
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
pool.on('error', (err) => log.error('pg pool error', { err: err.message }));

export const q = async (text, params = []) => (await pool.query(text, params)).rows;
export const one = async (text, params = []) => (await pool.query(text, params)).rows[0] ?? null;

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await fn({
      q: async (t, p = []) => (await client.query(t, p)).rows,
      one: async (t, p = []) => (await client.query(t, p)).rows[0] ?? null,
    });
    await client.query('COMMIT');
    return res;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function waitForDb(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('Baza danych niedostępna');
}

// Migracje idempotentne – aktualizują bazy utworzone starszą wersją db/init.sql.
const MIGRATIONS = [
  'ALTER TABLE materials ADD COLUMN IF NOT EXISTS simhash TEXT',
  'ALTER TABLE materials ADD COLUMN IF NOT EXISTS near_duplicate_of INT REFERENCES materials(id) ON DELETE SET NULL',
  'ALTER TABLE materials ADD COLUMN IF NOT EXISTS layout_hash TEXT',
  'ALTER TABLE materials DROP CONSTRAINT IF EXISTS materials_url_content_hash_key',
  "CREATE UNIQUE INDEX IF NOT EXISTS materials_version_uq ON materials (url, content_hash, coalesce(layout_hash, ''))",
  'ALTER TABLE entities ADD COLUMN IF NOT EXISTS krs TEXT',
  'ALTER TABLE entities ADD COLUMN IF NOT EXISTS nip TEXT',
  'ALTER TABLE entities ADD COLUMN IF NOT EXISTS lei TEXT',
  'ALTER TABLE entities ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ',
  'ALTER TABLE persons ADD COLUMN IF NOT EXISTS masked BOOLEAN NOT NULL DEFAULT FALSE',
  'CREATE INDEX IF NOT EXISTS registry_records_entity ON registry_records (entity_id, registry, checked_at DESC)',
  // alerty niezwiązane z materiałem (Proof of Reserves) – dotyczą podmiotu
  'ALTER TABLE alerts ALTER COLUMN material_id DROP NOT NULL',
  'ALTER TABLE alerts ALTER COLUMN analysis_id DROP NOT NULL',
  "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'material'",
  'ALTER TABLE alerts ADD COLUMN IF NOT EXISTS entity_id INT REFERENCES entities(id) ON DELETE CASCADE',
  'ALTER TABLE alerts ADD COLUMN IF NOT EXISTS message TEXT',
  // Proof of Reserves: identyfikator raportu i pełne dane (pokrycie per aktywo)
  'ALTER TABLE reserves_reports ADD COLUMN IF NOT EXISTS audit_id TEXT',
  'ALTER TABLE reserves_reports ADD COLUMN IF NOT EXISTS data JSONB',
  'CREATE UNIQUE INDEX IF NOT EXISTS reserves_reports_uq ON reserves_reports (entity_id, audit_id)',
  // zachowanie w kryzysach (GPW)
  'ALTER TABLE entities ADD COLUMN IF NOT EXISTS ticker TEXT',
  'ALTER TABLE crisis_periods ADD COLUMN IF NOT EXISTS code TEXT',
  'CREATE UNIQUE INDEX IF NOT EXISTS crisis_periods_code ON crisis_periods (code)',
  'ALTER TABLE company_crisis_behavior ADD COLUMN IF NOT EXISTS ticker TEXT',
  "ALTER TABLE company_crisis_behavior ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'done'",
  'ALTER TABLE company_crisis_behavior ADD COLUMN IF NOT EXISTS error TEXT',
  'ALTER TABLE company_crisis_behavior ADD COLUMN IF NOT EXISTS data JSONB',
  'ALTER TABLE company_crisis_behavior ADD COLUMN IF NOT EXISTS computed_at TIMESTAMPTZ',
  'CREATE UNIQUE INDEX IF NOT EXISTS company_crisis_uq ON company_crisis_behavior (entity_id, crisis_id)',
  // zasięg, tagi i profil (płatna promocja / oszustwo / doradca) – filtrowanie i priorytet „ryzyko × zasięg”
  'ALTER TABLE materials ADD COLUMN IF NOT EXISTS views BIGINT',
  'ALTER TABLE materials ADD COLUMN IF NOT EXISTS likes BIGINT',
  'ALTER TABLE materials ADD COLUMN IF NOT EXISTS followers BIGINT',
  "ALTER TABLE materials ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'",
  'ALTER TABLE materials ADD COLUMN IF NOT EXISTS profile_type TEXT',
  'ALTER TABLE materials ADD COLUMN IF NOT EXISTS scam_score INT',
  'ALTER TABLE materials ADD COLUMN IF NOT EXISTS watch_id INT',
  'CREATE INDEX IF NOT EXISTS materials_views ON materials (views DESC NULLS LAST)',
  'CREATE INDEX IF NOT EXISTS materials_tags ON materials USING GIN (tags)',
  'CREATE INDEX IF NOT EXISTS materials_profile ON materials (profile_type)',
  'CREATE INDEX IF NOT EXISTS materials_url ON materials (url)',
  `UPDATE materials SET views = NULLIF(raw->'layout'->'video'->'meta'->>'view_count', '')::bigint,
          likes = NULLIF(raw->'layout'->'video'->'meta'->>'like_count', '')::bigint,
          followers = NULLIF(raw->'layout'->'video'->'meta'->>'channel_follower_count', '')::bigint
    WHERE views IS NULL AND jsonb_typeof(raw->'layout'->'video'->'meta') = 'object'`,
  'CREATE INDEX IF NOT EXISTS materials_lang ON materials (lang)',
  // tagi ze spacjami (opisowe tagi YouTube) nie są hashtagami – usuwane z zapisanych materiałów
  "UPDATE materials SET tags = ARRAY(SELECT t FROM unnest(tags) t WHERE t !~ '[[:space:]]') WHERE EXISTS (SELECT 1 FROM unnest(tags) t WHERE t ~ '[[:space:]]')",
  `CREATE TABLE IF NOT EXISTS watch_queries (
     id SERIAL PRIMARY KEY, platform TEXT NOT NULL, kind TEXT NOT NULL, query TEXT NOT NULL, sort TEXT NOT NULL DEFAULT 'views',
     min_views BIGINT NOT NULL DEFAULT 10000, max_per_run INT NOT NULL DEFAULT 10, enabled BOOLEAN NOT NULL DEFAULT TRUE,
     last_run_at TIMESTAMPTZ, last_found INT, last_queued INT, last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (platform, kind, query))`,
  'ALTER TABLE watch_queries ADD COLUMN IF NOT EXISTS polish BOOLEAN NOT NULL DEFAULT TRUE',
  'ALTER TABLE watch_queries ADD COLUMN IF NOT EXISTS auto BOOLEAN NOT NULL DEFAULT FALSE',
  `CREATE TABLE IF NOT EXISTS tag_stats (
     tag TEXT PRIMARY KEY, materials INT NOT NULL, views BIGINT NOT NULL DEFAULT 0, avg_score INT, scams INT NOT NULL DEFAULT 0,
     recent INT NOT NULL DEFAULT 0, previous INT NOT NULL DEFAULT 0, popularity NUMERIC NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  // decyzje analityka o punktach podsumowania (przesłankach) – trwałe między ponownymi analizami (klucz: reguła)
  `CREATE TABLE IF NOT EXISTS finding_reviews (
     material_id INT NOT NULL REFERENCES materials(id) ON DELETE CASCADE, rule_id TEXT NOT NULL, decision TEXT NOT NULL DEFAULT 'rejected',
     note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (material_id, rule_id))`,
  'ALTER TABLE materials ADD COLUMN IF NOT EXISTS reviewed_score NUMERIC',
  'ALTER TABLE materials ADD COLUMN IF NOT EXISTS profile_manual TEXT',
  'ALTER TABLE materials ADD COLUMN IF NOT EXISTS reviewed_modules JSONB',
  // konto publikującego (platforma + profil / domena) – historia zachowań konta
  'ALTER TABLE materials ADD COLUMN IF NOT EXISTS account_key TEXT',
  'CREATE INDEX IF NOT EXISTS materials_account ON materials (account_key, fetched_at DESC)',
  // próbki kalibracyjne (SEED_DEMO) – oddzielone od prawdziwych wyników monitoringu
  'ALTER TABLE materials ADD COLUMN IF NOT EXISTS demo BOOLEAN NOT NULL DEFAULT FALSE',
  `UPDATE materials SET demo = TRUE WHERE NOT demo AND id IN (SELECT material_id FROM scan_jobs WHERE trigger = 'seed' AND material_id IS NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS materials_published ON materials (published_at)',
  // problemy dodane ręcznie przez analityka (liczą się do wyniku po weryfikacji)
  `CREATE TABLE IF NOT EXISTS manual_findings (
     id SERIAL PRIMARY KEY, material_id INT NOT NULL REFERENCES materials(id) ON DELETE CASCADE, module TEXT NOT NULL,
     title TEXT NOT NULL, severity INT NOT NULL, explanation TEXT, fragment TEXT, at TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  'CREATE INDEX IF NOT EXISTS manual_findings_material ON manual_findings (material_id)',
  // doradcy sprawdzeni przez analityka w rejestrze KNF – ich treści nie są oznaczane jako możliwy brak zezwolenia
  `CREATE TABLE IF NOT EXISTS verified_advisors (
     id SERIAL PRIMARY KEY, name TEXT, handle TEXT, domain TEXT, license_no TEXT, note TEXT,
     verified_at TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK (handle IS NOT NULL OR domain IS NOT NULL OR license_no IS NOT NULL))`,
  // uzupełnienie dla materiałów sprzed rankingu tagów: język z ostatniej analizy, hashtagi z tytułu i treści
  `UPDATE materials m SET lang = x.lang FROM (SELECT DISTINCT ON (material_id) material_id, result->'doc'->>'lang' AS lang
     FROM analyses ORDER BY material_id, created_at DESC) x WHERE x.material_id = m.id AND m.lang IS NULL AND x.lang IS NOT NULL`,
  `UPDATE materials SET tags = ARRAY(SELECT DISTINCT lower(t[1]) FROM regexp_matches(coalesce(title, '') || ' ' || content_text, '#([[:alnum:]_]{2,40})', 'g') t)
    WHERE tags = '{}' AND (coalesce(title, '') || ' ' || content_text) ~ '#[[:alnum:]_]{2,}'`,
];

export async function migrate() {
  for (const sql of MIGRATIONS) await pool.query(sql);
  // próg domyślny z konfiguracji (DEFAULT_THRESHOLD) – tylko gdy nie ustawiono go wcześniej
  await pool.query("INSERT INTO settings (key, value) VALUES ('threshold', $1) ON CONFLICT (key) DO NOTHING", [JSON.stringify(config.defaultThreshold)]);
}

export async function getShowDemo() {
  const row = await one("SELECT value FROM settings WHERE key = 'show_demo'");
  return row ? row.value === true : true;
}

export async function getThreshold() {
  const row = await one("SELECT value FROM settings WHERE key = 'threshold'");
  return row ? Number(row.value) : config.defaultThreshold;
}
