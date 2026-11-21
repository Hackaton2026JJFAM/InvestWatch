// Proof of Reserves giełdy (OKX): zapis raportów, alerty przy pokryciu < 1:1, braku nowego raportu
// lub zmianie raportu. Dane to deklaracja giełdy, nie audyt.
import cron from 'node-cron';
import { config } from './config.js';
import { one, q, tx } from './db.js';
import { log } from './log.js';
import { emit } from './realtime.js';
import { analyzer } from './services.js';

export const STALE_DAYS = 45; // OKX publikuje raporty mniej więcej co miesiąc

async function okxEntity(t) {
  return t.one(
    `INSERT INTO entities (name, name_norm, kind, country, registry_status)
     VALUES ('OKX', 'okx', 'company', NULL, 'unknown')
     ON CONFLICT (name_norm, kind) DO UPDATE SET name = entities.name RETURNING id`);
}

async function alertOnce(t, entityId, kind, key, score, message) {
  const exists = await t.one("SELECT id FROM alerts WHERE kind = $1 AND entity_id = $2 AND message LIKE $3 || '%'", [kind, entityId, key]);
  if (exists) return null;
  return t.one(
    'INSERT INTO alerts (kind, entity_id, score, threshold, message) VALUES ($1, $2, $3, 0, $4) RETURNING id, created_at',
    [kind, entityId, score, `${key} ${message}`]);
}

export async function refreshReserves() {
  const r = await analyzer.okxReserves();
  const ageDays = r.report_date ? Math.floor((Date.now() - Date.parse(r.report_date)) / 864e5) : null;
  const result = await tx(async (t) => {
    const e = await okxEntity(t);
    const prev = await t.one('SELECT audit_id FROM reserves_reports WHERE entity_id = $1 ORDER BY report_date DESC NULLS LAST LIMIT 1', [e.id]);
    const inserted = await t.one(
      `INSERT INTO reserves_reports (entity_id, report_date, reserves, liabilities, coverage, source_url, audit_id, data)
       VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6)
       ON CONFLICT (entity_id, audit_id) DO NOTHING RETURNING id`,
      [e.id, r.report_date, r.min_coverage, r.source_url, r.audit_id, r]);
    const alerts = [];
    if (r.below_one?.length) {
      alerts.push(await alertOnce(t, e.id, 'reserves', `[raport ${r.audit_id}]`, 90,
        `Pokrycie poniżej 1:1 dla: ${r.below_one.join(', ')} (min. ${(r.min_coverage * 100).toFixed(1)}%). Deklaracja giełdy, nie audyt.`));
    }
    if (ageDays !== null && ageDays > STALE_DAYS) {
      alerts.push(await alertOnce(t, e.id, 'reserves', `[brak nowego raportu po ${r.audit_id}]`, 60,
        `Ostatni raport Proof of Reserves ma ${ageDays} dni (z ${r.report_date}).`));
    }
    if (inserted && prev && prev.audit_id !== r.audit_id) {
      alerts.push(await alertOnce(t, e.id, 'reserves_info', `[nowy raport ${r.audit_id}]`, 0,
        `Opublikowano nowy raport Proof of Reserves (${r.report_date}); min. pokrycie ${(r.min_coverage * 100).toFixed(1)}%.`));
    }
    return { entityId: e.id, newReport: Boolean(inserted), alerts: alerts.filter(Boolean) };
  });
  for (const a of result.alerts) emit('alert:new', { id: a.id, entityId: result.entityId, score: 90, title: 'OKX – Proof of Reserves', kind: 'reserves' });
  emit('entity:enriched', { id: result.entityId });
  log.info('reserves refreshed', { exchange: 'OKX', audit: r.audit_id, min: r.min_coverage, new: result.newReport });
  return { ...result, report: r, ageDays };
}

export function startReservesSchedule() {
  if (!config.enrichAuto) return null;
  // pierwszy odczyt po starcie, jeśli brak raportu
  one("SELECT count(*)::int AS n FROM reserves_reports rr JOIN entities e ON e.id = rr.entity_id WHERE e.name_norm = 'okx'")
    .then((row) => (row.n ? null : refreshReserves()))
    .catch((err) => log.warn('reserves initial refresh failed', { err: err.message }));
  if (!cron.validate(config.reservesCron)) return null;
  return cron.schedule(config.reservesCron, () => refreshReserves().catch((err) => log.warn('reserves refresh failed', { err: err.message })),
    { timezone: 'Europe/Warsaw' });
}
