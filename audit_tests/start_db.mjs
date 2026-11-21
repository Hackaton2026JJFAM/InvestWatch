// Izolowany PostgreSQL 16. Nigdy nie łączy się z bazą użytkownika.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.env.AUDIT_NODE_ROOT;
if (!root) throw new Error('Ustaw AUDIT_NODE_ROOT na katalog narzędzi poza repo');
const req = createRequire(path.join(root, 'package.json'));
const { default: EmbeddedPostgres } = await import(
  new URL(`file:///${req.resolve('embedded-postgres').replaceAll('\\', '/')}`)
);
const databaseDir = path.join(root, 'pgdata-audit');
try {
  await fs.access(databaseDir);
  throw new Error('Katalog bazy już istnieje; odmowa nadpisania');
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}
const pg = new EmbeddedPostgres({
  databaseDir, port: 55432, user: 'audit', password: 'synthetic-audit-only',
  persistent: true, postgresFlags: ['-h', '127.0.0.1'],
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});
await pg.initialise();
await pg.start();
await pg.createDatabase('investwatch_audit');
const client = pg.getPgClient('investwatch_audit');
await client.connect();
console.log('AUDIT DATABASE', (await client.query('SELECT version(), current_database()')).rows);
await client.query(await fs.readFile(new URL('../db/init.sql', import.meta.url), 'utf8'));
console.log('SCHEMA READY', (await client.query('SELECT extname FROM pg_extension')).rows);
await client.end();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => { await pg.stop(); process.exit(0); });
}
