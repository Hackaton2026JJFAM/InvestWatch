// Testy integracyjne na działającym stosie (dev: tools/devstack/restart.ps1, albo docker compose).
// API_URL domyślnie http://127.0.0.1:4000/api. Gdy backend nie odpowiada – testy są pomijane.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api';
const json = { 'content-type': 'application/json' };
const get = async (p) => { const r = await fetch(API + p); return { status: r.status, body: await r.json().catch(() => null) }; };
const send = async (method, p, body) => {
  const r = await fetch(API + p, { method, headers: json, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const waitJob = async (id, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const { body } = await get(`/scans/${id}`);
    if (['done', 'duplicate', 'failed'].includes(body.status)) return body;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`zadanie ${id} nie zakończyło się w ${ms} ms`);
};

let up = false;
before(async () => {
  try { up = (await fetch(`${API}/health`)).ok; } catch { up = false; }
});

describe('API', () => {
  test('health: baza, scraper i analyzer', async (t) => {
    if (!up) return t.skip('backend nie działa');
    const { body } = await get('/health');
    assert.equal(body.db, true);
    assert.equal(body.scraper?.ok, true);
    assert.equal(body.analyzer?.ok, true);
  });

  test('GET: wszystkie listy i filtry zwracają 200', async (t) => {
    if (!up) return t.skip('backend nie działa');
    for (const p of ['/materials', '/materials?risk=wysokie', '/materials?module=m2&sort=score&dir=asc', '/materials?q=test&status=NEW',
      '/dashboard/stats', '/alerts', '/settings', '/calibration', '/calibration?threshold=30', '/search?q=vi', '/entities', '/rules', '/scans', '/sources']) {
      const { status } = await get(p);
      assert.equal(status, 200, p);
    }
  });

  test('walidacja: złe dane -> 400 ze szczegółami', async (t) => {
    if (!up) return t.skip('backend nie działa');
    const r1 = await send('POST', '/scans', { url: 'ftp://x' });
    assert.equal(r1.status, 400);
    assert.ok(r1.body.details.length > 0);
    const r2 = await send('PATCH', '/settings', { threshold: 150 });
    assert.equal(r2.status, 400);
    const r3 = await get('/materials/abc');
    assert.equal(r3.status, 400);
    const r4 = await get('/materials/999999');
    assert.equal(r4.status, 404);
  });

  test('SSRF: adres lokalny jest blokowany przez scraper', async (t) => {
    if (!up) return t.skip('backend nie działa');
    const { body } = await send('POST', '/scans', { url: 'http://127.0.0.1:5433/' });
    const job = await waitJob(body.id);
    assert.equal(job.status, 'failed');
    assert.match(job.error, /SSRF/);
  });

  test('import tekstu: analiza, przesłanki, podobne materiały', async (t) => {
    if (!up) return t.skip('backend nie działa');
    const stamp = Date.now();
    const text = `Gwarantowany zysk 20% bez ryzyka! Polecam brokera TestNova, kod polecający T${stamp}. Zarabiam codziennie na CFD i kryptowalutach.`;
    const a = await send('POST', '/scans/upload', { text, platform: 'tiktok', author: '@test_api', url: `https://www.tiktok.com/@test_api/video/${stamp}` });
    assert.equal(a.status, 202);
    const jobA = await waitJob(a.body.id);
    assert.equal(jobA.status, 'done');
    const { body: detail } = await get(`/materials/${jobA.material_id}`);
    const rules = Object.fromEntries(detail.findings.map((f) => [f.rule_id, f.status]));
    assert.equal(rules.G1, 'fail');
    assert.ok(detail.analysis.score >= 60);
    // ta sama treść z innego profilu -> prawie duplikat
    const b = await send('POST', '/scans/upload', { text, platform: 'tiktok', author: '@test_api2', url: `https://www.tiktok.com/@test_api2/video/${stamp}` });
    const jobB = await waitJob(b.body.id);
    const { body: detailB } = await get(`/materials/${jobB.material_id}`);
    assert.ok(detailB.similar.some((s) => s.id === jobA.material_id && s.distance <= 3));
    // ten sam URL i treść -> deduplikacja
    const c = await send('POST', '/scans/upload', { text, platform: 'tiktok', author: '@test_api', url: `https://www.tiktok.com/@test_api/video/${stamp}` });
    assert.equal((await waitJob(c.body.id)).status, 'duplicate');
    for (const id of [jobA.material_id, jobB.material_id]) assert.equal((await fetch(`${API}/materials/${id}`, { method: 'DELETE' })).status, 204);
  });
});
