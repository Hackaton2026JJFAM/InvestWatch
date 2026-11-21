// Karta podmiotu – panele kategorii; każdy pokazuje źródło i datę odczytu.
import { Fragment, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { Empty, fmtDate, Panel, RiskBadge, Score } from '../components/ui.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';
import { KIND, REG } from './Entities.jsx';

const money = (c) => (c ? `${c.value.toLocaleString('pl-PL', { maximumFractionDigits: 2 })} ${c.currency ?? ''}` : 'brak danych');
const SourceLink = ({ url, label = 'źródło' }) => (url ? <a href={url} target="_blank" rel="noreferrer noopener">{label}</a> : null);

function EnrichBar({ entity, candidates, onDone }) {
  const { toast } = useLive();
  const [krs, setKrs] = useState(entity.krs ?? (candidates.length === 1 ? candidates[0] : ''));
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!krs && candidates.length === 1) setKrs(candidates[0]); }, [candidates, krs]);
  const run = () => {
    setBusy(true);
    api.post(`/entities/${entity.id}/enrich`, krs ? { krs } : {})
      .then((r) => {
        toast({ kind: 'info', title: 'Wzbogacono dane', text: `KRS: ${r.found.krs ? 'tak' : 'nie'} · LEI: ${r.found.gleif} · listy: ${r.found.watchlists}${r.errors.length ? ` · błędy: ${r.errors.join('; ')}` : ''}` });
        onDone();
      })
      .catch((err) => toast({ kind: 'alert', title: 'Wzbogacanie nie powiodło się', text: err.message }))
      .finally(() => setBusy(false));
  };
  return (
    <div className="filters" style={{ marginBottom: 0 }}>
      <label className="f">Numer KRS<input value={krs} onChange={(e) => setKrs(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="0000000000" style={{ width: 130 }} /></label>
      {candidates.length > 1 && <span className="small muted">w materiałach: {candidates.map((c) => <button key={c} className="btn" style={{ padding: '2px 8px', marginLeft: 4 }} onClick={() => setKrs(c)}>{c}</button>)}</span>}
      <button className="btn primary" disabled={busy || (krs && krs.length !== 10)} onClick={run}>{busy ? 'Pobieranie…' : 'Wzbogać dane (KRS, LEI, listy)'}</button>
      <span className="small muted">{entity.enriched_at ? `ostatnio: ${fmtDate(entity.enriched_at)}` : 'jeszcze nie wzbogacono'}</span>
    </div>
  );
}

function RegistryPanel({ entity, registry }) {
  const k = registry.krs;
  const d = k?.status === 'found' ? k.data : null;
  const knf = entity.registry_ref;
  return (
    <Panel title="Dane rejestrowe" meta={k ? `KRS · ${fmtDate(k.checked_at)}` : 'KRS: nie pobrano'}>
      {d ? (
        <dl className="kv">
          <dt>Nazwa (KRS)</dt><dd>{d.name}</dd>
          <dt>Forma prawna</dt><dd>{d.legal_form ?? '–'}</dd>
          <dt>KRS / NIP / REGON</dt><dd className="mono">{d.krs} / {d.nip ?? '–'} / {d.regon ?? '–'}</dd>
          <dt>Data rejestracji</dt><dd>{d.registered_at ?? 'brak danych'}</dd>
          <dt>Kapitał zakładowy</dt><dd>{money(d.capital)}</dd>
          <dt>Adres</dt><dd>{d.address ?? 'brak danych'}</dd>
          <dt>Strona WWW</dt><dd>{d.website ?? '–'}</dd>
          <dt>Stan na</dt><dd>{d.state_as_of ?? '–'} · <SourceLink url={d.source_url} label="odpis KRS" /></dd>
        </dl>
      ) : k?.status === 'not_found' ? <div className="notice">Nie znaleziono numeru KRS {k.data?.krs} w rejestrze przedsiębiorców ani stowarzyszeń.</div>
        : <p className="small muted">Brak odczytu KRS. Podaj numer KRS i użyj „Wzbogać dane”.</p>}
      {knf && (
        <>
          <h3 style={{ marginTop: 14 }}>Rejestr firm inwestycyjnych KNF</h3>
          {entity.registry_status === 'demo' && <div className="notice" style={{ marginBottom: 6 }}>Podmiot fikcyjny z danych demonstracyjnych – nie jest wpisem w rejestrze KNF.</div>}
          <dl className="kv">
            <dt>Nazwa</dt><dd>{knf.name}</dd>
            <dt>Kategoria</dt><dd>{knf.category}</dd>
            <dt>Data zezwolenia / notyfikacji</dt><dd>{knf.license_date ?? 'brak danych'}</dd>
          </dl>
        </>
      )}
      {!knf && entity.registry_status === 'not_found' && <div className="notice" style={{ marginTop: 10 }}>Brak w rejestrze firm inwestycyjnych KNF – sygnał do weryfikacji, nie dowód nielegalnej działalności.</div>}
    </Panel>
  );
}

function LicensePanel({ entity, registry }) {
  const knf = entity.registry_ref;
  const esma = registry.esma_mica?.data;
  const gleif = registry.gleif?.data;
  return (
    <Panel title="Licencje i zgodność z UE" meta={registry.esma_mica ? `ESMA/GLEIF · ${fmtDate(registry.esma_mica.checked_at)}` : 'nie sprawdzono'}>
      <dl className="kv">
        <dt>Zakres (KNF)</dt><dd>{knf?.scope ?? 'brak danych'}</dd>
        <dt>Organ nadzoru</dt><dd>{knf?.supervisor ?? (knf?.country === 'PL' ? 'KNF' : 'brak danych')}</dd>
        <dt>MiCA – CASP (ESMA)</dt><dd>{esma ? (esma.casp?.length ? esma.casp.map((c) => `${c.name} (${c.country}, ${c.authority})`).join('; ') : 'nie figuruje w rejestrze CASP') : 'nie sprawdzono'}</dd>
        <dt>LEI (GLEIF)</dt>
        <dd>{gleif ? (gleif.records?.length ? gleif.records.slice(0, 4).map((g) => (
          <div key={g.lei}><a href={g.source_url} target="_blank" rel="noreferrer noopener" className="mono">{g.lei}</a> {g.name} · {g.country} · {g.entity_status}{g.lei === gleif.exact && <span className="chip pass" style={{ marginLeft: 6 }}>dokładne</span>}</div>))
          : 'brak rekordów LEI') : 'nie sprawdzono'}</dd>
      </dl>
      {esma?.casp?.[0]?.services?.length > 0 && <p className="small muted" style={{ marginBottom: 0 }}>Usługi CASP: {esma.casp[0].services.join(' · ')}</p>}
    </Panel>
  );
}

function WarningsPanel({ registry }) {
  const knf = registry.knf_warnings?.data?.hits ?? [];
  const ncasp = registry.esma_mica?.data?.ncasp ?? [];
  const checked = registry.knf_warnings;
  return (
    <Panel title="Ostrzeżenia publiczne" meta={checked ? fmtDate(checked.checked_at) : 'nie sprawdzono'}>
      {!checked && <p className="small muted">Użyj „Wzbogać dane”, aby sprawdzić listę ostrzeżeń KNF i rejestr ESMA.</p>}
      {checked && !knf.length && !ncasp.length && <div className="notice">Nie znaleziono na liście ostrzeżeń publicznych KNF ani w rejestrze podmiotów niezgodnych z MiCA.</div>}
      {knf.map((h, i) => (
        <div key={`k${i}`} className="evidence" style={{ borderLeftColor: 'var(--high)', background: 'var(--high-bg)' }}>
          <span className="where">Lista ostrzeżeń KNF · dopasowanie: {h.matched_by}</span>
          <div><b>{h.name}</b> – {h.legal_basis ?? 'zawiadomienie o podejrzeniu przestępstwa'}</div>
          <div className="small">{h.prosecutor}{h.judgments ? ` · ${h.judgments}` : ''}</div>
          <SourceLink url={h.source_url} label="lista KNF" />
        </div>
      ))}
      {ncasp.map((h, i) => (
        <div key={`n${i}`} className="evidence" style={{ borderLeftColor: 'var(--high)', background: 'var(--high-bg)' }}>
          <span className="where">ESMA – podmioty niezgodne z MiCA · dopasowanie: {h.matched_by}</span>
          <div><b>{h.name}</b> ({h.country}, {h.authority})</div>
          <div className="small">{h.reason}</div>
        </div>
      ))}
      {(knf.length > 0 || ncasp.length > 0) && <p className="small muted" style={{ marginBottom: 0 }}>Dopasowanie po nazwie wymaga potwierdzenia; po domenie, KRS lub NIP jest mocniejsze. To sygnał do weryfikacji, nie wyrok.</p>}
    </Panel>
  );
}

function PersonsPanel({ persons, registry }) {
  const masked = persons.some((p) => p.masked);
  return (
    <Panel title="Osoby powiązane" meta={registry.krs ? `KRS · ${fmtDate(registry.krs.checked_at)}` : 'źródło: KRS'}>
      {persons.length ? (
        <>
          {masked && <div className="notice" style={{ marginBottom: 8 }}>Publiczne API KRS anonimizuje imiona, nazwiska i PESEL – osób nie łączymy między spółkami. Status każdej pozycji: „wymaga weryfikacji”.</div>}
          <table><tbody>{persons.map((p) => (
            <tr key={p.id}><td className="mono">{p.full_name}</td><td className="small">{p.role}</td><td><span className="chip warn">{p.verification}</span></td></tr>))}
          </tbody></table>
        </>
      ) : <Empty>Brak danych – pobierz odpis KRS („Wzbogać dane”).</Empty>}
    </Panel>
  );
}

function HistoryPanel({ entity, timeline, registry }) {
  const d = registry.krs?.data;
  return (
    <Panel title="Historia podmiotu" meta={`w InvestWatch od ${fmtDate(entity.created_at)}`}>
      {d && <p className="small" style={{ marginTop: 0 }}>Rejestracja w KRS: <b>{d.registered_at ?? '–'}</b> · ostatni wpis: <b>{d.last_entry_at ?? '–'}</b></p>}
      {timeline.length ? (
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={timeline} margin={{ left: -20 }}><XAxis dataKey="month" fontSize={11} /><YAxis allowDecimals={false} fontSize={11} /><Tooltip /><Bar dataKey="n" name="Wykryte materiały" fill="#1d5fa8" /></BarChart>
        </ResponsiveContainer>
      ) : <Empty />}
    </Panel>
  );
}

function CrisisPanel({ id }) {
  const { data } = useData(`/entities/${id}/crisis`);
  return (
    <Panel title="Zachowanie w kryzysach" meta="fakty i źródła, bez przypisywania winy">
      {data ? <table><thead><tr><th>Okres</th><th>Maks. spadek</th><th>Powrót</th><th>Status</th></tr></thead>
        <tbody>{data.map((r) => <tr key={r.period.id}><td>{r.period.name}<div className="small muted">{r.period.start_date} – {r.period.end_date}</div></td>
          <td>{r.behavior?.max_drawdown ?? '–'}</td><td>{r.behavior?.recovery_days ?? '–'}</td><td><span className="chip na">{r.status}</span></td></tr>)}</tbody></table> : <Empty>Ładowanie…</Empty>}
    </Panel>
  );
}

function ReservesPanel({ id }) {
  const { data } = useData(`/entities/${id}/reserves`);
  return (
    <Panel title="Rezerwy i pokrycie 1:1" meta={data?.status}>
      <div className="notice">{data?.note ?? 'Dane o rezerwach to deklaracja podmiotu, nie audyt.'}</div>
      {data?.reports?.length ? <table><tbody>{data.reports.map((r) => <tr key={r.id}><td>{r.report_date}</td><td>pokrycie {r.coverage}</td><td><SourceLink url={r.source_url} /></td></tr>)}</tbody></table>
        : <Empty>Brak danych</Empty>}
    </Panel>
  );
}

export default function Entity() {
  const { id } = useParams();
  const { tick, threshold, subscribe } = useLive();
  const [refresh, setRefresh] = useState(0);
  const { data, error } = useData(`/entities/${id}`, `${tick}-${refresh}`);
  useEffect(() => subscribe((event, payload) => { if (event === 'entity:enriched' && String(payload?.id) === id) setRefresh((n) => n + 1); }), [subscribe, id]);
  if (error) return <Empty>{error.message}</Empty>;
  if (!data) return <Empty>Ładowanie…</Empty>;
  const { entity, registries: registry, materials, persons, timeline, krsCandidates } = data;
  return (
    <>
      <div className="page-head">
        <div><h1>{entity.name}</h1><p>{KIND[entity.kind] ?? entity.kind} · <span className={`chip ${REG[entity.registry_status]?.[0]}`}>{REG[entity.registry_status]?.[1]}</span>
          {entity.lei && <> · LEI <span className="mono">{entity.lei}</span></>}</p></div>
      </div>
      <Panel><EnrichBar entity={entity} candidates={krsCandidates} onDone={() => setRefresh((n) => n + 1)} /></Panel>
      <div className="grid g3" style={{ marginTop: 16 }}>
        <RegistryPanel entity={entity} registry={registry} />
        <LicensePanel entity={entity} registry={registry} />
        <WarningsPanel registry={registry} />
        <PersonsPanel persons={persons} registry={registry} />
        <HistoryPanel entity={entity} timeline={timeline} registry={registry} />
        <CrisisPanel id={id} />
        <ReservesPanel id={id} />
      </div>
      <Panel title="Materiały powiązane">
        {materials.length ? <table><thead><tr><th>Materiał</th><th>Rola podmiotu</th><th>Wynik</th><th>Ryzyko</th><th>Data</th></tr></thead>
          <tbody>{materials.map((m) => <Fragment key={`${m.id}-${m.role}`}><tr><td><Link to={`/materials/${m.id}`}>{m.title || m.url}</Link></td><td className="small">{m.role}</td><td><Score score={m.score} threshold={threshold} /></td><td><RiskBadge risk={m.risk} /></td><td className="small muted">{fmtDate(m.fetched_at)}</td></tr></Fragment>)}</tbody></table>
          : <Empty />}
      </Panel>
    </>
  );
}
