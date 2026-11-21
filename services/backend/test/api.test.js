// Testy integracyjne na działającym stosie (dev: tools/devstack/restart.ps1, albo docker compose).
// API_URL domyślnie http://127.0.0.1:4000/api. Gdy backend nie odpowiada – testy są pomijane.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'investwatch-dev';
let adminCookie = '';
const login = async () => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: ADMIN_PASSWORD }) });
  adminCookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  return r.status;
};
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
    const r2 = await send('PATCH', '/settings', { threshold: 45 });
    assert.equal(r2.status, 401, 'zmiana progu bez logowania');
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
    assert.equal((await fetch(`${API}/materials/${jobA.material_id}`, { method: 'DELETE' })).status, 401, 'usuwanie bez logowania');
    assert.equal(await login(), 200, 'logowanie administratora');
    for (const id of [jobA.material_id, jobB.material_id]) assert.equal((await fetch(`${API}/materials/${id}`, { method: 'DELETE', headers: { cookie: adminCookie } })).status, 204);
  });
});

describe('Wzbogacanie podmiotów', () => {
  test('walidacja numeru KRS i wzbogacenie podmiotu demo (LEI + listy ostrzeżeń)', async (t) => {
    if (!up) return t.skip('backend nie działa');
    const entities = (await get('/entities')).body;
    const demo = entities.find((e) => e.registry_status === 'demo');
    if (!demo) return t.skip('brak podmiotu demo');
    const bad = await send('POST', `/entities/${demo.id}/enrich`, { krs: '123' });
    assert.equal(bad.status, 400);
    let ok = await send('POST', `/entities/${demo.id}/enrich`, {});
    if (ok.status === 429) { await new Promise((r) => setTimeout(r, 5500)); ok = await send('POST', `/entities/${demo.id}/enrich`, {}); }
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const { body } = await get(`/entities/${demo.id}`);
    assert.ok(body.registries.knf_warnings, 'zapisano sprawdzenie listy ostrzeżeń KNF');
    assert.ok(body.registries.esma_mica, 'zapisano sprawdzenie rejestru MiCA');
    assert.ok(Array.isArray(body.registry), 'registry pozostaje listą (zgodność wsteczna)');
    assert.ok(body.entity.enriched_at);
  });

  test('Proof of Reserves: kształt odpowiedzi i alerty bez materiału', async (t) => {
    if (!up) return t.skip('backend nie działa');
    const { status, body } = await get('/reserves');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.history) && Array.isArray(body.alerts));
    assert.equal(body.staleDays, 45);
    const alerts = await get('/alerts');
    assert.equal(alerts.status, 200);   // LEFT JOIN – alerty PoR nie mają materiału
  });

  test('Kryzysy: walidacja nazwy z GPW i nieznanego okresu', async (t) => {
    if (!up) return t.skip('backend nie działa');
    const e = await send('POST', '/entities', { name: 'Spółka Testowa Kryzys S.A.' });
    assert.ok([200, 201].includes(e.status), JSON.stringify(e.body));
    const id = e.body.id;
    assert.equal((await send('POST', `/entities/${id}/crisis`, { ticker: 'x; DROP' })).status, 400);
    assert.equal((await send('POST', `/entities/${id}/crisis`, { ticker: 'PKOBP', crisis: 'nieznany' })).status, 400);
    const r = await get(`/entities/${id}/crisis`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.results, []);
  });

  test('wideo: odrzuca treść, która nie jest plikiem wideo', async (t) => {
    if (!up) return t.skip('backend nie działa');
    const r = await fetch(`${API}/scans/video`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'to nie jest wideo' });
    assert.equal(r.status, 415);
  });

  test('monitoring: frazy-przynęty PL, pakiety i walidacja platform', async (t) => {
    if (!up) return t.skip('backend nie działa');
    const tags = await get('/tags/popular');
    assert.equal(tags.status, 200);
    assert.ok(tags.body.phrases.includes('darmowa kasa'));
    assert.ok(tags.body.packs.pl_scam.count >= 10);
    // profil na Instagramie nie jest obsługiwany (tylko hashtag/fraza) – walidacja przed wywołaniem scrapera
    assert.equal((await send('POST', '/discover/video', { platform: 'instagram', kind: 'profile', query: 'x' })).status, 400);
    assert.equal((await send('POST', '/discover/video', { platform: 'myspace', kind: 'hashtag', query: 'x' })).status, 400);
    const list = await get('/materials?lang=pl&media=video&min_views=0');
    assert.equal(list.status, 200);
  });

  test('podsumowanie: odrzucenie wybranych punktów obniża wynik po weryfikacji i jest odwracalne', async (t) => {
    if (!up) return t.skip('backend nie działa');
    const list = await get('/materials?sort=score&dir=desc&size=1');
    const m = list.body.items[0];
    if (!m || !m.score) return t.skip('brak materiału z przesłankami');
    const sum = await get(`/summary/${m.id}`);
    assert.equal(sum.status, 200);
    const first = sum.body.points[0];
    assert.ok(first, 'są punkty podsumowania');
    const all = sum.body.points.map((p) => p.rule_id);
    const rej = await send('PUT', `/materials/${m.id}/review`, { rejected: all });
    assert.equal(rej.status, 200);
    assert.equal(rej.body.reviewed_score, 0);
    assert.ok(rej.body.points.every((p) => p.rejected));
    const back = await send('PUT', `/materials/${m.id}/review`, { rejected: [] });
    assert.equal(back.body.reviewed_score, null);
    assert.equal((await get(`/materials/${m.id}`)).body.rejected.length, 0);
  });
});
