import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const req = createRequire(path.join(process.env.AUDIT_NODE_ROOT, 'package.json'));
const { Client } = req('pg');
const client = new Client({ connectionString: 'postgres://audit:synthetic-audit-only@127.0.0.1:55432/investwatch_audit' });
await client.connect();
const data = {
  database: (await client.query('SELECT current_database()')).rows[0],
  counts: (await client.query(`SELECT
    (SELECT count(*)::int FROM materials) AS materials,
    (SELECT count(*)::int FROM analyses) AS analyses,
    (SELECT count(*)::int FROM findings) AS findings,
    (SELECT count(*)::int FROM alerts) AS alerts,
    (SELECT count(*)::int FROM entities) AS entities`)).rows[0],
  jobs: (await client.query('SELECT status, count(*)::int AS n FROM scan_jobs GROUP BY status')).rows,
  materialWithoutAnalysis: (await client.query('SELECT count(*)::int AS n FROM materials m WHERE NOT EXISTS(SELECT 1 FROM analyses a WHERE a.material_id=m.id)')).rows[0].n,
  health: await (await fetch('http://127.0.0.1:4000/api/health')).json(),
};
await fs.writeFile('audit_tests/results/final-snapshot.json', JSON.stringify(data, null, 2));
console.log(JSON.stringify(data, null, 2));
await client.end();
