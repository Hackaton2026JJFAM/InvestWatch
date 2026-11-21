import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { Empty, fmtDate, Panel, Score } from '../components/ui.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';

const LABEL = { NEW: 'Nowy', REVIEWED: 'Zweryfikowany', DISMISSED: 'Odrzucony' };

export default function Alerts() {
  const { tick, threshold, refreshCounters } = useLive();
  const [status, setStatus] = useState('');
  const { data, error, reload } = useData(`/alerts${qs({ status })}`, tick);
  const update = (id, body) => api.patch(`/alerts/${id}`, body).then(() => { reload(); refreshCounters(); });
  const readAll = () => api.post('/alerts/read-all').then(() => { reload(); refreshCounters(); });

  return (
    <>
      <div className="page-head">
        <div><h1>Alerty</h1><p>Materiały, które w chwili analizy przekroczyły próg ryzyka · powiadomienia przez WebSocket</p></div>
        <div className="btn-row">
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">wszystkie</option>{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button className="btn" onClick={readAll}>Oznacz wszystkie jako przeczytane</button>
        </div>
      </div>
      <Panel>
        {error && <Empty>{error.message}</Empty>}
        {data && (data.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th></th><th>Materiał</th><th>Wynik</th><th>Próg</th><th>Utworzono</th><th>Status</th><th>Akcje</th></tr></thead>
            <tbody>{data.map((a) => (
              <tr key={a.id} style={{ fontWeight: a.read ? 400 : 600 }}>
                <td>{!a.read && <span className="dot" style={{ background: 'var(--high)' }} />}</td>
                <td><Link to={`/materials/${a.material_id}`} onClick={() => !a.read && update(a.id, { read: true })}>{a.title || a.url}</Link><div className="small muted truncate">{a.platform} · {a.url}</div></td>
                <td><Score score={a.score} threshold={threshold} /></td>
                <td>{a.threshold}</td>
                <td className="small muted">{fmtDate(a.created_at)}</td>
                <td><span className={`chip ${a.status === 'NEW' ? 'high' : a.status === 'REVIEWED' ? 'pass' : 'na'}`}>{LABEL[a.status]}</span></td>
                <td className="btn-row">
                  <button className="btn" disabled={a.status === 'REVIEWED'} onClick={() => update(a.id, { status: 'REVIEWED', read: true })}>Zweryfikuj</button>
                  <button className="btn danger" disabled={a.status === 'DISMISSED'} onClick={() => update(a.id, { status: 'DISMISSED', read: true })}>Odrzuć</button>
                </td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty>Brak alertów.</Empty>)}
      </Panel>
    </>
  );
}
