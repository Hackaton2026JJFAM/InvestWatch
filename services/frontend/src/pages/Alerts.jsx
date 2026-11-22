import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { Empty, fmtDate, Panel, RecordDetails, Score } from '../components/ui.jsx';
import { HelpTip } from '../components/HelpTip.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';

const LABEL = { NEW: 'Nowy', IN_REVIEW: 'W trakcie weryfikacji', REVIEWED: 'Zweryfikowany', DISMISSED: 'Odrzucony' };
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
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">wszystkie</option>{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button className="btn" disabled={busy || !data?.some((a) => !a.read)} onClick={readAll}>{busy ? 'Zapisywanie…' : 'Oznacz wszystkie jako przeczytane'}</button>
        </div>
      </div>
      <Panel>
        {error && <div className="notice error-notice" role="alert">Nie udało się pobrać alertów. {error.message} <button className="btn" onClick={reload}>Spróbuj ponownie</button></div>}
        {data && (data.length ? (
          <div className="table-wrap alert-table-wrap"><table className="alert-table">
            <thead><tr><th aria-label="Nieprzeczytany"></th><th>Materiał / podmiot</th><th>Wynik</th><th>Status</th><th>Akcje</th></tr></thead>
            <tbody>{data.map((a) => (
              <tr key={a.id} className={a.read ? '' : 'unread-row'}>
                <td>{!a.read && <span className="dot" style={{ background: 'var(--high)' }} />}</td>
                <td>{a.material_id
                  ? <><Link title={a.title || a.url} to={`/materials/${a.material_id}`} onClick={() => !a.read && update(a.id, { read: true })}>{shortAlertTitle(a.title || a.url)}</Link>{a.copies > 0 && <> <span className="chip neutral" title="Ta sama treść w innych miejscach – jeden alert dla całej grupy">+{a.copies} {a.copies === 1 ? 'kopia' : a.copies < 5 ? 'kopie' : 'kopii'}</span></>}</>
                  : <Link title={`${a.entity_name ?? 'Podmiot'} – ${a.kind?.startsWith('reserves') ? 'Proof of Reserves' : a.kind}`} to={a.kind?.startsWith('reserves') ? '/reserves' : `/entities/${a.entity_id}`} onClick={() => !a.read && update(a.id, { read: true })}>{shortAlertTitle(`${a.entity_name ?? 'Podmiot'} – ${a.kind?.startsWith('reserves') ? 'Proof of Reserves' : a.kind}`)}</Link>}
                  <RecordDetails context={a.title || a.entity_name} fields={[
                    ['Pełny tytuł', a.title || (a.entity_name ? `${a.entity_name} – ${a.kind}` : null)],
                    ['Utworzono', fmtDate(a.created_at)], ['Próg alertu', a.threshold],
                    ['Źródło', a.platform], ['Adres', a.url], ['Odczyt', a.read ? 'przeczytany' : 'nieprzeczytany'],
                  ]}>{a.message && <p>{a.message}</p>}</RecordDetails>
                </td>
                <td><Score score={a.score} threshold={threshold} /></td>
                <td><span className={`chip ${a.status === 'NEW' ? 'high' : a.status === 'REVIEWED' ? 'pass' : a.status === 'IN_REVIEW' ? 'mid' : 'na'}`}>{LABEL[a.status]}</span></td>
                <td>
                  <div className="btn-row alert-actions">
                    {a.status === 'NEW' && <button className="btn" disabled={busy} onClick={() => update(a.id, { status: 'IN_REVIEW', read: true })} title="Przypisz do siebie – alert i materiał dostają status „W trakcie weryfikacji”">Weryfikuję</button>}
                    <button className="btn" disabled={busy || a.status === 'REVIEWED'} onClick={() => update(a.id, { status: 'REVIEWED', read: true })}>Zweryfikuj</button>
                    <button className="btn danger" disabled={busy || a.status === 'DISMISSED'} onClick={() => update(a.id, { status: 'DISMISSED', read: true })}>Odrzuć</button>
                    {a.status !== 'NEW' && <button className="btn" disabled={busy} onClick={() => update(a.id, { reset: true })} title="Porzuć przypisanie – alert wraca do stanu początkowego (nowy, nieprzeczytany), materiał do statusu „Nowy”">↺ Porzuć</button>}
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
