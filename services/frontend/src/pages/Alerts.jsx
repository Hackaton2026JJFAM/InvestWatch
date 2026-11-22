import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { Empty, fmtDate, Panel, RecordDetails, Score } from '../components/ui.jsx';
import { HelpTip } from '../components/HelpTip.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';

const LABEL = { NEW: 'Nowy', REVIEWED: 'Zweryfikowany', DISMISSED: 'Odrzucony' };
const ALERT_TITLE_LIMIT = 50;
const shortAlertTitle = (value) => {
  const chars = Array.from(value ?? '');
  return chars.length > ALERT_TITLE_LIMIT
    ? `${chars.slice(0, ALERT_TITLE_LIMIT - 1).join('')}…`
    : value;
};

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
          <button className="btn" disabled={busy || !data?.some((a) => !a.read)} onClick={readAll}>{busy ? 'Zapisywanie…' : 'Oznacz wszystkie jako przeczytane'}</button>
        </div>
      </div>
      <Panel>
        <div className="panel-head"><div><h2>Kolejka alertów</h2><span className="meta">{data ? `${data.length} alertów w widoku · ${data.filter((a) => !a.read).length} nieprzeczytanych` : 'Pobieranie…'}</span></div>
          <label className="f">Status alertu<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Wszystkie</option>{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        {!data && !error && <Empty>Ładowanie alertów…</Empty>}
        {error && <div className="notice error-notice" role="alert">Nie udało się pobrać alertów. {error.message} <button className="btn" onClick={reload}>Spróbuj ponownie</button></div>}
        {data && (data.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th aria-label="Nieprzeczytany"></th><th>Materiał / podmiot</th><th>Wynik</th><th>Status</th><th>Akcje</th></tr></thead>
            <tbody>{data.map((a) => (
              <tr key={a.id} className={a.read ? '' : 'unread-row'}>
                <td>{!a.read && <span className="dot" style={{ background: 'var(--high)' }} />}</td>
                <td>{a.material_id
                  ? <Link title={a.title || a.url} to={`/materials/${a.material_id}`} onClick={() => !a.read && update(a.id, { read: true })}>{shortAlertTitle(a.title || a.url)}</Link>
                  : <Link title={`${a.entity_name ?? 'Podmiot'} – ${a.kind?.startsWith('reserves') ? 'Proof of Reserves' : a.kind}`} to={a.kind?.startsWith('reserves') ? '/reserves' : `/entities/${a.entity_id}`} onClick={() => !a.read && update(a.id, { read: true })}>{shortAlertTitle(`${a.entity_name ?? 'Podmiot'} – ${a.kind?.startsWith('reserves') ? 'Proof of Reserves' : a.kind}`)}</Link>}
                  <RecordDetails context={a.title || a.entity_name} fields={[
                    ['Pełny tytuł', a.title || (a.entity_name ? `${a.entity_name} – ${a.kind}` : null)],
                    ['Utworzono', fmtDate(a.created_at)], ['Próg alertu', a.threshold],
                    ['Źródło', a.platform], ['Adres', a.url], ['Odczyt', a.read ? 'przeczytany' : 'nieprzeczytany'],
                  ]}>{a.message && <p>{a.message}</p>}</RecordDetails>
                </td>
                <td><Score score={a.score} threshold={threshold} /></td>
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
