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

test('riskSql: kategorie względem progu', () => {
  const sql = riskSql('a', '$1');
  assert.match(sql, /a\.score >= \$1 THEN 'wysokie'/);
  assert.match(sql, /\$1 \* 0\.6 THEN 'średnie'/);
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
