import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { hamming } from '../src/similarity.js';
import { BadRequest, parse, riskSql } from '../src/validate.js';

test('hamming: identyczne i różne odciski', () => {
  assert.equal(hamming('ffffffffffffffff', 'ffffffffffffffff'), 0);
  assert.equal(hamming('0000000000000000', 'ffffffffffffffff'), 64);
  assert.equal(hamming('0000000000000001', '0000000000000003'), 1);
});

test('parse: poprawne dane i czytelny błąd 400', () => {
  const schema = z.object({ threshold: z.number().int().min(0).max(100) });
  assert.deepEqual(parse(schema, { threshold: 45 }), { threshold: 45 });
  assert.throws(() => parse(schema, { threshold: 101 }), (err) => err instanceof BadRequest && err.status === 400 && err.details[0].path === 'threshold');
});

test('poziom ryzyka w stałej skali 0–100, próg alertów osobno', async () => {
  const { riskLevel, aboveSql } = await import('../src/validate.js');
  const sql = riskSql('a', '$1');
  assert.match(sql, /a\.score >= 70 THEN 'wysokie'/);
  assert.match(sql, /a\.score >= 30 THEN 'średnie'/);
  assert.deepEqual([riskLevel(89), riskLevel(50), riskLevel(10), riskLevel(null)], ['wysokie', 'średnie', 'niskie', null]);
  assert.equal(aboveSql('a', '$1'), '(a.score >= $1::numeric)');
});

test('parseRedisUrl: hasło, użytkownik, baza i TLS', async () => {
  const { parseRedisUrl } = await import('../src/config.js');
  assert.deepEqual(parseRedisUrl('rediss://user:p%40ss@cache.local:6380/4'),
    { host: 'cache.local', port: 6380, username: 'user', password: 'p@ss', db: 4, tls: {} });
  assert.equal(parseRedisUrl('memory'), null);
  assert.throws(() => parseRedisUrl('http://x'));
});

test('originAllowed: tylko ten sam host lub lista dozwolonych', async () => {
  const { originAllowed } = await import('../src/realtime.js');
  assert.equal(originAllowed('http://localhost:5173', 'localhost:5173'), true);
  assert.equal(originAllowed('https://evil-audit.example', 'localhost:5173'), false);
  assert.equal(originAllowed(undefined, 'localhost:5173'), true);
  assert.equal(originAllowed('nie-url', 'localhost:5173'), false);
});

test('isAdmin: bez ciasteczka lub z podrobionym podpisem = brak uprawnień', async () => {
  const { isAdmin } = await import('../src/auth.js');
  assert.equal(isAdmin(''), false);
  assert.equal(isAdmin(`iw_admin=${Date.now() + 60000}.podrobiony`), false);
});

test('coreName/pickGleif: nazwa bez formy prawnej wybiera właściwy rekord LEI', async () => {
  const { coreName, pickGleif } = await import('../src/enrichment.js');
  assert.equal(coreName('XTB SPÓŁKA AKCYJNA'), coreName('XTB S.A.'));
  const recs = [{ lei: 'A', name: 'XTB S.A. SUCCURSALE FRANCAISE', country: 'FR' }, { lei: 'B', name: 'XTB SPÓŁKA AKCYJNA', country: 'PL', krs: '0000217580' }];
  assert.equal(pickGleif(recs, 'XTB S.A.')?.lei, 'B');
  assert.equal(pickGleif(recs, 'Inna Firma S.A.'), null);
  assert.equal(pickGleif(recs, 'cokolwiek', 'A')?.lei, 'A');
});

test('pickGleif: forma prawna wskazuje kraj przy kilku zgodnych nazwach', async () => {
  const { pickGleif, isPolishForm } = await import('../src/enrichment.js');
  const recs = [{ lei: 'CY1', name: 'XTB LIMITED', country: 'CY' }, { lei: 'PL1', name: 'XTB SPÓŁKA AKCYJNA', country: 'PL', krs: '0000217580' }];
  assert.equal(isPolishForm('XTB S.A.'), true);
  assert.equal(isPolishForm('XTB Ltd'), false);
  assert.equal(pickGleif(recs, 'XTB S.A.')?.lei, 'PL1');
  assert.equal(pickGleif(recs, 'XTB Ltd')?.lei, 'CY1');
});

test('pickGleif: nie przypisuje rekordu z kraju niezgodnego z formą prawną', async () => {
  const { pickGleif } = await import('../src/enrichment.js');
  const onlyPl = [{ lei: 'PL1', name: 'XTB SPÓŁKA AKCYJNA', country: 'PL' }];
  assert.equal(pickGleif(onlyPl, 'XTB Ltd'), null);
  assert.equal(pickGleif(onlyPl, 'XTB'), onlyPl[0]);
});

test('isVideoUrl: filmy z platform tak, profile i zwykłe strony nie', async () => {
  const { isVideoUrl } = await import('../src/video.js');
  for (const u of ['https://www.tiktok.com/@a/video/1', 'https://vm.tiktok.com/ZM1/', 'https://youtu.be/x', 'https://www.youtube.com/shorts/x',
    'https://www.instagram.com/reel/C1/', 'https://www.facebook.com/reel/1', 'https://x.com/a/status/1', 'https://clips.twitch.tv/x', 'https://cdn.example/a.mp4']) {
    assert.equal(isVideoUrl(u), true, u);
  }
  for (const u of ['https://www.tiktok.com/@a', 'https://www.instagram.com/konto/', 'https://x.com/a', 'https://przyklad.pl/oferta', 'nie-url']) {
    assert.equal(isVideoUrl(u), false, u);
  }
});

test('weryfikacja: wynik po odrzuceniu przesłanek liczony jak w analizatorze (noisy-OR, maks. z modułów)', async () => {
  const { scoreOf, withoutRejected, summaryPoints } = await import('../src/review.js');
  const findings = [
    { module: 'm1', rule_id: 'M1.1', status: 'fail', severity: 55 },
    { module: 'm1', rule_id: 'M1.3', status: 'fail', severity: 40 },
    { module: 'm2', rule_id: '3', status: 'warn', severity: 60 },
    { module: 'm2', rule_id: '1', status: 'pass', severity: 0 },
  ];
  assert.deepEqual(scoreOf(findings), { score: 73, module_scores: { m1: 73, m2: 30 } });
  const r = withoutRejected({ findings, score: 73, module_scores: { m1: 73, m2: 30, m3: 0 } }, ['M1.1', 'M1.3']);
  assert.equal(r.score, 30);
  assert.deepEqual(r.modules, ['m2']);
  const pts = summaryPoints({ findings }, ['M1.3']);
  assert.deepEqual(pts.map((p) => [p.rule_id, p.rejected]), [['M1.1', false], ['M1.3', true], ['3', false]]);
});

test('weryfikacja: odrzucenie pojedynczego sygnału oszustwa przelicza M1.10, wynik i profil', async () => {
  const { withoutRejected, summaryPoints, isKnownKey } = await import('../src/review.js');
  const signals = [{ key: 'gwarancja', label: 'Gwarancja zysku / brak ryzyka', weight: 35 },
    { key: 'lista_ostrzezen', label: 'Podmiot z listy ostrzeżeń KNF/ESMA', weight: 45 },
    { key: 'presja_czasu', label: 'Presja czasu', weight: 20 }];
  const result = {
    score: 70, module_scores: { m1: 70 },
    findings: [{ module: 'm1', rule_id: 'M1.10', status: 'fail', severity: 77, title: 'Sygnały oszustwa inwestycyjnego', explanation: '',
      evidence: signals.map((s) => ({ text: s.label, where: s.label, signal: s.key, weight: s.weight })) }],
    profile: { primary: 'podejrzenie_oszustwa', scam_score: 77, signals, paid: true },
  };
  assert.ok(isKnownKey(result, 'M1.10:gwarancja') && !isKnownKey(result, 'M1.10:nic') && !isKnownKey(result, 'M9.9'));
  // bez gwarancji: 1-(0.55*0.8) = 56 -> nadal FAIL, ale słabszy
  const one = withoutRejected(result, ['M1.10:gwarancja']);
  assert.equal(one.findings[0].severity, 56);
  assert.equal(one.findings[0].evidence.length, 2);
  // bez gwarancji i listy ostrzeżeń: zostaje jeden słaby sygnał -> przesłanka odpada, profil = płatna promocja
  const two = withoutRejected(result, ['M1.10:gwarancja', 'M1.10:lista_ostrzezen']);
  assert.equal(two.findings.length, 0);
  assert.equal(two.score, 0);
  assert.equal(two.profile.primary, 'płatna_promocja');
  assert.equal(two.profile.scam_score, 20);
  const pts = summaryPoints(result, ['M1.10:gwarancja']);
  assert.deepEqual(pts[0].elements.map((e) => [e.key, e.rejected]),
    [['M1.10:gwarancja', true], ['M1.10:lista_ostrzezen', false], ['M1.10:presja_czasu', false]]);
});
