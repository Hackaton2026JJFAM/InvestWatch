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
];

export async function migrate() {
  for (const sql of MIGRATIONS) await pool.query(sql);
  // próg domyślny z konfiguracji (DEFAULT_THRESHOLD) – tylko gdy nie ustawiono go wcześniej
  await pool.query("INSERT INTO settings (key, value) VALUES ('threshold', $1) ON CONFLICT (key) DO NOTHING", [JSON.stringify(config.defaultThreshold)]);
}

export async function getThreshold() {
  const row = await one("SELECT value FROM settings WHERE key = 'threshold'");
  return row ? Number(row.value) : config.defaultThreshold;
}
