// Odczyty i sprawdzenie walidacji na bazie audytowej; nie usuwa danych.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(path.join(process.cwd(), 'services/backend/package.json'));
const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgres://audit:synthetic-audit-only@127.0.0.1:55432/investwatch_audit',
});
await client.connect();
const output = {
  db: (await client.query('SELECT version(), current_database()')).rows,
  extensions: (await client.query('SELECT extname FROM pg_extension')).rows,
  threshold: (await client.query("SELECT value FROM settings WHERE key='threshold'")).rows,
  requests: [],
};
for (const [method, route, body] of [
  ['GET', '/health'], ['GET', '/materials'], ['GET', '/materials?risk=wysokie'],
  ['GET', '/materials?platform=web'], ['GET', '/dashboard/stats'],
  ['GET', '/settings'], ['GET', '/calibration'], ['GET', '/entities'],
  ['GET', '/search?q=audit&type=entities'], ['GET', '/absent'],
  ['PATCH', '/settings', { threshold: -1 }],
]) {
  const res = await fetch(`http://127.0.0.1:4000/api${route}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000),
  });
  output.requests.push({ method, route, status: res.status, body: await res.text() });
}
const config = spawnSync(process.execPath, ['--input-type=module', '-e',
  "import {config} from './services/backend/src/config.js'; console.log(JSON.stringify(config.redis));"
], { encoding: 'utf8', env: { ...process.env, REDIS_URL: 'rediss://audit:synthetic@localhost:56379/4' } });
output.redisConfigFromAuthenticatedTlsUrl = config.stdout.trim();
await fs.writeFile('audit_tests/results/backend-probe.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
await client.end();
