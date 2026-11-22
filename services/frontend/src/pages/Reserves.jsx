// Proof of Reserves giełdy (OKX): pokrycie zobowiązań wobec klientów rezerwami per aktywo.
// Dane to deklaracja giełdy, a nie audyt – tak też są opisane.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { axisProps, barCursor, ChartGrid, ChartTooltip, useChartColors } from '../components/charts.jsx';
import { Empty, fmtDate, Panel, RecordDetails, StatCard } from '../components/ui.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';

const fmtNum = (v) => (v == null ? '–' : Number(v).toLocaleString('pl-PL', { maximumFractionDigits: v < 10 ? 4 : 0 }));
const covPct = (v) => (v == null ? '–' : `${(v * 100).toFixed(1)}%`);

export default function Reserves() {
  const c = useChartColors();
  const { tick, toast } = useLive();
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useData('/reserves', tick);

  const refresh = async () => {
    setBusy(true);
    try {
      const r = await api.post('/reserves/refresh');
      toast({ kind: 'info', title: 'Proof of Reserves', text: r.newReport ? `Zapisano nowy raport ${r.audit_id}` : `Raport ${r.audit_id} bez zmian` });
      reload();
    } catch (e) {
      toast({ kind: 'error', title: 'Proof of Reserves – błąd', text: e.message });
    } finally { setBusy(false); }
  };

  if (error) return <Empty>{error.message}</Empty>;
  if (!data) return <Empty>Ładowanie…</Empty>;
  const rep = data.latest?.data;
  const assets = (rep?.assets ?? []).filter((a) => a.coverage != null).sort((a, b) => a.coverage - b.coverage);
  const chart = assets.slice(0, 24).map((a) => ({ coin: a.coin, pokrycie: Math.round(a.coverage * 1000) / 10 }));
  const stale = data.ageDays != null && data.ageDays > data.staleDays;

  return (
    <>
      <div className="page-head">
        <div><h1>Rezerwy giełd (Proof of Reserves)</h1>
          <p className="muted">OKX – pokrycie zobowiązań wobec klientów rezerwami giełdy, liczone per aktywo. Alert przy pokryciu poniżej 1:1 lub braku nowego raportu ponad {data.staleDays} dni.</p></div>
        <button className="btn primary" disabled={busy} onClick={refresh}>{busy ? 'Pobieranie…' : 'Pobierz raport teraz'}</button>
      </div>
      <div className="notice" style={{ marginBottom: 12 }}>Proof of Reserves to <b>deklaracja giełdy</b> (drzewo Merkle zobowiązań + salda portfeli), a nie audyt finansowy – nie obejmuje zobowiązań pozabilansowych ani jakości aktywów.</div>
      {!rep ? <Panel><Empty>Brak zapisanego raportu – kliknij „Pobierz raport teraz”.</Empty></Panel> : (
        <>
          <div className="grid g4">
            <StatCard label="Data raportu" value={String(data.latest.report_date).slice(0, 10)} sub={`${data.ageDays} dni temu`} tone={stale ? 'high' : ''} />
            <StatCard label="Minimalne pokrycie" value={covPct(rep.min_coverage)} sub={assets[0] ? `najniższe: ${assets[0].coin}` : ''} tone={rep.min_coverage < 1 ? 'high' : 'low'} />
            <StatCard label="Aktywa poniżej 1:1" value={rep.below_one?.length ?? 0} sub={rep.below_one?.length ? rep.below_one.join(', ') : 'wszystkie ≥ 100%'} tone={rep.below_one?.length ? 'high' : 'low'} />
            <StatCard label="Aktywa w raporcie" value={rep.assets?.length ?? 0} sub={`raport nr ${rep.audit_id}`} />
          </div>
          <div className="grid g2" style={{ marginTop: 16 }}>
            <Panel title="Pokrycie per aktywo" meta="rezerwy / zobowiązania · linia = 100%">
              <ResponsiveContainer width="100%" height={Math.max(220, chart.length * 22)}>
                <BarChart data={chart} layout="vertical" margin={{ left: 4, right: 16 }}>
                  <ChartGrid c={c} vertical />
                  <XAxis type="number" {...axisProps(c)} tickFormatter={(v) => `${v}%`} domain={[0, (max) => Math.max(110, Math.ceil(max / 10) * 10)]} />
                  <YAxis type="category" dataKey="coin" {...axisProps(c)} axisLine={false} width={56} />
                  <Tooltip cursor={barCursor(c)} content={<ChartTooltip valueFormatter={(v) => `${v}%`} />} />
                  <ReferenceLine x={100} stroke={c.axis} strokeDasharray="4 4" />
                  <Bar dataKey="pokrycie" name="Pokrycie" radius={[0, 4, 4, 0]} maxBarSize={16}>
                    {chart.map((d) => <Cell key={d.coin} fill={d.pokrycie < 100 ? 'var(--high)' : c.s1} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>
            <Panel title="Dane raportu" meta={<a href={rep.source_url} target="_blank" rel="noreferrer noopener">źródło: okx.com</a>}>
              <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
                <table><thead><tr><th>Aktywo</th><th>Pokrycie</th></tr></thead>
                  <tbody>{assets.map((a) => (
                    <tr key={a.coin}><td><b>{a.coin}</b><RecordDetails context={a.coin} fields={ [['Nazwa', a.name], ['Zobowiązania', fmtNum(a.liabilities)], ['Rezerwy', fmtNum(a.reserves)]] } /></td>
                      <td><span className={`chip ${a.coverage < 1 ? 'high' : 'pass'}`}>{covPct(a.coverage)} · {a.coverage < 1 ? 'poniżej 1:1' : 'pokrycie ≥ 1:1'}</span></td></tr>))}
                  </tbody></table>
              </div>
              <RecordDetails label="Dane techniczne raportu" fields={ [['Korzeń drzewa Merkle', rep.merkle_root], ['Odczyt', fmtDate(rep.fetched_at)]] } />
            </Panel>
          </div>
        </>
      )}
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Panel title="Historia raportów">
          {data.history.length ? <div className="table-wrap"><table><thead><tr><th>Raport</th><th>Min. pokrycie</th></tr></thead>
            <tbody>{data.history.map((h) => (
              <tr key={h.id}><td><b>{String(h.report_date).slice(0, 10)}</b><RecordDetails context={h.audit_id} fields={ [['Numer raportu', h.audit_id], ['Aktywa poniżej 1:1', h.below_one.join(', ') || 'brak']] } /></td><td>{covPct(Number(h.coverage))}{h.below_one.length > 0 && <div className="chip high">{h.below_one.length} poniżej 1:1</div>}</td></tr>))}
            </tbody></table></div> : <Empty />}
        </Panel>
        <Panel title="Alerty Proof of Reserves">
          {data.alerts.length ? <div className="table-wrap"><table><tbody>{data.alerts.map((a) => (
            <tr key={a.id}><td>{a.message}<RecordDetails context={a.message} fields={ [['Utworzono', fmtDate(a.created_at)]] } /></td>
              <td><span className={`chip ${a.kind === 'reserves' ? 'high' : 'na'}`}>{a.kind === 'reserves' ? 'alert' : 'informacja'}</span></td></tr>))}
            </tbody></table></div> : <Empty>Brak alertów.</Empty>}
          {data.latest && <p className="small" style={{ marginBottom: 0 }}><Link to={`/entities/${data.latest.entity_id}`}>Karta podmiotu OKX →</Link></p>}
        </Panel>
      </div>
    </>
  );
}
