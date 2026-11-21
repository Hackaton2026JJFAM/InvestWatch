import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { api, qs } from '../services/frontend/src/api.js';
import { attach, emit } from '../services/backend/src/realtime.js';
import { parse, riskSql } from '../services/backend/src/validate.js';
import { z } from '../services/backend/node_modules/zod/index.js';

const require = createRequire(path.join(process.env.AUDIT_NODE_ROOT, 'package.json'));
const { io } = require('socket.io-client');

test('frontend query-string zachowuje 0 i false, usuwa puste', () => {
  assert.equal(qs({ q: 'zażółć', t: 0, flag: false, a: '', b: null }),
    '?q=za%C5%BC%C3%B3%C5%82%C4%87&t=0&flag=false');
});

test('walidacja backendu ustawia status 400', () => {
  assert.throws(() => parse(z.object({ threshold: z.number().min(0) }), { threshold: -1 }),
    (err) => err.status === 400 && Array.isArray(err.details));
});

test('riskSql stosuje próg i 0.6 progu', () => {
  assert.match(riskSql(), /\$1/);
  assert.match(riskSql(), /0\.6/);
});

test('klient frontend odrzuca HTTP error JSON', async () => {
  const original = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ error: 'syntetyczny', details: [1] }),
    { status: 400, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(api.get('/test'), (err) => err.message === 'syntetyczny' && err.details[0] === 1);
  } finally { global.fetch = original; }
});

test('klient frontend obsługuje 204', async () => {
  const original = global.fetch;
  global.fetch = async () => new Response(null, { status: 204 });
  try { assert.equal(await api.del('/test'), null); } finally { global.fetch = original; }
});

test('klient frontend nie powinien akceptować HTML 200 jako poprawnego JSON', async () => {
  const original = global.fetch;
  global.fetch = async () => new Response('<html>proxy fallback</html>', { status: 200 });
  try { await assert.rejects(api.get('/test')); } finally { global.fetch = original; }
});

test('Socket.io: rzeczywisty websocket emituje i odbiera alert:new', async () => {
  const server = http.createServer();
  const realtime = attach(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const socket = io(`http://127.0.0.1:${server.address().port}`, { transports: ['websocket'] });
  try {
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve); socket.once('connect_error', reject);
      setTimeout(() => reject(new Error('timeout connect')), 5000).unref();
    });
    const received = new Promise((resolve, reject) => {
      socket.once('alert:new', resolve);
      setTimeout(() => reject(new Error('timeout alert')), 5000).unref();
    });
    emit('alert:new', { id: 1, title: 'Syntetyczny test', score: 91 });
    assert.deepEqual(await received, { id: 1, title: 'Syntetyczny test', score: 91 });
  } finally {
    socket.disconnect();
    await new Promise(resolve => realtime.close(resolve));
  }
});

test('Socket.io: obcy Origin powinien zostać odrzucony', async () => {
  const server = http.createServer();
  const realtime = attach(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const socket = io(`http://127.0.0.1:${server.address().port}`, {
    transports: ['websocket'], reconnection: false,
    extraHeaders: { Origin: 'https://evil-audit.example' },
  });
  try {
    const connected = await new Promise(resolve => {
      socket.once('connect', () => resolve(true));
      socket.once('connect_error', () => resolve(false));
      setTimeout(() => resolve(false), 5000).unref();
    });
    assert.equal(connected, false, 'Połączenie WebSocket z obcego Origin zaakceptowane');
  } finally {
    socket.disconnect();
    await new Promise(resolve => realtime.close(resolve));
  }
});
