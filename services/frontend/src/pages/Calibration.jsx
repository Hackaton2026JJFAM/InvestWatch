import { useEffect, useMemo, useState } from 'react';
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { axisProps, ChartGrid, ChartTooltip, cursorStyle, Legend, useChartColors } from '../components/charts.jsx';
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
  const col = useChartColors();
  const { data, error } = useData('/calibration', tick);
  const [t, setT] = useState(null);
  useEffect(() => { if (data && t === null) setT(data.current); }, [data, t]);
  const c = useMemo(() => (data && t !== null ? confusion(data.items, t) : null), [data, t]);
  if (error) return <Empty>{error.message}</Empty>;
  if (!data || t === null) return <Empty>Ładowanie…</Empty>;

  const save = () => api.patch('/settings', { threshold: t })
    .then((s) => { setThreshold(s.threshold); toast({ title: 'Zapisano próg', text: `Nowy próg ryzyka: ${s.threshold}` }); })
    .catch((err) => { if (err.auth !== 'cancelled') toast({ kind: 'alert', title: 'Nie zapisano progu', text: err.message }); });
  const points = data.items.map((i, k) => ({ ...i, yj: (i.ground_truth === null ? 1 : i.ground_truth ? 2 : 0) + ((k % 5) - 2) * 0.07 }));
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
        <Panel title="Wpływ progu na decyzje" meta="krok 5 punktów">
          <Legend items={[{ label: 'Alerty (powyżej progu)', color: col.s1 }, { label: 'False Positive', color: col.s2 }, { label: 'False Negative', color: col.s3 }]} />
          <ResponsiveContainer width="100%" height={270}>
            <LineChart data={data.curve} margin={{ left: -18, right: 12, top: 14 }}>
              <ChartGrid c={col} />
              <XAxis dataKey="threshold" {...axisProps(col)} />
              <YAxis allowDecimals={false} {...axisProps(col)} axisLine={false} width={40} />
              <Tooltip cursor={cursorStyle(col)} content={<ChartTooltip labelFormatter={(l) => `próg ${l}`} />} />
              <ReferenceLine x={Math.round(t / 5) * 5} stroke={col.axis} strokeDasharray="4 4" label={{ value: `próg ${t}`, fontSize: 11, fill: col.text, position: 'top' }} />
              <Line type="monotone" dataKey="flagged" name="Alerty" stroke={col.s1} dot={false} strokeWidth={2} activeDot={{ r: 4, stroke: col.surface, strokeWidth: 2 }} />
              <Line type="monotone" dataKey="fp" name="False Positive" stroke={col.s2} dot={false} strokeWidth={2} activeDot={{ r: 4, stroke: col.surface, strokeWidth: 2 }} />
              <Line type="monotone" dataKey="fn" name="False Negative" stroke={col.s3} dot={false} strokeWidth={2} activeDot={{ r: 4, stroke: col.surface, strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Rozkład wyników względem etykiet" meta="każdy punkt = materiał">
          <Legend items={[{ label: `Powyżej progu (≥ ${t})`, color: col.s2 }, { label: 'Poniżej progu', color: col.s1 }]} />
          <ResponsiveContainer width="100%" height={270}>
            <ScatterChart margin={{ left: 8, right: 12, top: 14 }}>
              <ChartGrid c={col} vertical />
              <XAxis type="number" dataKey="score" domain={[0, 100]} name="wynik" {...axisProps(col)} />
              <YAxis type="number" dataKey="yj" domain={[-0.5, 2.5]} ticks={[0, 1, 2]} width={92} {...axisProps(col)} axisLine={false}
                tickFormatter={(v) => ({ 0: 'Poprawny', 1: 'Bez etykiety', 2: 'Ryzykowny' })[v] ?? ''} />
              <ZAxis range={[70, 70]} />
              <Tooltip cursor={cursorStyle(col)} content={({ active, payload }) => (active && payload?.[0] ? (
                <div className="chart-tip"><div className="t">{payload[0].payload.title}</div>
                  <div className="r"><span className="k">wynik</span><span className="v">{Math.round(payload[0].payload.score)}</span></div>
                  <div className="r"><span className="k">etykieta</span><span className="v">{payload[0].payload.ground_truth === null ? 'brak' : payload[0].payload.ground_truth ? 'ryzykowny' : 'poprawny'}</span></div>
                </div>) : null)} />
              <ReferenceLine x={t} stroke={col.axis} strokeDasharray="4 4" />
              <Scatter data={points.filter((p) => p.score >= t)} fill={col.s2} stroke={col.surface} strokeWidth={2} name="powyżej progu" />
              <Scatter data={points.filter((p) => p.score < t)} fill={col.s1} stroke={col.surface} strokeWidth={2} name="poniżej progu" />
            </ScatterChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </>
  );
}
