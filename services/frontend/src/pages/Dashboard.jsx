import { useNavigate } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Empty, fmtDate, MODULES, ModuleChips, Panel, RiskBadge, Score, StatCard } from '../components/ui.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';

export default function Dashboard() {
  const { tick } = useLive();
  const { data, error } = useData('/dashboard/stats', tick);
  const nav = useNavigate();
  if (error) return <Empty>Nie udało się pobrać statystyk: {error.message}</Empty>;
  if (!data) return <Empty>Ładowanie…</Empty>;
  const { totals, trend, byModule, byRule, recent, threshold } = data;
  return (
    <>
      <div className="page-head">
        <div><h1>Pulpit</h1><p>Stan monitoringu treści inwestycyjnych · próg ryzyka {threshold}</p></div>
      </div>
      <div className="grid g4">
        <StatCard label="Przeanalizowane materiały" value={totals.materials} />
        <StatCard label="Wysokie ryzyko" value={totals.high} tone="high" sub={`wynik ≥ ${threshold}`} />
        <StatCard label="Nowe alerty" value={totals.new} tone="mid" sub={`${totals.unread} nieprzeczytanych`} />
        <StatCard label="Wymaga weryfikacji" value={totals.to_verify} sub="status „Nowy”, ryzyko średnie lub wysokie" />
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Panel title="Trend wykryć (30 dni)">
          {trend.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trend} margin={{ left: -20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ef" />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="total" name="Wszystkie" stroke="#1d5fa8" fill="#1d5fa8" fillOpacity={0.15} />
                <Area type="monotone" dataKey="high" name="Wysokie ryzyko" stroke="#c62828" fill="#c62828" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Panel>
        <Panel title="Podział według modułów">
          {byModule.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={byModule.map((m) => ({ ...m, name: MODULES[m.module] }))} margin={{ left: -20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ef" />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} />
                <Tooltip />
                <Legend />
                <Bar dataKey="n" name="Z sygnałami" fill="#1d5fa8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="high" name="Wysokie ryzyko" fill="#c62828" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Panel>
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Panel title="Najnowsze analizy" meta="aktualizowane na żywo">
          {recent.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Materiał</th><th>Moduły</th><th>Wynik</th><th>Ryzyko</th><th>Data</th></tr></thead>
              <tbody>{recent.map((m) => (
                <tr key={m.id} className="click" onClick={() => nav(`/materials/${m.id}`)}>
                  <td className="truncate" style={{ maxWidth: 260 }}>{m.title || m.url}</td>
                  <td><ModuleChips modules={m.modules} /></td>
                  <td><Score score={m.score} threshold={threshold} /></td>
                  <td><RiskBadge risk={m.risk} /></td>
                  <td className="small muted">{fmtDate(m.fetched_at)}</td>
                </tr>))}
              </tbody>
            </table></div>
          ) : <Empty>Brak materiałów – dodaj URL w zakładce „Skanowanie”.</Empty>}
        </Panel>
        <Panel title="Najczęstsze przesłanki (reguły niespełnione)">
          {byRule.length ? (
            <ResponsiveContainer width="100%" height={Math.max(200, byRule.length * 26)}>
              <BarChart data={byRule.map((r) => ({ ...r, name: `${r.rule_id} ${r.title}` }))} layout="vertical" margin={{ left: 10, right: 16 }}>
                <XAxis type="number" allowDecimals={false} fontSize={11} />
                <YAxis type="category" dataKey="name" width={230} fontSize={11} />
                <Tooltip />
                <Bar dataKey="n" name="Materiały" fill="#b45f06" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Panel>
      </div>
    </>
  );
}
