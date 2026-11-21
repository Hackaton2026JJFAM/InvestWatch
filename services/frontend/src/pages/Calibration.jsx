import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { api } from '../api.js';
import { Empty, Panel, pct, StatCard } from '../components/ui.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';

// Próg nie zmienia wyników klasyfikatora – zmienia tylko decyzję, co zostanie oznaczone.
function confusion(items, t) {
  const c = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const i of items) {
    if (i.ground_truth === null) continue;
    const pred = i.score >= t;
    if (pred && i.ground_truth) c.tp++; else if (pred) c.fp++; else if (i.ground_truth) c.fn++; else c.tn++;
  }
  c.precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : null;
  c.recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : null;
  c.flagged = items.filter((i) => i.score >= t).length;
  return c;
}

export default function Calibration() {
  const { tick, setThreshold, toast } = useLive();
  const { data, error } = useData('/calibration', tick);
  const [t, setT] = useState(null);
  useEffect(() => { if (data && t === null) setT(data.current); }, [data, t]);
  const c = useMemo(() => (data && t !== null ? confusion(data.items, t) : null), [data, t]);
  if (error) return <Empty>{error.message}</Empty>;
  if (!data || t === null) return <Empty>Ładowanie…</Empty>;

  const save = () => api.patch('/settings', { threshold: t }).then((s) => { setThreshold(s.threshold); toast({ title: 'Zapisano próg', text: `Nowy próg ryzyka: ${s.threshold}` }); });
  const points = data.items.map((i) => ({ ...i, y: i.ground_truth === null ? 0.5 : i.ground_truth ? 1 : 0 }));
  const cur = confusion(data.items, data.current);

  return (
    <>
      <div className="page-head">
        <div><h1>Panel kalibracji</h1><p>Regulacja progu: precyzja vs pełność wykrywania · {data.labeled} z {data.total} materiałów ma etykietę testową</p></div>
        <div className="btn-row"><button className="btn" onClick={() => setT(data.current)}>Przywróć {data.current}</button><button className="btn primary" disabled={t === data.current} onClick={save}>Zapisz próg {t}</button></div>
      </div>
      <Panel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <b style={{ fontSize: '2rem', minWidth: 60 }}>{t}</b>
          <input type="range" className="slider" min={0} max={100} value={t} onChange={(e) => setT(Number(e.target.value))} aria-label="Próg ryzyka" />
        </div>
        <p className="small muted" style={{ margin: '6px 0 0' }}>Kategorie: wysokie ≥ {t} · średnie ≥ {Math.round(t * 0.6)} · niskie poniżej. Zmiana progu nie zmienia wyników klasyfikatora, tylko decyzję o oznaczeniu.</p>
      </Panel>
      <div className="grid g4" style={{ marginTop: 16 }}>
        <StatCard label="Materiały powyżej progu (alerty)" value={c.flagged} sub={`przy obecnym progu ${data.current}: ${cur.flagged}`} tone="high" />
        <StatCard label="Precyzja" value={pct(c.precision)} sub={`obecnie ${pct(cur.precision)}`} />
        <StatCard label="Pełność (recall)" value={pct(c.recall)} sub={`obecnie ${pct(cur.recall)}`} />
        <div className="panel">
          <span className="small muted">Macierz pomyłek (dane testowe)</span>
          <div className="confusion" style={{ marginTop: 6 }}>
            <div style={{ background: 'var(--low-bg)' }}><b>{c.tp}</b>TP</div>
            <div style={{ background: 'var(--high-bg)' }}><b>{c.fp}</b>False Positive</div>
            <div style={{ background: 'var(--mid-bg)' }}><b>{c.fn}</b>False Negative</div>
            <div style={{ background: 'var(--na-bg)' }}><b>{c.tn}</b>TN</div>
          </div>
        </div>
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Panel title="Wpływ progu: FP / FN i liczba alertów">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data.curve} margin={{ left: -20, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ef" />
              <XAxis dataKey="threshold" fontSize={11} />
              <YAxis allowDecimals={false} fontSize={11} />
              <Tooltip />
              <Legend />
              <ReferenceLine x={Math.round(t / 5) * 5} stroke="#1d5fa8" strokeDasharray="4 4" label={{ value: `próg ${t}`, fontSize: 11 }} />
              <Line dataKey="flagged" name="Alerty" stroke="#1d5fa8" dot={false} strokeWidth={2} />
              <Line dataKey="fp" name="False Positive" stroke="#c62828" dot={false} strokeWidth={2} />
              <Line dataKey="fn" name="False Negative" stroke="#b45f06" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Rozkład wyników (1 = ryzykowny wg etykiety, 0 = poprawny, 0,5 = bez etykiety)">
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ left: -20, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ef" />
              <XAxis type="number" dataKey="score" domain={[0, 100]} name="wynik" fontSize={11} />
              <YAxis type="number" dataKey="y" domain={[-0.2, 1.2]} ticks={[0, 0.5, 1]} fontSize={11} />
              <ZAxis range={[60, 60]} />
              <Tooltip formatter={(v, n) => [v, n]} labelFormatter={() => ''} content={({ payload }) => payload?.[0] ? <div className="panel small">{payload[0].payload.title}<br />wynik {Math.round(payload[0].payload.score)}</div> : null} />
              <ReferenceLine x={t} stroke="#1d5fa8" strokeDasharray="4 4" />
              <Scatter data={points.filter((p) => p.score >= t)} fill="#c62828" name="powyżej progu" />
              <Scatter data={points.filter((p) => p.score < t)} fill="#2e7d32" name="poniżej progu" />
            </ScatterChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </>
  );
}
