import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { Empty, fmtDate, Panel, Score } from '../components/ui.jsx';
import { HelpTip } from '../components/HelpTip.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';

const LABEL = { NEW: 'Nowy', REVIEWED: 'Zweryfikowany', DISMISSED: 'Odrzucony' };

export default function Alerts() {
  const { tick, threshold, refreshCounters, toast } = useLive();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useData(`/alerts${qs({ status })}`, tick);
  const update = async (id, body) => {
    setBusy(true);
    try { await api.patch(`/alerts/${id}`, body); await reload(); refreshCounters(); }
    catch (err) { toast({ kind: 'error', title: 'Nie udało się zaktualizować alertu', text: err.message }); }
    finally { setBusy(false); }
  };
  const readAll = async () => {
    setBusy(true);
    try { await api.post('/alerts/read-all'); await reload(); refreshCounters(); toast({ kind: 'info', title: 'Oznaczono alerty jako przeczytane' }); }
    catch (err) { toast({ kind: 'error', title: 'Nie udało się zaktualizować alertów', text: err.message }); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head">
          <div><h1>Alerty</h1><p>Materiały, których wynik przekroczył ustawiony próg. Każdy alert wymaga sprawdzenia. <HelpTip term="risk_threshold" label="próg ryzyka" /></p></div>
        <div className="btn-row">
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">wszystkie</option>{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button className="btn" disabled={busy || !data?.some((a) => !a.read)} onClick={readAll}>{busy ? 'Zapisywanie…' : 'Oznacz wszystkie jako przeczytane'}</button>
        </div>
      </div>
      <Panel>
        {error && <div className="notice error-notice" role="alert">Nie udało się pobrać alertów. {error.message} <button className="btn" onClick={reload}>Spróbuj ponownie</button></div>}
        {data && (data.length ? (
          <div className="table-wrap"><table>
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
                <td><span className={`chip ${a.status === 'NEW' ? 'high' : a.status === 'REVIEWED' ? 'pass' : 'na'}`}>{LABEL[a.status]}</span></td>
                <td className="btn-row">
                  <button className="btn" disabled={busy || a.status === 'REVIEWED'} onClick={() => update(a.id, { status: 'REVIEWED', read: true })}>Zweryfikuj</button>
                  <button className="btn danger" disabled={busy || a.status === 'DISMISSED'} onClick={() => update(a.id, { status: 'DISMISSED', read: true })}>Odrzuć</button>
                </td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty>Brak alertów.</Empty>)}
      </Panel>
    </>
  );
}
