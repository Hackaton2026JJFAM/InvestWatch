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

export async function getThreshold() {
  const row = await one("SELECT value FROM settings WHERE key = 'threshold'");
  return row ? Number(row.value) : config.defaultThreshold;
}
