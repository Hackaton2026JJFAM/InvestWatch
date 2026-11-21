import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const req = createRequire(path.join(process.env.AUDIT_NODE_ROOT, 'package.json'));
const { io } = req('socket.io-client');
const { Client } = req('pg');
const client = new Client({ connectionString: 'postgres://audit:synthetic-audit-only@127.0.0.1:55432/investwatch_audit' });
await client.connect();
const counts = async () => (await client.query(`SELECT
  (SELECT count(*)::int FROM materials) AS materials,
  (SELECT count(*)::int FROM analyses) AS analyses,
  (SELECT count(*)::int FROM findings) AS findings,
  (SELECT count(*)::int FROM alerts) AS alerts`)).rows[0];
const before = await counts();
const startJobId = (await client.query('SELECT coalesce(max(id),0)::int AS id FROM scan_jobs')).rows[0].id;
const events = [];
const socket = io('http://127.0.0.1:4000', { transports: ['websocket'] });
await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
socket.onAny((event, payload) => events.push({ event, payload }));
const out = { before, startJobId };
try {
  const response = await fetch('http://127.0.0.1:4000/api/seed', { method: 'POST' });
  out.seed = { status: response.status, data: await response.json() };
  assert.equal(out.seed.data.queued, 18);
  for (let i = 0; i < 200; i++) {
    out.jobs = (await client.query("SELECT id,status,attempts,error,material_id FROM scan_jobs WHERE id>$1 ORDER BY id", [startJobId])).rows;
    if (out.jobs.length === 18 && out.jobs.every(j => ['done', 'failed', 'duplicate'].includes(j.status))) break;
    await new Promise(r => setTimeout(r, 200));
  }
  out.after = await counts();
  out.events = events;
  out.seedAnalyses = (await client.query(`SELECT m.url,m.ground_truth,a.score
    FROM scan_jobs j JOIN materials m ON m.id=j.material_id
    JOIN analyses a ON a.material_id=m.id WHERE j.id>$1 ORDER BY j.id`, [startJobId])).rows;
  assert.equal(out.jobs.filter(j => j.status === 'done').length, 18);
  assert.equal(out.after.materials - before.materials, 18);
  assert.equal(out.after.analyses - before.analyses, 18);
  assert.equal(out.after.alerts - before.alerts, 11);
  assert.equal(events.filter(e => e.event === 'material:new').length, 18);
  assert.equal(events.filter(e => e.event === 'alert:new').length, 11);
  // Odrzucenie SSRF musi przejść w status failed bez trzech ponowień.
  const rejected = await fetch('http://127.0.0.1:4000/api/scans', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'http://127.0.0.1/audit-ssrf' }),
  });
  const rejectedId = (await rejected.json()).id;
  for (let i = 0; i < 100; i++) {
    out.ssrfJob = (await client.query('SELECT * FROM scan_jobs WHERE id=$1', [rejectedId])).rows[0];
    if (out.ssrfJob.status === 'failed') break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(out.ssrfJob.status, 'failed');
  assert.equal(out.ssrfJob.attempts, 1);
  out.ok = true;
} catch (e) { out.error = e.stack; process.exitCode = 1; }
finally {
  out.events = events;
  await fs.writeFile('audit_tests/results/seed-pipeline.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ...out, events: { materialNew: events.filter(e => e.event === 'material:new').length, alertNew: events.filter(e => e.event === 'alert:new').length } }, null, 2));
  socket.disconnect();
  await client.end();
}
