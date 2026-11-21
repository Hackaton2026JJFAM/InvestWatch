// Rynek: Proof of Reserves giełdy (OKX) i zachowanie spółek giełdowych w kryzysach (archiwum GPW).
import { Router } from 'express';
import { z } from 'zod';
import { one, q } from '../db.js';
import { log } from '../log.js';
import { emit } from '../realtime.js';
import { refreshReserves, STALE_DAYS } from '../reserves.js';
import { analyzer } from '../services.js';
import { parse } from '../validate.js';

const r = Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });

// ------------------------------------------------------------------ Proof of Reserves
r.get('/reserves', async (_req, res) => {
  const reports = await q(
    `SELECT rr.id, rr.report_date, rr.coverage, rr.audit_id, rr.source_url, rr.fetched_at, rr.data, e.id AS entity_id, e.name AS exchange
       FROM reserves_reports rr JOIN entities e ON e.id = rr.entity_id
      ORDER BY rr.report_date DESC NULLS LAST, rr.id DESC LIMIT 24`);
  const alerts = await q("SELECT id, kind, score, message, status, created_at FROM alerts WHERE kind IN ('reserves', 'reserves_info') ORDER BY id DESC LIMIT 20");
  const latest = reports[0] ?? null;
  const ageDays = latest?.report_date ? Math.floor((Date.now() - Date.parse(latest.report_date)) / 864e5) : null;
  res.json({
    latest, ageDays, staleDays: STALE_DAYS,
    history: reports.map(({ data, ...x }) => ({ ...x, below_one: data?.below_one ?? [] })),
    alerts,
  });
});

let refreshing = null;
r.post('/reserves/refresh', async (_req, res) => {
  // jeden odczyt naraz; wynik analizatora jest buforowany 1 h, więc powtórne kliknięcia nie obciążają giełdy
  refreshing ??= refreshReserves().finally(() => { refreshing = null; });
  try {
    const out = await refreshing;
    res.json({ newReport: out.newReport, alerts: out.alerts.length, ageDays: out.ageDays, audit_id: out.report.audit_id });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ------------------------------------------------------------------ kryzysy (GPW)
r.get('/markets/crises', async (_req, res) => res.json(await analyzer.crises()));

let instrumentsCache = null;
r.get('/markets/gpw/instruments', async (_req, res) => {
  instrumentsCache ??= analyzer.gpwInstruments().catch((err) => { instrumentsCache = null; throw err; });
  res.json(await instrumentsCache);
});

r.get('/entities/:id/crisis', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const e = await one('SELECT id, name, ticker FROM entities WHERE id = $1', [id]);
  if (!e) return res.status(404).json({ error: 'Nie znaleziono podmiotu' });
  const rows = await q(
    `SELECT cb.id, cb.ticker, cb.status, cb.error, cb.max_drawdown, cb.recovery_days, cb.data, cb.computed_at, cb.source_url,
            cp.code, cp.name AS crisis_name, cp.start_date, cp.end_date
       FROM company_crisis_behavior cb JOIN crisis_periods cp ON cp.id = cb.crisis_id
      WHERE cb.entity_id = $1 ORDER BY cp.start_date`, [id]);
  res.json({ ticker: e.ticker, results: rows });
});

const running = new Set();

r.post('/entities/:id/crisis', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const b = parse(z.object({
    ticker: z.string().trim().regex(/^[A-Za-z0-9.-]{2,20}$/, 'Nazwa skrócona z GPW, np. PKOBP, XTB'),
    crisis: z.string().regex(/^[a-z0-9]{3,30}$/).default('covid2020'),
  }), req.body);
  const e = await one('SELECT id, name FROM entities WHERE id = $1', [id]);
  if (!e) return res.status(404).json({ error: 'Nie znaleziono podmiotu' });
  const crises = await analyzer.crises();
  const period = crises[b.crisis];
  if (!period) return res.status(400).json({ error: `Nieznany okres kryzysu: ${b.crisis}` });
  const ticker = b.ticker.toUpperCase();
  const cp = await one(
    `INSERT INTO crisis_periods (code, name, start_date, end_date) VALUES ($1, $2, $3, $4)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date RETURNING id`,
    [b.crisis, period.name, period.start, period.end]);
  const key = `${id}:${cp.id}`;
  if (running.has(key)) return res.status(202).json({ status: 'running' });
  await q('UPDATE entities SET ticker = $2 WHERE id = $1', [id, ticker]);
  await q(
    `INSERT INTO company_crisis_behavior (entity_id, crisis_id, ticker, status, error, data)
     VALUES ($1, $2, $3, 'running', NULL, NULL)
     ON CONFLICT (entity_id, crisis_id) DO UPDATE SET ticker = EXCLUDED.ticker, status = 'running', error = NULL`, [id, cp.id, ticker]);
  running.add(key);
  // obliczenie w tle – pierwsze pobranie okresu z archiwum GPW trwa kilka minut
  analyzer.crisisReport({ ticker, crisis: b.crisis })
    .then((d) => q(
      `UPDATE company_crisis_behavior SET status = 'done', max_drawdown = $3, recovery_days = $4, data = $5, source_url = $6,
              events = $7, computed_at = now() WHERE entity_id = $1 AND crisis_id = $2`,
      [id, cp.id, d.max_drawdown, d.recovery_days, d, d.source_url, JSON.stringify(d.worst_sessions ?? [])]))
    .catch((err) => {
      log.warn('crisis report failed', { entity: id, ticker, err: err.message });
      return q("UPDATE company_crisis_behavior SET status = 'failed', error = $3 WHERE entity_id = $1 AND crisis_id = $2", [id, cp.id, err.message.slice(0, 300)]);
    })
    .finally(() => { running.delete(key); emit('entity:enriched', { id }); });
  res.status(202).json({ status: 'running' });
});

export default r;
