import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { Empty, fmtDate, Panel, Score } from '../components/ui.jsx';
import { HelpTip } from '../components/HelpTip.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';

const LABEL = { NEW: 'Nowy', IN_REVIEW: 'W trakcie weryfikacji', REVIEWED: 'Zweryfikowany', DISMISSED: 'Odrzucony' };

export default function Alerts() {
  const { tick, threshold, refreshCounters, toast } = useLive();
  const [status, setStatus] = useState('');
<<<<<<< HEAD
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
=======
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
>>>>>>> origin/frontend
  };

  return (
    <>
      <div className="page-head">
          <div><h1>Alerty</h1><p>Materiały, których wynik przekroczył ustawiony próg. Każdy alert wymaga sprawdzenia. <HelpTip term="risk_threshold" label="próg ryzyka" /></p></div>
        <div className="btn-row">
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">wszystkie</option>{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
<<<<<<< HEAD
          <button className="btn" disabled={saving} onClick={readAll}>Oznacz wszystkie jako przeczytane</button>
        </div>
      </div>
      <Panel>
        {error && <Empty>{error.message}</Empty>}
        {loading && !data && <Empty>Ładowanie alertów…</Empty>}
=======
          <button className="btn" disabled={busy || !data?.some((a) => !a.read)} onClick={readAll}>{busy ? 'Zapisywanie…' : 'Oznacz wszystkie jako przeczytane'}</button>
        </div>
      </div>
      <Panel>
        {error && <div className="notice error-notice" role="alert">Nie udało się pobrać alertów. {error.message} <button className="btn" onClick={reload}>Spróbuj ponownie</button></div>}
>>>>>>> origin/frontend
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
<<<<<<< HEAD
                <td><span className={`chip ${a.status === 'NEW' ? 'high' : a.status === 'REVIEWED' ? 'pass' : a.status === 'IN_REVIEW' ? 'mid' : 'na'}`}>{LABEL[a.status]}</span></td>
                <td>
                  <div className="btn-row alert-actions">
                    {a.status === 'NEW' && <button className="btn" disabled={saving} onClick={() => update(a.id, { status: 'IN_REVIEW', read: true })} title="Przypisz do siebie – alert i materiał dostają status „W trakcie weryfikacji”">Weryfikuję</button>}
                    <button className="btn" disabled={saving || a.status === 'REVIEWED'} onClick={() => update(a.id, { status: 'REVIEWED', read: true })}>Zweryfikuj</button>
                    <button className="btn danger" disabled={saving || a.status === 'DISMISSED'} onClick={() => update(a.id, { status: 'DISMISSED', read: true })}>Odrzuć</button>
                    {a.status !== 'NEW' && <button className="btn" disabled={saving} onClick={() => update(a.id, { reset: true })} title="Porzuć przypisanie – alert wraca do stanu początkowego (nowy, nieprzeczytany), materiał do statusu „Nowy”">↺ Porzuć</button>}
                  </div>
=======
                <td><span className={`chip ${a.status === 'NEW' ? 'high' : a.status === 'REVIEWED' ? 'pass' : 'na'}`}>{LABEL[a.status]}</span></td>
                <td className="btn-row">
                  <button className="btn" disabled={busy || a.status === 'REVIEWED'} onClick={() => update(a.id, { status: 'REVIEWED', read: true })}>Zweryfikuj</button>
                  <button className="btn danger" disabled={busy || a.status === 'DISMISSED'} onClick={() => update(a.id, { status: 'DISMISSED', read: true })}>Odrzuć</button>
>>>>>>> origin/frontend
                </td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty>Brak alertów.</Empty>)}
      </Panel>
    </>
  );
}
