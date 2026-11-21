// Karta podmiotu – panele kategorii, każdy z własnym źródłem danych, znacznikiem czasu i statusem.
import { Link, useParams } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Empty, fmtDate, Panel, RiskBadge, Score } from '../components/ui.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';
import { KIND, REG } from './Entities.jsx';

function RegistryPanel({ entity, registry }) {
  const rec = registry[0];
  const d = rec?.data ?? entity.registry_ref ?? {};
  return (
    <Panel title="Dane rejestrowe" meta={rec ? `${rec.registry.toUpperCase()} · ${fmtDate(rec.checked_at)}` : 'nie sprawdzono'}>
      {rec?.status === 'found' || entity.registry_status === 'registered' ? (
        <dl className="kv">
          <dt>Nazwa w rejestrze</dt><dd>{d.name}{d.demo && <span className="chip mid" style={{ marginLeft: 6 }}>DEMO</span>}</dd>
          <dt>Kategoria</dt><dd>{d.category}</dd>
          <dt>Kraj</dt><dd>{d.country ?? 'brak danych'}</dd>
          <dt>Data zezwolenia / notyfikacji</dt><dd>{d.license_date ?? 'brak danych'}</dd>
          {d.former_names?.length > 0 && <><dt>Dawne nazwy</dt><dd>{d.former_names.join(', ')}</dd></>}
        </dl>
      ) : (
        <div className="notice">Podmiotu nie odnaleziono w lokalnym rejestrze firm inwestycyjnych KNF. To sygnał do weryfikacji, a nie dowód nielegalnej działalności.</div>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>Źródło: rejestr firm inwestycyjnych KNF (snapshot). KRS, LEI (GLEIF), CEIDG – adaptery w przygotowaniu.</p>
    </Panel>
  );
}

function LicensePanel({ registry, entity }) {
  const d = registry[0]?.data ?? entity.registry_ref ?? {};
  return (
    <Panel title="Licencje i zgodność z UE" meta={registry[0] ? fmtDate(registry[0].checked_at) : ''}>
      <dl className="kv">
        <dt>Zakres działalności</dt><dd>{d.scope ?? 'brak danych'}</dd>
        <dt>Organ nadzoru</dt><dd>{d.supervisor ?? (d.country === 'PL' ? 'KNF' : 'brak danych')}</dd>
        <dt>Status w rejestrze UE (ESMA)</dt><dd className="muted">brak danych – adapter ESMA w planie</dd>
      </dl>
    </Panel>
  );
}

function PersonsPanel({ persons }) {
  return (
    <Panel title="Osoby powiązane" meta="źródło: KRS">
      {persons.length ? <table><tbody>{persons.map((p) => <tr key={p.id}><td>{p.full_name}</td><td>{p.role}</td><td><span className="chip warn">{p.verification}</span></td></tr>)}</tbody></table>
        : <Empty>Brak danych – adapter KRS nie jest jeszcze podłączony.</Empty>}
    </Panel>
  );
}

function HistoryPanel({ entity, timeline }) {
  return (
    <Panel title="Historia podmiotu w InvestWatch" meta={`od ${fmtDate(entity.created_at)}`}>
      {timeline.length ? (
        <ResponsiveContainer width="100%" height={160}>
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
        <tbody>{data.map((r) => <tr key={r.period.id}><td>{r.period.name}<div className="small muted">{r.period.start_date?.slice(0, 10)} – {r.period.end_date?.slice(0, 10)}</div></td>
          <td>{r.behavior?.max_drawdown ?? '–'}</td><td>{r.behavior?.recovery_days ?? '–'}</td><td><span className="chip na">{r.status}</span></td></tr>)}</tbody></table> : <Empty>Ładowanie…</Empty>}
    </Panel>
  );
}

function ReservesPanel({ id }) {
  const { data } = useData(`/entities/${id}/reserves`);
  return (
    <Panel title="Rezerwy i pokrycie 1:1" meta={data?.status}>
      <div className="notice">{data?.note ?? 'Dane o rezerwach to deklaracja podmiotu, nie audyt.'}</div>
      {data?.reports?.length ? <table><tbody>{data.reports.map((r) => <tr key={r.id}><td>{r.report_date}</td><td>pokrycie {r.coverage}</td><td><a href={r.source_url}>źródło</a></td></tr>)}</tbody></table>
        : <Empty>Brak danych</Empty>}
    </Panel>
  );
}

export default function Entity() {
  const { id } = useParams();
  const { tick, threshold } = useLive();
  const { data, error } = useData(`/entities/${id}`, tick);
  if (error) return <Empty>{error.message}</Empty>;
  if (!data) return <Empty>Ładowanie…</Empty>;
  const { entity, registry, materials, persons, timeline } = data;
  return (
    <>
      <div className="page-head">
        <div><h1>{entity.name}</h1><p>{KIND[entity.kind] ?? entity.kind} · <span className={`chip ${REG[entity.registry_status]?.[0]}`}>{REG[entity.registry_status]?.[1]}</span></p></div>
      </div>
      <div className="grid g3">
        <RegistryPanel entity={entity} registry={registry} />
        <LicensePanel entity={entity} registry={registry} />
        <PersonsPanel persons={persons} />
        <HistoryPanel entity={entity} timeline={timeline} />
        <CrisisPanel id={id} />
        <ReservesPanel id={id} />
      </div>
      <Panel title="Materiały powiązane" className="" >
        {materials.length ? <table><thead><tr><th>Materiał</th><th>Rola podmiotu</th><th>Wynik</th><th>Ryzyko</th><th>Data</th></tr></thead>
          <tbody>{materials.map((m) => <tr key={`${m.id}-${m.role}`}><td><Link to={`/materials/${m.id}`}>{m.title || m.url}</Link></td><td className="small">{m.role}</td><td><Score score={m.score} threshold={threshold} /></td><td><RiskBadge risk={m.risk} /></td><td className="small muted">{fmtDate(m.fetched_at)}</td></tr>)}</tbody></table>
          : <Empty />}
      </Panel>
    </>
  );
}
