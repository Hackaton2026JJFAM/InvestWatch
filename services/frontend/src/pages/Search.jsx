// Jedna wyszukiwarka: podmioty i materiały w InvestWatch, rejestr KNF oraz rejestry zewnętrzne (KRS, GLEIF/LEI).
// Rozpoznaje typ zapytania: 10 cyfr = numer KRS, 20 znaków = kod LEI, inaczej nazwa.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import DataTree from '../components/DataTree.jsx';
import { GleifRelations, GleifSummary, KrsSummary } from '../components/Registry.jsx';
import { Empty, Panel, RecordDetails, Score, shortMaterialTitle } from '../components/ui.jsx';
import { useData, useDebounced } from '../hooks.js';
import { useLive } from '../live.jsx';
import { HelpTip } from '../components/HelpTip.jsx';
import { KIND, REG } from './Entities.jsx';

const KRS_RE = /^\d{10}$/;
const LEI_RE = /^[A-Z0-9]{18}\d{2}$/;
export const detectQuery = (q) => (KRS_RE.test(q) ? 'krs' : LEI_RE.test(q.toUpperCase()) ? 'lei' : 'name');

const TABS = [['all', 'Wszystko'], ['entities', 'Podmioty'], ['materials', 'Materiały'], ['registry', 'Rejestr KNF'], ['external', 'KRS i LEI']];

// Panel szczegółów rejestru: rekord LEI z relacjami i odpis KRS, z możliwością utworzenia karty podmiotu.
function RegistryDetail({ sel, onClose }) {
  const nav = useNavigate();
  const { toast } = useLive();
  const [gleif, setGleif] = useState(null);
  const [krs, setKrs] = useState(null);
  const [full, setFull] = useState(false);
  const [state, setState] = useState({ busy: true, error: null });

  useEffect(() => {
    let alive = true;
    setGleif(null); setKrs(null); setFull(false); setState({ busy: true, error: null });
    (async () => {
      try {
        let krsNumber = sel.krs ?? null;
        if (sel.lei) {
          const g = await api.get(`/registries/gleif/${sel.lei}`);
          if (!alive) return;
          setGleif(g);
          krsNumber = krsNumber ?? g.record.krs;
        }
        if (krsNumber) {
          const k = await api.get(`/registries/krs/${krsNumber}`);
          if (alive) setKrs(k);
        }
        if (alive) setState({ busy: false, error: null });
      } catch (error) {
        if (alive) setState({ busy: false, error });
      }
    })();
    return () => { alive = false; };
  }, [sel]);

  const loadFull = () => api.get(`/registries/krs/${krs.krs}?full=1`).then((d) => { setKrs(d); setFull(true); }).catch((error) => setState((s) => ({ ...s, error })));
  const createEntity = () => {
    const name = krs?.name ?? gleif?.record?.name;
    api.post('/entities', { name, krs: krs?.krs, lei: gleif?.record?.lei, country: gleif?.record?.country })
      .then((r) => { toast({ kind: 'info', title: r.created ? 'Utworzono kartę podmiotu' : 'Karta już istnieje', text: name }); nav(`/entities/${r.id}`); })
      .catch((err) => toast({ kind: 'alert', title: 'Nie utworzono karty', text: err.message }));
  };

  const title = krs?.name ?? gleif?.record?.name ?? sel.name ?? sel.krs ?? sel.lei;
  return (
    <Panel title={title} meta={[krs && `KRS ${krs.krs}`, gleif && `LEI ${gleif.record.lei}`].filter(Boolean).join(' · ')}
      actions={<button className="btn" onClick={onClose} aria-label="Zamknij">✕</button>} className="detail-panel">
      {state.busy && <p className="muted small">Pobieranie danych z rejestrów…</p>}
      {state.error && <div className="notice" style={{ color: 'var(--high)' }}>{state.error.message}</div>}
      {!state.busy && (krs || gleif) && (
        <div className="btn-row" style={{ marginBottom: 10 }}>
          <button className="btn primary" onClick={createEntity}>Utwórz kartę podmiotu i monitoruj</button>
          {krs && !full && <button className="btn" onClick={loadFull}>Odpis pełny (historia)</button>}
        </div>
      )}
      {krs && <><h3>Krajowy Rejestr Sądowy</h3><KrsSummary d={krs} source={sel.krs ? 'podany' : 'z GLEIF (LEI)'} /></>}
      {gleif && <><h3 style={{ marginTop: 14 }}>GLEIF – kod LEI i struktura grupy</h3><GleifSummary g={gleif.record} /><GleifRelations detail={gleif} /></>}
      {!state.busy && !krs && gleif && !gleif.record.krs && <p className="small muted">Rekord LEI nie wskazuje numeru KRS (podmiot zagraniczny albo inny rejestr źródłowy).</p>}
      {(krs || gleif) && (
        <details style={{ marginTop: 14 }}>
          <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Wszystkie dane z rejestrów</summary>
          <DataTree data={{ ...(krs ? { [full ? 'odpis_KRS_pelny' : 'odpis_KRS']: krs.raw_full ?? krs.raw } : {}), ...(gleif ? { rekord_LEI: gleif.record.raw } : {}) }} title="rejestry" />
        </details>
      )}
    </Panel>
  );
}

function GleifResults({ q, onOpen }) {
  const [pl, setPl] = useState(true);
  const { data, error } = useData(q.length >= 3 ? `/registries/gleif${qs({ name: q, country: pl ? 'PL' : undefined })}` : null);
  return (
    <Panel title={<>KRS i LEI (GLEIF) <HelpTip term="gleif" label="GLEIF" /><HelpTip term="lei" label="LEI" /></>} meta="rejestry zewnętrzne"
      actions={<label className="small"><input type="checkbox" checked={pl} onChange={(e) => setPl(e.target.checked)} /> tylko Polska</label>}>
      {error && <Empty>{error.message}</Empty>}
      {!data && !error && <p className="small muted">Szukanie w GLEIF…</p>}
      {data && (data.length ? (
        <div className="table-wrap"><table><tbody>{data.map((g) => (
          <tr key={g.lei}>
            <td><button type="button" className="text-button" onClick={() => onOpen({ lei: g.lei, name: g.name })}>{g.name}</button><RecordDetails context={g.name} fields={ [['LEI', g.lei], ['Kraj', g.country], ['Status podmiotu', g.entity_status]] } /></td>
            <td style={{ textAlign: 'right' }}>{g.krs ? <span className="chip pass">KRS {g.krs}</span> : <span className="chip na">bez KRS</span>}</td>
          </tr>))}
        </tbody></table></div>
      ) : <Empty>Brak rekordów LEI dla tej nazwy.</Empty>)}
    </Panel>
  );
}

export default function Search() {
  const { threshold } = useLive();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const type = params.get('tab') ?? 'all';
  const q = useDebounced(text.trim(), 350);
  const kind = detectQuery(q);
  const [sel, setSel] = useState(null);
  const internal = type !== 'external' && q.length >= 2;
  const { data, error } = useData(internal ? `/search${qs({ q, type: type === 'all' ? 'all' : type })}` : null);

  // numer KRS / LEI w polu wyszukiwania – od razu otwórz szczegóły z rejestru
  useEffect(() => {
    if (kind === 'krs') setSel({ krs: q });
    else if (kind === 'lei') setSel({ lei: q.toUpperCase() });
  }, [q, kind]);
  useEffect(() => {
    const p = new URLSearchParams(params);
    if (q) p.set('q', q); else p.delete('q');
    setParams(p, { replace: true });
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTab = (t) => { const p = new URLSearchParams(params); p.set('tab', t); setParams(p); };
  const showExternal = (type === 'all' || type === 'external') && kind === 'name' && q.length >= 3;

  return (
    <>
      <div className="page-head"><div><h1>Wyszukiwarka</h1><p>Podmioty, materiały i adresy URL w InvestWatch, rejestr firm KNF oraz rejestry zewnętrzne: KRS <HelpTip term="krs" label="KRS" /> i GLEIF/LEI <HelpTip term="lei" label="LEI" /> (po nazwie lub kodzie)</p></div></div>
      <Panel>
        <label className="f search-main" htmlFor="search-global">Szukaj podmiotu, materiału lub w rejestrach<input id="search-global" className="search-big" autoFocus placeholder="Nazwa firmy, numer KRS (10 cyfr), kod LEI, adres URL, fraza z reklamy…" value={text} onChange={(e) => setText(e.target.value)} /></label>
        <div className="search-hint small muted">
          {q.length < 2 ? 'Wpisz co najmniej 2 znaki.' : kind === 'krs' ? `Rozpoznano numer KRS – pobieram odpis z KRS.` : kind === 'lei' ? 'Rozpoznano kod LEI – pobieram rekord z GLEIF.' : 'Wyszukiwanie po nazwie i treści.'}
        </div>
        <div className="tabs" style={{ marginTop: 10 }}>
          {TABS.map(([k, v]) => <button key={k} className={type === k ? 'active' : ''} onClick={() => setTab(k)}>{v}</button>)}
        </div>
        {error && <Empty>{error.message}</Empty>}
      </Panel>

      <div className={`search-layout ${sel ? 'with-detail' : ''}`}>
        <div className="grid" style={{ alignContent: 'start' }}>
          {internal && data?.entities && (
            <Panel title={`Podmioty w InvestWatch (${data.entities.length})`}>
              {data.entities.length ? <div className="table-wrap"><table><tbody>{data.entities.map((e) => (
                <tr key={e.id}><td><Link to={`/entities/${e.id}`}>{e.name}</Link><RecordDetails context={e.name} fields={ [['Rodzaj', KIND[e.kind]], ['KRS', e.krs], ['LEI', e.lei]] } /></td>
                  <td style={{ textAlign: 'right' }}><span className={`chip ${REG[e.registry_status]?.[0]}`}>{REG[e.registry_status]?.[1]}</span></td></tr>))}
              </tbody></table></div> : <Empty>Brak – możesz utworzyć kartę z wyników KRS/LEI.</Empty>}
            </Panel>
          )}
          {showExternal && <GleifResults q={q} onOpen={setSel} />}
          {internal && data?.materials && (
            <Panel title={`Materiały (${data.materials.length})`}>
              {data.materials.length ? data.materials.map((m) => (
                <div key={m.id} className="result-row">
                  <Link title={m.title || m.url} to={`/materials/${m.id}`}>{shortMaterialTitle(m.title || m.url)}</Link> <Score score={m.score} threshold={threshold} />
                  <RecordDetails context={m.title || m.url} fields={ [['Pełny tytuł', m.title || m.url], ['Platforma', m.platform], ['Adres', m.url]] }>{m.snippet && <p>…{m.snippet}…</p>}</RecordDetails>
                </div>)) : <Empty>Brak</Empty>}
            </Panel>
          )}
          {internal && data?.registry && (
            <Panel title={`Rejestr firm inwestycyjnych KNF (${data.registry.length})`} meta="snapshot publicznych list KNF">
              {data.registry.length ? <div className="table-wrap"><table><tbody>{data.registry.map((f) => (
                <tr key={f.name}>
                  <td><button className="text-button" onClick={() => setSel({ name: f.name, lei: null, krs: null, knf: f, search: f.name })}>{f.name}</button>{f.demo && <span className="chip mid" style={{ marginLeft: 6 }}>DEMO</span>}<RecordDetails context={f.name} fields={ [['Kategoria', f.category], ['Kraj', f.country], ['Dopasowanie nazwy', `${Math.round(f.score)}%`]] } /></td></tr>))}
              </tbody></table></div> : <Empty>Brak</Empty>}
            </Panel>
          )}
        </div>
        {sel && (sel.lei || sel.krs ? <RegistryDetail sel={sel} onClose={() => setSel(null)} />
          : <KnfDetail sel={sel} onClose={() => setSel(null)} onOpen={setSel} />)}
      </div>
    </>
  );
}

// Wpis z rejestru KNF: pokazuje dane wpisu i szuka odpowiadającego rekordu LEI (a przez niego KRS).
function KnfDetail({ sel, onClose, onOpen }) {
  const { data } = useData(`/registries/gleif${qs({ name: sel.search })}`);
  const f = sel.knf;
  return (
    <Panel title={f.name} meta="rejestr firm inwestycyjnych KNF" actions={<button className="btn" onClick={onClose} aria-label="Zamknij">✕</button>} className="detail-panel">
      {f.demo && <div className="notice" style={{ marginBottom: 8 }}>Podmiot fikcyjny z danych demonstracyjnych – nie jest wpisem w rejestrze KNF.</div>}
      <dl className="kv">
        <dt>Kategoria</dt><dd>{f.category}</dd>
        <dt>Kraj</dt><dd>{f.country ?? '–'}</dd>
        <dt>Data zezwolenia / notyfikacji</dt><dd>{f.license_date ?? '–'}</dd>
        <dt>Zakres</dt><dd>{f.scope ?? '–'}</dd>
        {f.supervisor && <><dt>Organ nadzoru</dt><dd>{f.supervisor}</dd></>}
      </dl>
      <h3 style={{ marginTop: 14 }}>Rekordy LEI</h3>
      {!data ? <p className="small muted">Szukanie w GLEIF…</p> : data.length ? (
        <div className="table-wrap"><table><tbody>{data.map((g) => (
          <tr key={g.lei}>
            <td><button className="text-button" onClick={() => onOpen({ lei: g.lei, name: g.name })}>{g.name}</button><RecordDetails context={g.name} fields={ [['LEI', g.lei], ['Kraj', g.country]] } /></td>
            <td style={{ textAlign: 'right' }}>{g.krs && <span className="chip pass">KRS {g.krs}</span>}</td></tr>))}
        </tbody></table></div>) : <Empty>Brak rekordów LEI.</Empty>}
    </Panel>
  );
}
