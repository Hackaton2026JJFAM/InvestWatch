// Rejestry na żądanie: odpis KRS po numerze (aktualny lub pełny z historią) i GLEIF po nazwie/LEI.
import { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import DataTree from '../components/DataTree.jsx';
import { GleifRelations, GleifSummary, KrsSummary } from '../components/Registry.jsx';
import { Empty, Panel } from '../components/ui.jsx';

function KrsLookup({ request }) {
  const [krs, setKrs] = useState('');
  const [full, setFull] = useState(false);
  const [state, setState] = useState({ data: null, error: null, busy: false });
  const load = (number = krs, withHistory = full) => {
    setState({ data: null, error: null, busy: true });
    api.get(`/registries/krs/${number}${qs({ full: withHistory ? 1 : undefined })}`)
      .then((data) => setState({ data, error: null, busy: false }))
      .catch((error) => setState({ data: null, error, busy: false }));
  };
  // żądanie z wyszukiwarki GLEIF (numer KRS z rekordu LEI)
  useEffect(() => {
    if (request?.krs) { setKrs(request.krs); load(request.krs, full); }
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = state.data;
  return (
    <Panel title="KRS – odpis z Krajowego Rejestru Sądowego" meta="api-krs.ms.gov.pl">
      <div className="filters">
        <label className="f">Numer KRS<input value={krs} onChange={(e) => setKrs(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="0000000000" style={{ width: 140 }} /></label>
        <label className="small"><input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> odpis pełny (z historią zmian)</label>
        <button className="btn primary" disabled={krs.length !== 10 || state.busy} onClick={() => load()}>{state.busy ? 'Pobieranie…' : 'Pobierz odpis'}</button>
      </div>
      {state.error && <div className="notice" style={{ color: 'var(--high)' }}>{state.error.message}</div>}
      {d && (
        <>
          <KrsSummary d={d} />
          <h3 style={{ marginTop: 16 }}>Wszystkie dane z odpisu {d.raw_full ? 'pełnego' : 'aktualnego'}</h3>
          <DataTree data={d.raw_full ?? d.raw} title="KRS" />
        </>
      )}
    </Panel>
  );
}

function GleifLookup({ onKrs }) {
  const [term, setTerm] = useState('');
  const [country, setCountry] = useState('');
  const [list, setList] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const isLei = /^[A-Z0-9]{18}[0-9]{2}$/.test(term.trim());
  const search = () => {
    setBusy(true); setError(null); setDetail(null);
    api.get(`/registries/gleif${qs(isLei ? { lei: term.trim() } : { name: term.trim(), country: country || undefined })}`)
      .then((r) => { setList(r); if (r.length === 1) open(r[0].lei); })
      .catch(setError).finally(() => setBusy(false));
  };
  const open = (lei) => { setBusy(true); api.get(`/registries/gleif/${lei}`).then(setDetail).catch(setError).finally(() => setBusy(false)); };
  return (
    <Panel title="GLEIF – kody LEI i struktura grupy" meta="api.gleif.org">
      <div className="filters">
        <input placeholder="Nazwa podmiotu albo kod LEI" value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && term.trim().length >= 3 && search()} style={{ flex: 1, minWidth: 220 }} />
        <select value={country} onChange={(e) => setCountry(e.target.value)} disabled={isLei}><option value="">wszystkie kraje</option><option value="PL">Polska</option><option value="CY">Cypr</option><option value="DE">Niemcy</option><option value="GB">Wielka Brytania</option><option value="MT">Malta</option></select>
        <button className="btn primary" disabled={term.trim().length < 3 || busy} onClick={search}>{busy ? 'Szukanie…' : 'Szukaj'}</button>
      </div>
      {error && <div className="notice" style={{ color: 'var(--high)' }}>{error.message}</div>}
      {list && !detail && (list.length ? (
        <table><tbody>{list.map((g) => (
          <tr key={g.lei} className="click" onClick={() => open(g.lei)}><td className="mono">{g.lei}</td><td>{g.name}</td><td>{g.country}</td><td className="small">{g.entity_status}</td><td>{g.krs && <span className="chip pass">KRS {g.krs}</span>}</td></tr>))}
        </tbody></table>) : <Empty>Brak rekordów LEI.</Empty>)}
      {detail && (
        <>
          <div className="btn-row" style={{ marginBottom: 8 }}>
            {list?.length > 1 && <button className="btn" onClick={() => setDetail(null)}>‹ Wyniki ({list.length})</button>}
            {detail.record.krs && <button className="btn primary" onClick={() => onKrs(detail.record.krs)}>Pobierz odpis KRS {detail.record.krs}</button>}
          </div>
          <GleifSummary g={detail.record} />
          <GleifRelations detail={detail} />
          <h3 style={{ marginTop: 16 }}>Wszystkie dane rekordu LEI</h3>
          <DataTree data={{ record: detail.record.raw, direct_parent: detail.direct_parent?.raw ?? detail.direct_parent, ultimate_parent: detail.ultimate_parent?.raw ?? detail.ultimate_parent }} title="GLEIF" />
        </>
      )}
    </Panel>
  );
}

export default function Registries() {
  const [request, setRequest] = useState(null);
  return (
    <>
      <div className="page-head"><div><h1>Rejestry</h1><p>Sprawdzenie dowolnego podmiotu: odpis KRS po numerze, kod LEI po nazwie. Gdy nie znasz numeru KRS, wyszukaj spółkę w GLEIF – dla polskich spółek rekord LEI zawiera numer KRS.</p></div></div>
      <div className="grid g2">
        <GleifLookup onKrs={(krs) => setRequest({ krs, at: Date.now() })} />
        <KrsLookup request={request} />
      </div>
    </>
  );
}
