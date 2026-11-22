import { useMemo } from 'react';
import { api } from '../api.js';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AreaGradient, axisProps, barCursor, ChartGrid, ChartTooltip, cursorStyle, Legend, useChartColors } from '../components/charts.jsx';
import { Empty, fmtDate, MODULES, ModuleChips, Panel, RecordDetails, RiskBadge, Score, StatCard } from '../components/ui.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';

// Ciągła oś czasu: dni bez wykryć jako 0 (inaczej jeden punkt nie tworzy trendu).
function fillDays(trend, days = 30) {
  const byDay = Object.fromEntries(trend.map((t) => [t.day, t]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    out.push({ day: d, label: d.slice(5).replace('-', '.'), total: byDay[d]?.total ?? 0, high: byDay[d]?.high ?? 0 });
  }
  return out;
}

export default function Dashboard() {
  const { tick } = useLive();
  const c = useChartColors();
  const { data, error } = useData('/dashboard/stats', tick);
  const trend = useMemo(() => fillDays(data?.trend ?? []), [data]);
  if (error) return <Empty>Nie udało się pobrać statystyk: {error.message}</Empty>;
  if (!data) return <Empty>Ładowanie…</Empty>;
  const { totals, byModule, byRule, recent, threshold } = data;
  const modules = byModule.map((m) => ({ ...m, name: MODULES[m.module] }));
  return (
    <>
      <div className="page-head">
        <div><h1>Pulpit</h1><p>Stan monitoringu treści inwestycyjnych · próg ryzyka {threshold}</p></div>
        {data.demo?.count > 0 && (
          <label className="toggle" title="Próbki kalibracyjne (dane demonstracyjne) – domyślnie ukryte w pulpicie, wynikach i alertach">
            <input type="checkbox" checked={data.demo.shown} onChange={(e) => api.put('/settings/show-demo', { show: e.target.checked })} /> pokaż próbki demo ({data.demo.count})
          </label>
        )}
      </div>
      <div className="grid g4">
        <StatCard label="Przeanalizowane materiały" value={totals.materials} />
        <StatCard label="Wysokie ryzyko" value={totals.high} tone="high" sub={`wynik ≥ ${threshold}`} />
        <StatCard label="Nowe alerty" value={totals.new} tone="mid" sub={`${totals.unread} nieprzeczytanych`} />
        <StatCard label="Wymaga weryfikacji" value={totals.to_verify} sub="status „Nowy”, ryzyko średnie lub wysokie" />
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Panel title="Trend wykryć" meta="ostatnie 30 dni">
          <Legend items={[{ label: 'Wszystkie materiały', color: c.s1 }, { label: `Wysokie ryzyko (≥ ${threshold})`, color: c.s2 }]} />
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={trend} margin={{ left: -18, right: 8, top: 6 }}>
              <AreaGradient id="g-total" color={c.s1} />
              <AreaGradient id="g-high" color={c.s2} />
              <ChartGrid c={c} />
              <XAxis dataKey="label" {...axisProps(c)} interval="preserveStartEnd" minTickGap={24} />
              <YAxis allowDecimals={false} {...axisProps(c)} axisLine={false} width={40} />
              <Tooltip cursor={cursorStyle(c)} content={<ChartTooltip labelFormatter={(l, p) => p[0]?.payload?.day ?? l} />} />
              <Area type="monotone" dataKey="total" name="Wszystkie" stroke={c.s1} strokeWidth={2} fill="url(#g-total)" activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }} />
              <Area type="monotone" dataKey="high" name="Wysokie ryzyko" stroke={c.s2} strokeWidth={2} fill="url(#g-high)" activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Podział według modułów" meta="materiały z sygnałami">
          {modules.length ? (
            <>
              <Legend items={[{ label: 'Z sygnałami', color: c.s1 }, { label: 'Wysokie ryzyko', color: c.s2 }]} />
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={modules} margin={{ left: -18, right: 8, top: 6 }} barGap={2} barCategoryGap="28%">
                  <ChartGrid c={c} />
                  <XAxis dataKey="name" {...axisProps(c)} />
                  <YAxis allowDecimals={false} {...axisProps(c)} axisLine={false} width={40} />
                  <Tooltip cursor={barCursor(c)} content={<ChartTooltip />} />
                  <Bar dataKey="n" name="Z sygnałami" fill={c.s1} radius={[4, 4, 0, 0]} maxBarSize={44} />
                  <Bar dataKey="high" name="Wysokie ryzyko" fill={c.s2} radius={[4, 4, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            </>
          ) : <Empty />}
        </Panel>
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Panel title="Najnowsze analizy" meta="aktualizowane na żywo">
          {recent.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Materiał</th><th>Wynik</th><th>Ryzyko</th></tr></thead>
              <tbody>{recent.map((m) => (
                <tr key={m.id}>
                  <td><Link to={`/materials/${m.id}`}>{m.title || m.url}</Link><RecordDetails context={m.title || m.url} fields={ [['Pobrano', fmtDate(m.fetched_at)]] }><ModuleChips modules={m.modules} /></RecordDetails></td>
                  <td><Score score={m.score} threshold={threshold} /></td>
                  <td><RiskBadge risk={m.risk} /></td>
                </tr>))}
              </tbody>
            </table></div>
          ) : <Empty>Brak materiałów – dodaj URL w zakładce „Skanowanie”.</Empty>}
        </Panel>
        <Panel title="Najczęstsze problemy" meta="liczba materiałów z danym problemem">
          {byRule.length ? (
            <ResponsiveContainer width="100%" height={Math.max(200, byRule.length * 30)}>
              <BarChart data={byRule.map((r) => ({ ...r, name: `${r.rule_id} · ${r.title}` }))} layout="vertical" margin={{ left: 4, right: 28 }} barCategoryGap="22%">
                <ChartGrid c={c} vertical />
                <XAxis type="number" allowDecimals={false} {...axisProps(c)} />
                <YAxis type="category" dataKey="name" width={240} {...axisProps(c)} axisLine={false} />
                <Tooltip cursor={barCursor(c)} content={<ChartTooltip />} />
                <Bar dataKey="n" name="Materiały" fill={c.s1} radius={[0, 4, 4, 0]} maxBarSize={18}
                  label={{ position: 'right', fill: c.muted, fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Panel>
      </div>
    </>
  );
}
