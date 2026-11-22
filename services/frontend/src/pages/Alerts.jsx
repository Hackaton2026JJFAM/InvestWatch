import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { Empty, fmtDate, Panel, Score } from '../components/ui.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';

const LABEL = { NEW: 'Nowy', IN_REVIEW: 'W trakcie weryfikacji', REVIEWED: 'Zweryfikowany', DISMISSED: 'Odrzucony' };

export default function Alerts() {
  const { tick, threshold, refreshCounters, toast } = useLive();
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const { data, error, loading, reload } = useData(`/alerts${qs({ status })}`, tick);
  const update = async (id, body) => {
    setSaving(true);
    try { await api.patch(`/alerts/${id}`, body); reload(); refreshCounters(); }
    catch (e) { toast({ kind: 'error', title: 'Nie udało się zaktualizować alertu', text: e.message }); }
    finally { setSaving(false); }
  };
  const readAll = async () => {
    setSaving(true);
    try { await api.post('/alerts/read-all'); reload(); refreshCounters(); }
    catch (e) { toast({ kind: 'error', title: 'Nie udało się oznaczyć alertów', text: e.message }); }
    finally { setSaving(false); }
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Alerty</h1><p>Materiały, które w chwili analizy przekroczyły próg ryzyka · powiadomienia przez WebSocket</p></div>
        <div className="btn-row">
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">wszystkie</option>{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button className="btn" disabled={saving} onClick={readAll}>Oznacz wszystkie jako przeczytane</button>
        </div>
      </div>
      <Panel>
        {error && <Empty>{error.message}</Empty>}
        {loading && !data && <Empty>Ładowanie alertów…</Empty>}
        {data && (data.length ? (
          <div className="table-wrap alert-table-wrap"><table className="alert-table">
            <thead><tr><th></th><th>Materiał</th><th>Wynik</th><th>Próg</th><th>Utworzono</th><th>Status</th><th>Akcje</th></tr></thead>
            <tbody>{data.map((a) => (
              <tr key={a.id} style={{ fontWeight: a.read ? 400 : 600 }}>
                <td>{!a.read && <span className="dot" style={{ background: 'var(--high)' }} />}</td>
                <td>{a.material_id
                  ? <><Link to={`/materials/${a.material_id}`} onClick={() => !a.read && update(a.id, { read: true })}>{a.title || a.url}</Link><div className="small muted truncate">{a.platform} · {a.url}</div></>
                  : <><Link to={a.kind?.startsWith('reserves') ? '/reserves' : `/entities/${a.entity_id}`} onClick={() => !a.read && update(a.id, { read: true })}>{a.entity_name ?? 'Podmiot'} – {a.kind?.startsWith('reserves') ? 'Proof of Reserves' : a.kind}</Link><div className="small muted">{a.message}</div></>}</td>
                <td><Score score={a.score} threshold={threshold} /></td>
                <td>{a.threshold}</td>
                <td className="small muted">{fmtDate(a.created_at)}</td>
                <td><span className={`chip ${a.status === 'NEW' ? 'high' : a.status === 'REVIEWED' ? 'pass' : a.status === 'IN_REVIEW' ? 'mid' : 'na'}`}>{LABEL[a.status]}</span></td>
                <td>
                  <div className="btn-row alert-actions">
                    <button className="btn" disabled={saving || a.status === 'REVIEWED'} onClick={() => update(a.id, { status: 'REVIEWED', read: true })}>Zweryfikuj</button>
                    <button className="btn danger" disabled={saving || a.status === 'DISMISSED'} onClick={() => update(a.id, { status: 'DISMISSED', read: true })}>Odrzuć</button>
                  </div>
                </td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty>Brak alertów.</Empty>)}
      </Panel>
    </>
  );
}
