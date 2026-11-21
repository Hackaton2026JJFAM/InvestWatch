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
