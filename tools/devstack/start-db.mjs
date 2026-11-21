// Wbudowany PostgreSQL 16 do pracy lokalnej bez Dockera (port 5433, dane w .devdata/pg).
// Przy pierwszym starcie tworzy bazę i wykonuje db/init.sql.
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = path.join(root, '.devdata', 'pg');
const fresh = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'investwatch',
  password: 'investwatch',
  port: 5433,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
});

if (fresh) await pg.initialise();
await pg.start();
if (fresh) {
  await pg.createDatabase('investwatch');
  const client = pg.getPgClient('investwatch');
  await client.connect();
  await client.query(fs.readFileSync(path.join(root, 'db', 'init.sql'), 'utf8'));
  await client.end();
  console.log('Utworzono bazę investwatch i wykonano db/init.sql');
}
console.log('PostgreSQL działa: postgres://investwatch:investwatch@localhost:5433/investwatch (Ctrl+C kończy)');

const stop = async () => { await pg.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
